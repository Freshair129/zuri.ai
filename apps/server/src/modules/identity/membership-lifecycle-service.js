// @req FR-191 — the writer side of a lifecycle three earlier decisions
//   declared and nothing implemented. ADR-045 D3 named the vocabulary, FR-095
//   promised that suspension denies the next request, and both `resolve-viewer`
//   and `authorization-context` filter on it — while `membership.update`
//   existed twice in the repository and neither call wrote `status`. A read
//   filter over a column nothing writes is not a control
//   (.brain/rca/2026-09-12-a-grant-that-cannot-be-withdrawn.md).
// @spec ADR-077 D2, ADR-045 D3/D6, BR-033, SEC-003, SEC-026, SDD-092, NFR-019
// @req FR-198 — every transition event carries tenantId/businessId/reason as
//   columns, and the status before/after as beforeJson/afterJson, so
//   `listAccessHistory` (FR-199) can answer "what happened in this Business"
//   by query instead of by scan (ADR-080).
// @tested tests/unit/membership-lifecycle-service.test.js,
//   tests/integration/fr191-access-grant-lifecycle.test.js,
//   tests/integration/fr198-fr199-audit-access-evidence.test.js
import prisma from '@/lib/db'
import { z } from 'zod'
import { MEMBERSHIP_STATUSES } from '@/lib/validation/enums'
import { resolveViewer } from './resolve-viewer'
import { ownsBusiness, ownsTenant } from './viewer-authority'
import { recordAudit } from '@/modules/project-manager/application/audit'

const LIVE = MEMBERSHIP_STATUSES.filter((status) => status !== 'REVOKED')

// A reason is mandatory on every transition. This is the cheapest control in
// the file and the one an access review actually reads: "we removed their
// access" and "we removed their access because they left on 3 September" are
// the same row with and without it.
const zReason = z.string().trim().min(1).max(500)
const zTransition = z.object({ membershipId: z.string().min(1), reason: zReason })
const zOffboard = z.object({ personId: z.string().min(1), tenantId: z.string().min(1), reason: zReason })

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

// 404-shaped and byte-identical for "you do not own this scope" and "no such
// membership", because the alternative is an oracle over other tenants' ids
// (SEC-001, FR-072(a)). Every refusal below that is NOT 404 has already passed
// this gate, so a 409 discloses nothing the caller could not already read.
function notFound() {
  return failure(404, 'Membership is outside your owned scope')
}

/**
 * Authority over one grant, by its own scope.
 *
 * A BUSINESS-scoped grant needs `ownsBusiness`; a TENANT-scoped one needs
 * `ownsTenant`. The second half is the repair: `assertMembershipBusinessOwned`
 * in `profile-permission-service` fails closed on a null `businessId`, which is
 * correct for a surface that cannot express tenant scope but left the broadest
 * grant in the system unadministrable from anywhere (ADR-077 D3). `ownsTenant`
 * has existed in `viewer-authority` since FR-074(b) and was used by
 * `scope-service` and `api-access-auth`; only this seam never called it.
 */
function assertGrantOwned(membership, viewer) {
  const owned = membership.scopeType === 'TENANT' || !membership.businessId
    ? ownsTenant(viewer, membership.tenantId)
    : ownsBusiness(viewer, membership.businessId)
  if (!owned) throw notFound()
}

async function loadGrant(db, membershipId, viewer) {
  const membership = await db.membership.findUnique({ where: { id: membershipId } })
  if (!membership) throw notFound()
  assertGrantOwned(membership, viewer)
  return membership
}

/**
 * Refuse to leave a Business with no live OWNER.
 *
 * `revokeOperatorGrant` has held exactly this guard for the operator capability
 * since FR-107; it was never applied to the authority that needed it more. A
 * Business with no owner is not recoverable from inside the product: no one can
 * grant, no one can revoke, and the only route back is SQL.
 *
 * Tenant-wide OWNER grants count, because they own every Business beneath the
 * Tenant — so demoting the last per-Business owner is safe while a tenant owner
 * remains, and unsafe when they do not.
 */
async function assertNotLastOwner(db, membership, viewer, { allowLast = false } = {}) {
  if (membership.role !== 'OWNER') return
  const scopeIsTenant = membership.scopeType === 'TENANT' || !membership.businessId

  const siblings = await db.membership.count({
    where: {
      id: { not: membership.id },
      role: 'OWNER',
      status: { in: LIVE },
      tenantId: membership.tenantId,
      ...(scopeIsTenant ? {} : { OR: [{ businessId: membership.businessId }, { businessId: null }] }),
    },
  })
  if (siblings > 0) return

  // The override is a tenant owner's call, never a business owner's: the person
  // who would be stranded by the mistake is the only one who may make it.
  if (allowLast && ownsTenant(viewer, membership.tenantId)) return
  throw failure(409, 'LAST_OWNER')
}

