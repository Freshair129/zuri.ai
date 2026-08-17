// @req FR-038 — profile read and owner-governed Membership role/domain grants.
// @spec SDD-017, SEC-003, docs/features/FR-038-profile-and-permissions.md
// @tested tests/unit/profile-permission-service.test.js
import prisma from '@/lib/db'
import { z } from 'zod'
import { DOMAINS } from '@/config/domains'
import { zMembershipRole } from '@/lib/validation/enums'
import { resolveViewer } from './resolve-viewer'
import { ownsBusiness } from './viewer-authority'
import { recordAudit } from '@/modules/project-manager/application/audit'

const DOMAIN_KEYS = DOMAINS.map((domain) => domain.key)
const zPermissionUpdate = z.object({
  membershipId: z.string().min(1),
  role: zMembershipRole,
  domainKeys: z.array(z.enum(DOMAIN_KEYS)).default([]),
})

function parseDomainKeys(json) {
  try {
    const keys = JSON.parse(json || '[]')
    return Array.isArray(keys) ? keys.filter((key) => DOMAIN_KEYS.includes(key)) : []
  } catch {
    return []
  }
}

async function ownerViewer(resolve) {
  const viewer = await resolve()
  if (viewer.role !== 'OWNER') {
    const error = new Error('Owner permission is required')
    error.status = 403
    throw error
  }
  return viewer
}

// T3e FIX 1: `viewer.role === 'OWNER'` is a global per-principal label — OWNER
// of any single Business gets role 'OWNER' everywhere (resolve-viewer.js) —
// so `ownerViewer` above only screens out a principal who owns *no* Business
// at all (a pure MEMBER, or a platform DEV grant, which never gets
// ownedBusinessIds). It still does not prove the target Membership's
// Business is one this OWNER actually owns, so it is kept only as a coarse,
// cheap pre-filter ahead of the DB lookup — every write below it still needs
// the per-Business check.
//
// A principal who is OWNER of Business A and merely MEMBER of Business B has
// that global role AND Business B legitimately in visibleBusinessIds (the
// MEMBER Membership populates it), so the old gate here —
// `role === 'OWNER'` plus `visibleBusinessIds.includes(membership.businessId)`
// — let that principal self-promote to OWNER of Business B. Proven live
// against the database (T3e). `ownedBusinessIds` is the actual per-Business
// OWNER grant set and is always a subset of `visibleBusinessIds`
// (resolve-viewer.js), so checking it subsumes the old visibility check —
// which is why that check is replaced below, not kept alongside this one.
//
// Fails closed on a missing/malformed `ownedBusinessIds` rather than
// optional-chaining into `undefined` (which would fail *open*) — same
// discipline as `assertBusinessOwned` in
// project-manager/application/business-strategy-mutation-service.js (FR-059).
// A Membership with a null `businessId` (tenant-wide) can never be in
// `ownedBusinessIds` either, so a write to a tenant-wide Membership now also
// fails closed here, rather than skipping the check entirely as the old
// `membership.businessId && ...` guard did.
function assertMembershipBusinessOwned(businessId, viewer) {
  // Decision in one place (./viewer-authority); status and message stay here,
  // because 404 is what this surface has already promised its callers.
  if (!ownsBusiness(viewer, businessId)) {
    // Same status as the scope refusal it replaces, so the observable HTTP
    // status the platform users page sees is unchanged (404 via _helpers.js).
    const error = new Error('Membership is outside your owned scope')
    error.status = 404
    throw error
  }
}

export async function getMyProfile({ db = prisma, resolve = resolveViewer } = {}) {
  const viewer = await resolve({ db })
  const identities = await db.externalIdentity.findMany({
    where: { personId: viewer.principal.id, revokedAt: null },
    select: { provider: true, linkedAt: true, verifiedAt: true },
  })
  return { ...viewer, identities, session: { type: 'LOCAL_DEMO', active: true } }
}

// @req FR-062 — the list is scoped by the SAME field the write authorizes on,
// so a row it shows as editable cannot 404 on save.
// @spec SDD-035, BR-001, SEC-001 — a nullable `businessId` is never included by
// a bare OR; it is scoped by the caller's owned tenants.
// @tested tests/unit/fr062-permissions-read-scope.test.js
export async function listUserPermissions({ db = prisma, resolve = resolveViewer } = {}) {
  const viewer = await ownerViewer(() => resolve({ db }))
  // Same fail-closed handling as assertMembershipBusinessOwned: a missing or
  // malformed grant set returns nothing rather than falling through to a
  // wider query.
  const ownedBusinessIds = Array.isArray(viewer?.ownedBusinessIds) ? viewer.ownedBusinessIds.filter(Boolean) : []
  if (ownedBusinessIds.length === 0) return []

  // A tenant-wide Membership (`businessId: null`) belongs to a scope above
  // Business, so including it requires naming that scope. The previous
  // `{ businessId: null }` said "and also the tenant-wide ones" but scoped them
  // by nothing, returning every such row in every tenant.
  const ownedBusinesses = await db.business.findMany({
    where: { id: { in: ownedBusinessIds } },
    select: { tenantId: true },
  })
  const ownedTenantIds = [...new Set(ownedBusinesses.map((business) => business.tenantId).filter(Boolean))]

  const memberships = await db.membership.findMany({
    where: {
      OR: [
        { businessId: { in: ownedBusinessIds } },
        { businessId: null, tenantId: { in: ownedTenantIds } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    include: {
      // No `email`: the surface renders displayName and code, and personal data
      // with no consumer is a leak waiting for a second bug to matter.
      person: { select: { id: true, code: true, displayName: true } },
      business: { select: { id: true, code: true, name: true } },
    },
  })
  return memberships.map((membership) => ({
    ...membership,
    domainKeys: parseDomainKeys(membership.domainKeysJson),
    // The server states authority; the client must not infer it. Tenant-wide
    // rows are shown read-only rather than dropped, because a hidden grant is
    // worse than an unmanageable one on the page an OWNER visits to find out
    // who has access.
    manageable: ownedBusinessIds.includes(membership.businessId),
  }))
}

export async function updateUserPermissions(input, { db = prisma, resolve = resolveViewer } = {}) {
  const data = zPermissionUpdate.parse(input)
  const viewer = await ownerViewer(() => resolve({ db }))
  const membership = await db.membership.findUnique({ where: { id: data.membershipId } })
  if (!membership) {
    const error = new Error('Membership is outside your visible scope')
    error.status = 404
    throw error
  }
  assertMembershipBusinessOwned(membership.businessId, viewer)
  const updated = await db.membership.update({
    where: { id: membership.id },
    data: { role: data.role, domainKeysJson: JSON.stringify(data.domainKeys) },
  })
  await recordAudit(db, {
    entityType: 'MEMBERSHIP', entityId: membership.id, action: 'PERMISSIONS_UPDATED',
    payload: { role: data.role, domainKeys: data.domainKeys }, actorId: viewer.principal.id,
  })
  return { ...updated, domainKeys: data.domainKeys }
}
