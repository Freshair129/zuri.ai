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

// @req FR-038 — the same owner authority that edits a Membership's role and
// domains also attaches an existing Person to a Business as MEMBER. One
// identifier field, matched EXACTLY against `Person.code` or `Person.email`:
// no prefix, no contains, no case folding, because a fuzzy people-search on an
// administrative surface is a directory-enumeration tool wearing an invite
// form's clothes.
const zMembershipInvite = z.object({
  businessId: z.string().min(1),
  identifier: z.string().trim().min(1),
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
  return { ...viewer, identities, session: { type: 'AUTHENTICATED', active: true } }
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

/**
 * @req FR-038 — attach an EXISTING Person to a Business the caller owns, as an
 * ACTIVE MEMBER with a chosen subset of domain keys.
 *
 * This closes the one hole in the Membership lifecycle: every other path
 * produced a Membership only for the person performing it (FR-074(c) binds the
 * creator as OWNER of a Business they just made), so a second person could
 * never receive a first Business-level grant from any surface
 * (D3-identity-onboarding-forms-12). It lives here, beside
 * `updateUserPermissions`, because identity already administers Membership role
 * and domain grants at this seam — a second write path in another module is how
 * two rules for one row start to disagree.
 *
 * Deliberately NOT a Person creator. Signup (FR-120) and onboarding (FR-066)
 * own identity creation; an owner-facing form that quietly minted Persons would
 * be a second, unaudited account-creation surface. An identifier that matches
 * nothing is refused, never filled in.
 *
 * Role is fixed at MEMBER. Promotion to OWNER is `updateUserPermissions` — a
 * separate act with its own audit event, so "was given access" and "was made an
 * owner" never arrive in the stream as one indistinguishable row.
 */
export async function addBusinessMembership(input, { db = prisma, resolve = resolveViewer } = {}) {
  const data = zMembershipInvite.parse(input)
  const viewer = await ownerViewer(() => resolve({ db }))
  // Authority before existence, in that order and no other: an unowned Business
  // id and one that was never created answer identically, so this form is not a
  // Business-id oracle (SEC-001) and keeps the 404-shaped refusal the rest of
  // this surface already promises.
  assertMembershipBusinessOwned(data.businessId, viewer)
  const business = await db.business.findUnique({
    where: { id: data.businessId },
    select: { id: true, tenantId: true, code: true, name: true },
  })
  if (!business) {
    const error = new Error('Membership is outside your owned scope')
    error.status = 404
    throw error
  }

  const person = await db.person.findFirst({
    where: { OR: [{ code: data.identifier }, { email: data.identifier }] },
    select: { id: true, code: true, displayName: true },
  })
  // Distinct from the scope refusal above on purpose: by the time execution
  // reaches here the caller has already proven ownership of this Business, so
  // "no such person" discloses nothing they could not read off the roster in
  // front of them — and an owner typing a colleague's code needs to know
  // whether the miss was the code or their own authority.
  if (!person) {
    const error = new Error('PERSON_NOT_FOUND')
    error.status = 404
    throw error
  }

  // Any status, not only ACTIVE. A revoked row is still this Person's
  // Membership of this Business; creating a second one beside it would leave
  // two rows for one grant, and `resolveViewer` reads them all.
  const existing = await db.membership.findFirst({
    where: { personId: person.id, businessId: business.id },
    select: { id: true },
  })
  if (existing) {
    const error = new Error('MEMBERSHIP_ALREADY_EXISTS')
    error.status = 409
    throw error
  }

  const created = await db.membership.create({
    data: {
      personId: person.id,
      tenantId: business.tenantId,
      businessId: business.id,
      role: 'MEMBER',
      status: 'ACTIVE',
      domainKeysJson: JSON.stringify(data.domainKeys),
    },
  })
  await recordAudit(db, {
    entityType: 'MEMBERSHIP',
    entityId: created.id,
    action: 'MEMBERSHIP_ADDED',
    payload: {
      businessId: business.id,
      personId: person.id,
      role: 'MEMBER',
      domainKeys: data.domainKeys,
    },
    actorId: viewer.principal.id,
  })
  // Shaped exactly like a `listUserPermissions` row, so the page can render the
  // result without a second row shape to keep in step. No `email`, for the same
  // reason the list omits it.
  return {
    ...created,
    domainKeys: data.domainKeys,
    manageable: true,
    person,
    business: { id: business.id, code: business.code, name: business.name },
  }
}