/**
 * Suspend or revoke the role bindings that depend on this grant.
 *
 * `cascadeOfMembershipId` records WHY a binding is not active, which is what
 * lets `reinstateMembership` restore only the bindings this membership took
 * down and leave alone one that was suspended in its own right. Without the
 * tag, reinstating a person would silently re-grant a capability someone had
 * deliberately removed.
 */
async function cascadeBindings(tx, membership, status, { actorId, reason }) {
  const where = {
    personId: membership.personId,
    tenantId: membership.tenantId,
    status: { in: LIVE },
    ...(membership.scopeType === 'TENANT' || !membership.businessId
      ? {}
      : { businessId: membership.businessId }),
  }
  const affected = await tx.roleBinding.findMany({ where, select: { id: true, roleKey: true, businessId: true } })
  if (!affected.length) return []

  await tx.roleBinding.updateMany({
    where: { id: { in: affected.map((binding) => binding.id) } },
    data: {
      status,
      ...(status === 'REVOKED' ? { revokedAt: new Date() } : {}),
      cascadeOfMembershipId: membership.id,
    },
  })
  for (const binding of affected) {
    await recordAudit(tx, {
      entityType: 'ROLE_BINDING',
      entityId: binding.id,
      action: status === 'REVOKED' ? 'ROLE_BINDING_REVOKED' : 'ROLE_BINDING_SUSPENDED',
      payload: { roleKey: binding.roleKey, businessId: binding.businessId, cascadeOfMembershipId: membership.id, reason },
      actorId,
      tenantId: membership.tenantId,
      businessId: binding.businessId,
      reason,
      beforeJson: { status: 'ACTIVE' },
      afterJson: { status, cascadeOfMembershipId: membership.id },
    })
  }
  return affected.map((binding) => binding.id)
}

/**
 * Kill this person's sessions when the grant that justified them is gone.
 *
 * Belt and braces, not the mechanism: `resolveViewer` recomputes authority per
 * request, so a revoked grant is already denied on the next call (NFR-019).
 * What this adds is that the person is logged out rather than left holding a
 * cookie that resolves to a Waiting Room.
 */
async function revokeSessionsIfStranded(tx, personId, actorId, reason) {
  const stillLive = await tx.membership.count({ where: { personId, status: { in: LIVE } } })
  if (stillLive > 0) return 0
  const { count } = await tx.session.updateMany({
    where: { personId, status: 'ACTIVE' },
    data: { status: 'REVOKED', revokedAt: new Date() },
  })
  if (count > 0) {
    await recordAudit(tx, {
      entityType: 'SESSION', entityId: personId, action: 'SESSIONS_REVOKED',
      payload: { count, reason }, actorId, reason,
    })
  }
  return count
}

async function ownerViewerFor(resolve, db) {
  return resolve({ db })
}

export async function suspendMembership(input, { db = prisma, resolve = resolveViewer } = {}) {
  const data = zTransition.parse(input)
  const viewer = await ownerViewerFor(resolve, db)
  const membership = await loadGrant(db, data.membershipId, viewer)

  if (membership.status === 'SUSPENDED') throw failure(409, 'ALREADY_SUSPENDED')
  if (membership.status === 'REVOKED') throw failure(409, 'REVOKED_IS_TERMINAL')
  await assertNotLastOwner(db, membership, viewer)

  return db.$transaction(async (tx) => {
    const updated = await tx.membership.update({
      where: { id: membership.id },
      data: { status: 'SUSPENDED', suspendedAt: new Date(), version: { increment: 1 } },
    })
    const bindings = await cascadeBindings(tx, membership, 'SUSPENDED', {
      actorId: viewer.principal.id, reason: data.reason,
    })
    await recordAudit(tx, {
      entityType: 'MEMBERSHIP', entityId: membership.id, action: 'MEMBERSHIP_SUSPENDED',
      payload: { from: membership.status, to: 'SUSPENDED', reason: data.reason, cascadedBindings: bindings },
      actorId: viewer.principal.id,
      tenantId: membership.tenantId,
      businessId: membership.businessId,
      reason: data.reason,
      beforeJson: { status: membership.status },
      afterJson: { status: 'SUSPENDED' },
    })
    await revokeSessionsIfStranded(tx, membership.personId, viewer.principal.id, data.reason)
    return { ...updated, cascadedBindings: bindings }
  })
}

