// @req FR-195 — AccessInvite generalises WorkspaceInvite (FR-067) to all three
//   authority layers this installation has: PORTFOLIO (Workspace collaboration,
//   BR-016 — delegates to workspace-membership-service.js, which already owns
//   that exact discipline), TENANT and BUSINESS (a real Membership grant on
//   acceptance, created the one way `Membership` may be created —
//   `grantBusinessMembership`, ADR-077 D8). Keeps WorkspaceInvite's exact
//   discipline: SHA-256 token hash never stored raw, one-use atomic acceptance,
//   one generic refusal for every failure mode so the endpoint is not an oracle.
// @spec BR-016, SEC-014, SDD-094, ADR-077 D8, ADR-079
// @tested tests/integration/fr195-access-invite.test.js
import { randomBytes } from 'node:crypto'
import prisma from '@/lib/db'
import { DOMAINS } from '@/config/domains'
import { ACCESS_INVITE_ROLES, ACCESS_INVITE_SCOPE_TYPES, WORKSPACE_INVITE_ROLES } from '@/lib/validation/enums'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { ownsBusiness, ownsTenant } from './viewer-authority'
import { grantBusinessMembership } from './membership-grant-service'
import {
  acceptWorkspaceInvite,
  assertWorkspaceAdminAuthority,
  hashWorkspaceInviteToken,
  WORKSPACE_INVITE_TTL_MS,
} from './workspace-membership-service'

const DOMAIN_KEYS = DOMAINS.map((domain) => domain.key)
export const ACCESS_INVITE_TTL_MS = WORKSPACE_INVITE_TTL_MS

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

/** Same discipline as workspace-membership-service.js's GENERIC_INVITE_REFUSAL:
 * one answer for unknown, replayed, revoked, expired and wrong-target, so a
 * probe cannot tell which guess landed. */
const GENERIC_INVITE_REFUSAL = 'INVALID_OR_EXPIRED_INVITE'

/**
 * Authority to mint or revoke an invite at the named scope. Three different
 * predicates for three different scopes, on purpose (mirroring
 * `grantBusinessMembership`'s own "authority is the caller's problem" stance
 * one level up): PORTFOLIO reuses the exact FR-067 Workspace-admin check
 * (an ACTIVE OWNER WorkspaceMembership, or ownership of a Tenant under it);
 * TENANT needs `ownsTenant`; BUSINESS needs `ownsBusiness`, and derives its
 * `tenantId` from the Business row itself rather than trusting a
 * separately-supplied one. Every refusal is the same 404 an absent scope
 * produces (ADR-027 D9 / FR-072), so a caller can never learn a hidden scope
 * exists by probing this function.
 */
async function assertScopeAuthority({ viewer, scopeType, portfolioId, tenantId, businessId, db }) {
  if (scopeType === 'PORTFOLIO') {
    await assertWorkspaceAdminAuthority(viewer, portfolioId, db)
    return { portfolioId, tenantId: null, businessId: null }
  }
  if (scopeType === 'TENANT') {
    if (!ownsTenant(viewer, tenantId)) throw failure(404, 'Tenant not found')
    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })
    if (!tenant) throw failure(404, 'Tenant not found')
    return { portfolioId: null, tenantId, businessId: null }
  }
  // BUSINESS
  if (!ownsBusiness(viewer, businessId)) throw failure(404, 'Business not found')
  const business = await db.business.findUnique({ where: { id: businessId }, select: { id: true, tenantId: true } })
  if (!business) throw failure(404, 'Business not found')
  return { portfolioId: null, tenantId: business.tenantId, businessId: business.id }
}

/**
 * Role vocabulary is scope-dependent: PORTFOLIO scope keeps WorkspaceMembership's
 * own ADMIN/MEMBER vocabulary (unchanged from FR-067); TENANT/BUSINESS scope
 * becomes a real Membership, whose role vocabulary is OWNER/MEMBER with OWNER
 * always refused by a token — so only MEMBER survives (ACCESS_INVITE_ROLES).
 */
function assertRoleAllowed(scopeType, role) {
  if (role === 'OWNER') throw failure(400, 'INVITE_ROLE_NOT_ALLOWED')
  const allowed = scopeType === 'PORTFOLIO' ? WORKSPACE_INVITE_ROLES : ACCESS_INVITE_ROLES
  if (!allowed.includes(role)) throw failure(400, 'INVITE_ROLE_NOT_ALLOWED')
}

/**
 * Mint a single-use, expiring invite bound to exactly one scope. The server
 * decides the target scope's shape, the inviter's authority and expiry; the
 * requested role is validated against the scope's own vocabulary so a token
 * can never mint OWNER at any scope. The raw token is returned exactly once,
 * to this authenticated caller, for out-of-band handover.
 */
