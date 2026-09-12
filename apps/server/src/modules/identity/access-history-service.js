// @req FR-199 — a Business owner can read the access history of their own
//   scope. `GET /api/audit` is operator-only and `listAudit` filters on
//   `entityType`/`entityId` alone, so an OWNER could not see who was granted
//   access to their own Business, when, or by whom — the access review every
//   other part of ADR-077's design assumes is possible had no read model.
// @spec ADR-080 D3/D4, BR-036, SDD-095, SEC-001, SEC-003, SEC-028 — authorized
//   exactly like the grant it describes: `ownsBusiness`, `ownsTenant`, self, or
//   the installation operator, with the identical 404 for an unowned scope and
//   a nonexistent one, so this read cannot become an id oracle over another
//   tenant or business.
// @tested tests/unit/access-history-service.test.js,
//   tests/integration/fr198-fr199-audit-access-evidence.test.js
import prisma from '@/lib/db'
import { resolveViewer } from './resolve-viewer'
import { ownsBusiness, ownsTenant, isInstallationOperator } from './viewer-authority'
import { AUDIT_MAX_LIMIT, safeParse } from '@/modules/project-manager/application/audit'

/**
 * The audit `entityType` families this read answers for. `ACCESS_INVITE`
 * writes nothing today — no invite flow exists yet — and is listed so the
 * query needs no change the day one does (ADR-080 D4).
 */
const ACCESS_ENTITY_TYPES = ['MEMBERSHIP', 'ROLE_BINDING', 'ACCESS_INVITE']

/**
 * `PERSON` actions that are about *access*, not about profile or credential
 * housekeeping. `PASSWORD_RESET_MINTED/COMPLETED` and `PROFILE_COMPLETED/UPDATED`
 * are deliberately excluded — they are the same entityType but a different
 * question ("who is this person", not "what could this person reach").
 *
 * Only `OFFBOARDED` carries `tenantId` as a column today (it is written from
 * `membership-lifecycle-service.js`, this change's own file); the other three
 * are written from files this change does not touch (`operator-bootstrap.js`,
 * `signup-service.js`) and are matched by `entityId = personId` instead, which
 * is why they are usable for a personId-scoped query but not for a
 * Business/Tenant-scoped one below.
 */
const ACCESS_PERSON_ACTIONS = ['OFFBOARDED', 'OPERATOR_BOOTSTRAPPED', 'OPERATOR_GRANT_REVOKED', 'ACCOUNT_SELF_CREATED']

// Only the subset of ACCESS_PERSON_ACTIONS this change's own writers stamp
// with a tenantId column. See the comment above.
const TENANT_COLUMNED_PERSON_ACTIONS = ['OFFBOARDED']

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

// 404-shaped and byte-identical for "you do not own this scope" and "no such
// scope", because the alternative is an oracle over other tenants'/businesses'
// ids (SEC-001) — the same refusal `membership-lifecycle-service.js` uses.
function notFound() {
  return failure(404, 'Access history is outside your owned scope')
}

async function actorsFor(db, actorIds) {
  const ids = [...new Set(actorIds.filter(Boolean))]
  if (!ids.length) return new Map()
  const people = await db.person.findMany({
    where: { id: { in: ids } },
    select: { id: true, code: true, displayName: true },
  })
  return new Map(people.map((person) => [person.id, person]))
}

function projectEvent(event, actorsById) {
  return {
    id: event.id,
    entityType: event.entityType,
    entityId: event.entityId,
    action: event.action,
    occurredAt: event.occurredAt,
    tenantId: event.tenantId,
    businessId: event.businessId,
    reason: event.reason,
    before: safeParse(event.beforeJson, null),
    after: safeParse(event.afterJson, null),
    payload: safeParse(event.payloadJson),
    // A human reads a name; the key stays a UUID (CLAUDE.md — actorId is a
    // UUID and stays one, stable across a rename and across PDPA redaction).
    actor: event.actorId ? actorsById.get(event.actorId) ?? { id: event.actorId, code: null, displayName: null } : null,
  }
}

/**
 * Events in the MEMBERSHIP, ROLE_BINDING, ACCESS_INVITE and access-related
 * PERSON families for one scope — a Business, a Tenant, or one person's own
 * history — with the actor joined to `{ id, code, displayName }`.
 *
 * Authority: `ownsBusiness` for a Business, `ownsTenant` for a Tenant,
 * yourself for your own history, or an installation operator. Refuses
 * 404-shaped for a scope the caller does not own, byte-identical to a scope
 * that does not exist.
 *
 * Exactly one of `businessId`, `tenantId`, `personId` is accepted — a query
 * naming more than one scope has no single answer for "whose history is
 * this", and one naming none is every event in the system, which is
 * `listAudit`'s job (operator-only) and not this one's.
 */