export async function reinstateMembership(input, { db = prisma, resolve = resolveViewer } = {}) {
  const data = zTransition.parse(input)
  const viewer = await ownerViewerFor(resolve, db)
  const membership = await loadGrant(db, data.membershipId, viewer)

  // REVOKED is terminal on purpose. A revoked grant is the evidence that access
  // existed and ended; resurrecting the row would overwrite that record and
  // produce a grant whose `revokedAt` and `status` disagree. Granting again is a
  // new row with its own provenance, which the partial unique indexes allow
  // precisely because they exclude REVOKED.
  if (membership.status === 'REVOKED') throw failure(409, 'REVOKED_IS_TERMINAL')
  if (membership.status === 'ACTIVE') throw failure(409, 'ALREADY_ACTIVE')

  return db.$transaction(async (tx) => {
    const updated = await tx.membership.update({
      where: { id: membership.id },
      data: { status: 'ACTIVE', suspendedAt: null, version: { increment: 1 } },
    })
    // Only what this membership's suspension took down.
    const restored = await tx.roleBinding.findMany({
      where: { cascadeOfMembershipId: membership.id, status: 'SUSPENDED' },
      select: { id: true, roleKey: true, businessId: true },
    })
    if (restored.length) {
      await tx.roleBinding.updateMany({
        where: { id: { in: restored.map((binding) => binding.id) } },
        data: { status: 'ACTIVE', cascadeOfMembershipId: null },
      })
      for (const binding of restored) {
        await recordAudit(tx, {
          entityType: 'ROLE_BINDING', entityId: binding.id, action: 'ROLE_BINDING_REACTIVATED',
          payload: { roleKey: binding.roleKey, cascadeOfMembershipId: membership.id, reason: data.reason },
          actorId: viewer.principal.id,
          tenantId: membership.tenantId,
          businessId: binding.businessId,
          reason: data.reason,
          beforeJson: { status: 'SUSPENDED' },
          afterJson: { status: 'ACTIVE' },
        })
      }
    }
    await recordAudit(tx, {
      entityType: 'MEMBERSHIP', entityId: membership.id, action: 'MEMBERSHIP_REINSTATED',
      payload: { from: membership.status, to: 'ACTIVE', reason: data.reason, restoredBindings: restored.map((b) => b.id) },
      actorId: viewer.principal.id,
      tenantId: membership.tenantId,
      businessId: membership.businessId,
      reason: data.reason,
      beforeJson: { status: membership.status },
      afterJson: { status: 'ACTIVE' },
    })
    return { ...updated, restoredBindings: restored.map((binding) => binding.id) }
  })
}

export async function revokeMembership(input, { db = prisma, resolve = resolveViewer } = {}) {
  const data = zTransition.extend({ allowLast: z.boolean().optional() }).parse(input)
  const viewer = await ownerViewerFor(resolve, db)
  const membership = await loadGrant(db, data.membershipId, viewer)

  if (membership.status === 'REVOKED') throw failure(409, 'ALREADY_REVOKED')
  await assertNotLastOwner(db, membership, viewer, { allowLast: data.allowLast === true })

  return db.$transaction(async (tx) => {
    const updated = await tx.membership.update({
      where: { id: membership.id },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedByPersonId: viewer.principal.id,
        revokeReason: data.reason,
        version: { increment: 1 },
      },
    })
    const bindings = await cascadeBindings(tx, membership, 'REVOKED', {
      actorId: viewer.principal.id, reason: data.reason,
    })
    await recordAudit(tx, {
      entityType: 'MEMBERSHIP', entityId: membership.id, action: 'MEMBERSHIP_REVOKED',
      payload: {
        from: membership.status, to: 'REVOKED', reason: data.reason,
        personId: membership.personId, businessId: membership.businessId,
        scopeType: membership.scopeType, role: membership.role, cascadedBindings: bindings,
      },
      actorId: viewer.principal.id,
      tenantId: membership.tenantId,
      businessId: membership.businessId,
      reason: data.reason,
      beforeJson: { status: membership.status },
      afterJson: { status: 'REVOKED' },
    })
    await revokeSessionsIfStranded(tx, membership.personId, viewer.principal.id, data.reason)
    return { ...updated, cascadedBindings: bindings }
  })
}

/**
 * Withdraw every grant this person holds in one Tenant, in one transaction.
 *
 * Two shapes of audit event are written deliberately. `PERSON/OFFBOARDED`
 * answers "what happened to this person"; the per-grant events answer "what
 * happened to this grant". An auditor asks the first and a debugger asks the
 * second, and deriving either from the other is work neither should have to do.
 */