export async function mintAccessInvite({
  viewer,
  scopeType,
  portfolioId = null,
  tenantId = null,
  businessId = null,
  role = 'MEMBER',
  targetPersonId = null,
  invitedEmail = null,
  // @req FR-195 — LINE-first intake: name the person who messaged the OA by
  // their channel identity when they have no email on file yet.
  invitedLineUserId = null,
  reason = null,
  domainKeys = [],
  db = prisma,
  now = Date.now(),
} = {}) {
  if (!ACCESS_INVITE_SCOPE_TYPES.includes(scopeType)) throw failure(400, 'ACCESS_INVITE_SCOPE_INVALID')
  assertRoleAllowed(scopeType, role)

  const scope = await assertScopeAuthority({ viewer, scopeType, portfolioId, tenantId, businessId, db })

  const hasAddressee = Boolean(targetPersonId) || Boolean(invitedEmail) || Boolean(invitedLineUserId)
  if (!hasAddressee) throw failure(400, 'ACCESS_INVITE_ADDRESSEE_REQUIRED')

  if (targetPersonId != null) {
    if (typeof targetPersonId !== 'string' || !targetPersonId.trim()) throw failure(400, 'TARGET_PERSON_INVALID')
    const target = await db.person.findUnique({ where: { id: targetPersonId }, select: { id: true } })
    if (!target) throw failure(404, 'Person not found')
  }
  const email = typeof invitedEmail === 'string' && invitedEmail.trim() ? invitedEmail.trim().toLowerCase() : null
  const lineUserId = typeof invitedLineUserId === 'string' && invitedLineUserId.trim() ? invitedLineUserId.trim() : null
  const domains = Array.isArray(domainKeys) ? domainKeys.filter((key) => DOMAIN_KEYS.includes(key)) : []

  const raw = randomBytes(32).toString('hex')
  const expiresAt = new Date(now + ACCESS_INVITE_TTL_MS)

  const invite = await db.accessInvite.create({
    data: {
      scopeType,
      portfolioId: scope.portfolioId,
      tenantId: scope.tenantId,
      businessId: scope.businessId,
      invitedByPersonId: viewer.principal.id,
      targetPersonId: targetPersonId || null,
      invitedEmail: email,
      invitedLineUserId: lineUserId,
      role,
      domainKeysJson: JSON.stringify(domains),
      reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
      status: 'PENDING',
      tokenHash: hashWorkspaceInviteToken(raw),
      expiresAt,
    },
  })

  await recordAudit(db, {
    entityType: 'ACCESS_INVITE',
    entityId: invite.id,
    action: 'ACCESS_INVITE_MINTED',
    actorId: viewer.principal.id,
    // No token material in any form.
    payload: {
      scopeType, portfolioId: scope.portfolioId, tenantId: scope.tenantId, businessId: scope.businessId,
      role, domainKeys: domains, targetPersonId: targetPersonId || null, expiresAt: expiresAt.toISOString(),
    },
  })

  return {
    inviteId: invite.id,
    inviteToken: raw,
    scopeType,
    portfolioId: scope.portfolioId,
    tenantId: scope.tenantId,
    businessId: scope.businessId,
    role,
    expiresAt: expiresAt.toISOString(),
  }
}

/**
 * Accept an invite: burn the token and, at TENANT/BUSINESS scope, create the
 * Membership it promised in the same transaction. PORTFOLIO scope delegates
 * to `acceptWorkspaceInvite`, which already owns that exact WorkspaceMembership
 * discipline (BR-016) — this function does not re-implement it.
 *
 * `personId` is the trusted SESSION accepting the invite, never resolved from
 * `invitedEmail` — `Person.email` gained a unique index on this branch, but
 * resolving an invite by email at acceptance time binds the grant to whichever
 * account currently holds that address, not to the person actually accepting
 * it. `invitedEmail`/`invitedLineUserId` only route the link to a person; the
 * Membership binds to `personId` regardless of what the email column does.
 */