export async function listAccessHistory({ businessId, tenantId, personId, limit = 100 } = {}, { db = prisma, resolve = resolveViewer } = {}) {
  const viewer = await resolve({ db })
  const scopesGiven = [businessId, tenantId, personId].filter(Boolean).length
  if (scopesGiven !== 1) throw failure(400, 'EXACTLY_ONE_SCOPE_REQUIRED')

  const operator = isInstallationOperator(viewer)
  const effective = Math.min(Number(limit) || 100, AUDIT_MAX_LIMIT)

  let where
  if (businessId) {
    if (!operator && !ownsBusiness(viewer, businessId)) throw notFound()
    where = {
      OR: [
        { entityType: { in: ACCESS_ENTITY_TYPES }, businessId },
        { entityType: 'PERSON', action: { in: TENANT_COLUMNED_PERSON_ACTIONS }, businessId },
      ],
    }
  } else if (tenantId) {
    if (!operator && !ownsTenant(viewer, tenantId)) throw notFound()
    where = {
      OR: [
        { entityType: { in: ACCESS_ENTITY_TYPES }, tenantId },
        { entityType: 'PERSON', action: { in: TENANT_COLUMNED_PERSON_ACTIONS }, tenantId },
      ],
    }
  } else {
    const isSelf = viewer.principal?.id === personId
    if (!operator && !isSelf) throw notFound()
    // No tenantId/businessId column to filter on for a person scope — a
    // Membership's own entityId is the grant's id, not the person's, so the
    // matching ids are read from the relational rows themselves rather than
    // by scanning payloadJson (the exact defect FR-198 exists to stop).
    const [memberships, bindings] = await Promise.all([
      db.membership.findMany({ where: { personId }, select: { id: true } }),
      db.roleBinding.findMany({ where: { personId }, select: { id: true } }),
    ])
    where = {
      OR: [
        { entityType: 'MEMBERSHIP', entityId: { in: memberships.map((m) => m.id) } },
        { entityType: 'ROLE_BINDING', entityId: { in: bindings.map((b) => b.id) } },
        { entityType: 'ACCESS_INVITE', entityId: personId },
        { entityType: 'PERSON', entityId: personId, action: { in: ACCESS_PERSON_ACTIONS } },
      ],
    }
  }

  // One more than requested: enough to know a next row exists, without
  // counting a table that only grows (the same convention `listAudit` uses).
  const rows = await db.auditEvent.findMany({
    where,
    orderBy: { occurredAt: 'desc' },
    take: effective + 1,
  })
  const page = rows.slice(0, effective)
  const actorsById = await actorsFor(db, page.map((event) => event.actorId))

  return {
    businessId: businessId ?? null,
    tenantId: tenantId ?? null,
    personId: personId ?? null,
    events: page.map((event) => projectEvent(event, actorsById)),
    limit: effective,
    truncated: rows.length > effective,
  }
}

/**
 * Every grant in one Business, in every status — the "who has access right
 * now, and who gave it to them" table no surface could produce before this.
 * Unlike `listAccessHistory`, this is current state, not the event stream:
 * a revoked grant's row still carries its `revokedAt`/`revokeReason`, which is
 * exactly the provenance ADR-077 D1 put on the row for this reason.
 *
 * Authority: `ownsBusiness`, which already covers a tenant-wide owner —
 * `resolveViewer` expands a TENANT-scoped OWNER grant into every Business's
 * `ownedBusinessIds` (ADR-077, `viewer-authority.js`) — or an installation
 * operator.
 */
export async function listBusinessAccess({ businessId } = {}, { db = prisma, resolve = resolveViewer } = {}) {
  if (!businessId) throw failure(400, 'BUSINESS_ID_REQUIRED')
  const viewer = await resolve({ db })
  if (!isInstallationOperator(viewer) && !ownsBusiness(viewer, businessId)) throw notFound()

  const grants = await db.membership.findMany({
    where: { businessId },
    select: {
      id: true,
      personId: true,
      role: true,
      status: true,
      scopeType: true,
      domainKeysJson: true,
      grantedByPersonId: true,
      grantReason: true,
      grantSource: true,
      expiresAt: true,
      suspendedAt: true,
      revokedAt: true,
      revokedByPersonId: true,
      revokeReason: true,
      createdAt: true,
      person: { select: { id: true, code: true, displayName: true } },
      grantedBy: { select: { id: true, code: true, displayName: true } },
      revokedBy: { select: { id: true, code: true, displayName: true } },
    },
    // Live grants first, most recently created first within a status — the
    // shape an access review reads top to bottom.
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  })

  return {
    businessId,
    grants: grants.map((grant) => ({ ...grant, domainKeys: safeParse(grant.domainKeysJson, []) })),
  }
}