export async function offboardPerson(input, { db = prisma, resolve = resolveViewer } = {}) {
  const data = zOffboard.parse(input)
  const viewer = await ownerViewerFor(resolve, db)
  // Tenant-wide authority, because offboarding crosses every Business in it.
  // A Business owner revokes the grants they own, one at a time, with
  // `revokeMembership`.
  if (!ownsTenant(viewer, data.tenantId)) throw notFound()

  return db.$transaction(async (tx) => {
    const grants = await tx.membership.findMany({
      where: { personId: data.personId, tenantId: data.tenantId, status: { in: LIVE } },
      select: { id: true, businessId: true, scopeType: true, role: true, status: true },
    })
    const now = new Date()
    for (const grant of grants) {
      await tx.membership.update({
        where: { id: grant.id },
        data: {
          status: 'REVOKED', revokedAt: now, revokedByPersonId: viewer.principal.id,
          revokeReason: data.reason, version: { increment: 1 },
        },
      })
      await recordAudit(tx, {
        entityType: 'MEMBERSHIP', entityId: grant.id, action: 'MEMBERSHIP_REVOKED',
        payload: { from: grant.status, to: 'REVOKED', reason: data.reason, via: 'OFFBOARD', businessId: grant.businessId, role: grant.role },
        actorId: viewer.principal.id,
        tenantId: data.tenantId,
        businessId: grant.businessId,
        reason: data.reason,
        beforeJson: { status: grant.status },
        afterJson: { status: 'REVOKED' },
      })
    }

    const bindings = await tx.roleBinding.findMany({
      where: { personId: data.personId, tenantId: data.tenantId, status: { in: LIVE } },
      select: { id: true, roleKey: true, businessId: true },
    })
    if (bindings.length) {
      await tx.roleBinding.updateMany({
        where: { id: { in: bindings.map((binding) => binding.id) } },
        data: { status: 'REVOKED', revokedAt: now },
      })
      for (const binding of bindings) {
        await recordAudit(tx, {
          entityType: 'ROLE_BINDING', entityId: binding.id, action: 'ROLE_BINDING_REVOKED',
          payload: { roleKey: binding.roleKey, businessId: binding.businessId, reason: data.reason, via: 'OFFBOARD' },
          actorId: viewer.principal.id,
          tenantId: data.tenantId,
          businessId: binding.businessId,
          reason: data.reason,
          beforeJson: { status: 'ACTIVE' },
          afterJson: { status: 'REVOKED' },
        })
      }
    }

    const sessions = await revokeSessionsIfStranded(tx, data.personId, viewer.principal.id, data.reason)

    await recordAudit(tx, {
      entityType: 'PERSON', entityId: data.personId, action: 'OFFBOARDED',
      payload: {
        tenantId: data.tenantId, reason: data.reason,
        revokedMemberships: grants.map((grant) => grant.id),
        revokedBindings: bindings.map((binding) => binding.id),
        revokedSessions: sessions,
      },
      tenantId: data.tenantId,
      reason: data.reason,
      actorId: viewer.principal.id,
    })

    return {
      personId: data.personId,
      tenantId: data.tenantId,
      revokedMemberships: grants.map((grant) => grant.id),
      revokedBindings: bindings.map((binding) => binding.id),
      revokedSessions: sessions,
    }
  })
}

/**
 * Every grant a person holds, in every state — the read an offboarding decision
 * and an access review both start from, and which no surface could answer
 * before. Authority: yourself, a tenant owner, or an installation operator.
 */
export async function listPersonAccess({ personId, tenantId } = {}, { db = prisma, resolve = resolveViewer } = {}) {
  const viewer = await resolve({ db })
  const isSelf = viewer.principal.id === personId
  if (!isSelf && !viewer.isPlatform && !(tenantId && ownsTenant(viewer, tenantId))) throw notFound()

  const where = { personId, ...(tenantId ? { tenantId } : {}) }
  const [memberships, roleBindings] = await Promise.all([
    db.membership.findMany({
      where,
      select: {
        id: true, tenantId: true, businessId: true, scopeType: true, role: true, status: true,
        domainKeysJson: true, grantedByPersonId: true, grantReason: true, grantSource: true,
        expiresAt: true, suspendedAt: true, revokedAt: true, revokedByPersonId: true, revokeReason: true,
        createdAt: true,
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    }),
    db.roleBinding.findMany({
      where,
      select: { id: true, tenantId: true, businessId: true, roleKey: true, status: true, assignedBy: true, revokedAt: true },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    }),
  ])
  return { personId, memberships, roleBindings }
}

export { LIVE as LIVE_MEMBERSHIP_STATUSES }