export async function acceptAccessInvite({ token, personId, db = prisma, now = Date.now() } = {}) {
  if (typeof token !== 'string' || !token || typeof personId !== 'string' || !personId) {
    throw failure(400, GENERIC_INVITE_REFUSAL)
  }

  const invite = await db.accessInvite.findUnique({ where: { tokenHash: hashWorkspaceInviteToken(token) } })
  if (!invite || invite.status !== 'PENDING' || invite.expiresAt <= new Date(now)) {
    throw failure(400, GENERIC_INVITE_REFUSAL)
  }
  if (invite.scopeType === 'PORTFOLIO') return acceptWorkspaceInvite({ token, personId, db, now })

  if (invite.targetPersonId && invite.targetPersonId !== personId) {
    throw failure(400, GENERIC_INVITE_REFUSAL)
  }
  const person = await db.person.findUnique({ where: { id: personId }, select: { id: true } })
  if (!person) throw failure(400, GENERIC_INVITE_REFUSAL)

  return db.$transaction(async (tx) => {
    const claimed = await tx.accessInvite.updateMany({
      where: { id: invite.id, status: 'PENDING' },
      data: { status: 'ACCEPTED', acceptedAt: new Date(now), acceptedByPersonId: personId },
    })
    if (claimed.count !== 1) throw failure(400, GENERIC_INVITE_REFUSAL)

    const domainKeys = invite.domainKeysJson ? JSON.parse(invite.domainKeysJson) : []
    // The ONE creation path (ADR-077 D8) — this file never writes
    // `membership.create` itself, so the preflight ratchet that keeps that
    // call inside identity's own writer is never at risk of a second shape.
    const membership = await grantBusinessMembership({
      personId,
      tenantId: invite.tenantId,
      businessId: invite.scopeType === 'BUSINESS' ? invite.businessId : null,
      scopeType: invite.scopeType,
      role: invite.role,
      domainKeys,
      grantSource: 'INVITE',
      reason: invite.reason ?? null,
      actorId: invite.invitedByPersonId,
      action: 'MEMBERSHIP_GRANTED',
    }, { db: tx })

    await tx.accessInvite.update({ where: { id: invite.id }, data: { acceptedMembershipId: membership.id } })

    await recordAudit(tx, {
      entityType: 'ACCESS_INVITE',
      entityId: invite.id,
      action: 'ACCESS_INVITE_ACCEPTED',
      actorId: personId,
      payload: { scopeType: invite.scopeType, tenantId: invite.tenantId, businessId: invite.businessId, role: invite.role, membershipId: membership.id },
    })

    return {
      inviteId: invite.id,
      scopeType: invite.scopeType,
      tenantId: invite.tenantId,
      businessId: invite.businessId,
      role: invite.role,
      status: 'ACCEPTED',
      membershipId: membership.id,
    }
  })
}

/**
 * Decline a targeted invite. Same generic refusal discipline as acceptance;
 * DECLINED is a status WorkspaceInvite had no way to express (it only had
 * PENDING/ACCEPTED/REVOKED) — an addressee who actively turns an invite down
 * leaves a different trace than one who lets it expire.
 */
export async function declineAccessInvite({ token, personId, db = prisma, now = Date.now() } = {}) {
  if (typeof token !== 'string' || !token || typeof personId !== 'string' || !personId) {
    throw failure(400, GENERIC_INVITE_REFUSAL)
  }
  const invite = await db.accessInvite.findUnique({ where: { tokenHash: hashWorkspaceInviteToken(token) } })
  if (!invite || invite.status !== 'PENDING' || invite.expiresAt <= new Date(now)) {
    throw failure(400, GENERIC_INVITE_REFUSAL)
  }
  if (invite.targetPersonId && invite.targetPersonId !== personId) {
    throw failure(400, GENERIC_INVITE_REFUSAL)
  }

  const declined = await db.accessInvite.updateMany({
    where: { id: invite.id, status: 'PENDING' },
    data: { status: 'DECLINED', acceptedAt: new Date(now), acceptedByPersonId: personId },
  })
  if (declined.count !== 1) throw failure(400, GENERIC_INVITE_REFUSAL)

  await recordAudit(db, {
    entityType: 'ACCESS_INVITE',
    entityId: invite.id,
    action: 'ACCESS_INVITE_DECLINED',
    actorId: personId,
    payload: { scopeType: invite.scopeType, tenantId: invite.tenantId, businessId: invite.businessId },
  })
  return { inviteId: invite.id, status: 'DECLINED' }
}

/**
 * Revoke a PENDING invite. Same authority as mint, evaluated against the
 * invite's OWN stored scope (never a caller-supplied one) — a revoked token
 * fails the next acceptance with the generic refusal.
 */
export async function revokeAccessInvite({ viewer, inviteId, db = prisma, now = Date.now() } = {}) {
  if (typeof inviteId !== 'string' || !inviteId) throw failure(404, 'Invite not found')
  const invite = await db.accessInvite.findUnique({
    where: { id: inviteId },
    select: { id: true, scopeType: true, portfolioId: true, tenantId: true, businessId: true, status: true },
  })
  if (!invite) throw failure(404, 'Invite not found')
  await assertScopeAuthority({
    viewer, scopeType: invite.scopeType, portfolioId: invite.portfolioId, tenantId: invite.tenantId, businessId: invite.businessId, db,
  })

  const revoked = await db.accessInvite.updateMany({
    where: { id: invite.id, status: 'PENDING' },
    data: { status: 'REVOKED', revokedAt: new Date(now), revokedByPersonId: viewer.principal.id },
  })
  if (revoked.count !== 1) throw failure(409, 'INVITE_NOT_PENDING')

  await recordAudit(db, {
    entityType: 'ACCESS_INVITE',
    entityId: invite.id,
    action: 'ACCESS_INVITE_REVOKED',
    actorId: viewer.principal.id,
    payload: { scopeType: invite.scopeType, tenantId: invite.tenantId, businessId: invite.businessId },
  })
  return { inviteId: invite.id, status: 'REVOKED' }
}
