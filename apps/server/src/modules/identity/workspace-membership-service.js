import { createHash, randomBytes } from 'node:crypto'
import prisma from '@/lib/db'
import { WORKSPACE_INVITE_ROLES } from '@/lib/validation/enums'
import { recordAudit } from '@/modules/project-manager/application/audit'

// @req FR-067 — an authorized Workspace/Tenant owner issues a scoped, expiring,
// single-use invite; acceptance creates a separate WorkspaceMembership that
// grants ONLY Workspace collaboration visibility. "Workspace" is the top-level
// container, keyed by `portfolioId` (ADR-027 §D2/D5) — never schema `Workspace`,
// which is a Space one level below Business.
// @spec BR-016 — WorkspaceMembership is a distinct authority layer:
// `resolveViewer` never reads it, so nothing here widens visibleBusinessIds,
// ownedBusinessIds or any domain grant. Tenant/Business/Space/Project access
// remains a separate server-authorized assignment (AC-067.5).
// @spec SEC-014 — invite tokens are single-use, expiring, hash-bound and
// audited (the FR-104 mint discipline): only the SHA-256 digest is stored, the
// raw token appears exactly once in the authenticated mint response, and every
// failure mode answers with one generic refusal so replay, revocation and
// expiry are indistinguishable to a guesser.
// @spec SDD-038
// @tested tests/unit/workspace-invite-service.test.js
// @tested tests/integration/workspace-onboarding-flow.test.js
// @tested tests/integration/workspace-collaboration-roster.test.js

export const WORKSPACE_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Invite tokens are stored hash-bound: the `WorkspaceInvite.tokenHash` column
 * holds this digest, never the raw secret (SEC-014). */
export function hashWorkspaceInviteToken(token) {
  if (typeof token !== 'string' || !token) throw new Error('INVITE_TOKEN_REQUIRED')
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

/** One generic refusal for every acceptance failure mode (unknown, replayed,
 * revoked, expired, wrong target). Distinguishing them tells an attacker which
 * guesses landed — the resetPassword precedent (SDD-054). */
const GENERIC_INVITE_REFUSAL = 'INVALID_OR_EXPIRED_INVITE'

/**
 * May this viewer administer the Workspace (Portfolio) — mint invites, revoke
 * them, remove members?
 *
 * Two authorities, per ADR-027 D6 ("Tenant Owner / Workspace Owner"):
 * an ACTIVE OWNER WorkspaceMembership on the Portfolio, or ownership of a
 * Tenant that lives under it (`viewer.ownedTenantIds`, the FR-074 grant).
 * Deliberately NOT satisfied by ADMIN membership, `viewer.role === 'OWNER'`
 * (a global label), Business ownership, or the installation operator — each is
 * a different scope of authority.
 *
 * Refuses with the same 404 an absent Workspace produces, so an authorization
 * error can never confirm that a hidden Workspace exists (ADR-027 D9).
 */
async function assertWorkspaceAdminAuthority(viewer, portfolioId, db) {
  const personId = viewer?.principal?.id
  if (typeof personId !== 'string' || !personId) throw failure(401, 'AUTH_REQUIRED')
  if (typeof portfolioId !== 'string' || !portfolioId) throw failure(404, 'Workspace not found')

  const ownerMembership = await db.workspaceMembership.findFirst({
    where: { portfolioId, personId, role: 'OWNER', status: 'ACTIVE' },
    select: { id: true },
  })
  if (ownerMembership) return

  const ownedTenantIds = Array.isArray(viewer?.ownedTenantIds) ? viewer.ownedTenantIds.filter(Boolean) : []
  if (ownedTenantIds.length) {
    const tenant = await db.tenant.findFirst({
      where: { id: { in: ownedTenantIds }, portfolioId },
      select: { id: true },
    })
    if (tenant) return
  }

  throw failure(404, 'Workspace not found')
}

/**
 * Mint a single-use, expiring invite bound to exactly one Workspace.
 *
 * The server decides the target Workspace, inviter authority, role and expiry;
 * the requested role is validated against WORKSPACE_INVITE_ROLES so a token can
 * never mint OWNER (AC-067.6). The raw token is returned exactly once, to this
 * authenticated caller, for out-of-band handover — never persisted or logged.
 */
export async function mintWorkspaceInvite({
  viewer,
  portfolioId,
  role = 'MEMBER',
  targetPersonId = null,
  invitedEmail = null,
  db = prisma,
  now = Date.now(),
} = {}) {
  await assertWorkspaceAdminAuthority(viewer, portfolioId, db)

  // Defense in depth beside the route's Zod enum: OWNER is refused even if a
  // future caller skips the boundary schema.
  if (!WORKSPACE_INVITE_ROLES.includes(role)) throw failure(400, 'INVITE_ROLE_NOT_ALLOWED')

  if (targetPersonId != null) {
    if (typeof targetPersonId !== 'string' || !targetPersonId.trim()) throw failure(400, 'TARGET_PERSON_INVALID')
    const target = await db.person.findUnique({ where: { id: targetPersonId }, select: { id: true } })
    if (!target) throw failure(404, 'Person not found')
  }
  const email = typeof invitedEmail === 'string' && invitedEmail.trim() ? invitedEmail.trim().toLowerCase() : null

  const raw = randomBytes(32).toString('hex')
  const expiresAt = new Date(now + WORKSPACE_INVITE_TTL_MS)

  const invite = await db.workspaceInvite.create({
    data: {
      portfolioId,
      invitedByPersonId: viewer.principal.id,
      targetPersonId: targetPersonId || null,
      invitedEmail: email,
      role,
      status: 'PENDING',
      tokenHash: hashWorkspaceInviteToken(raw),
      expiresAt,
    },
  })
  await recordAudit(db, {
    entityType: 'WORKSPACE_INVITE',
    entityId: invite.id,
    action: 'WORKSPACE_INVITE_MINTED',
    actorId: viewer.principal.id,
    // No token material in any form — the audit stream answers "who invited
    // whom into which Workspace, when", never "what was the secret".
    payload: { portfolioId, role, targetPersonId: targetPersonId || null, expiresAt: expiresAt.toISOString() },
  })

  return {
    inviteId: invite.id,
    inviteToken: raw,
    portfolioId,
    role,
    expiresAt: expiresAt.toISOString(),
  }
}

/**
 * Accept an invite: burn the token and create (or reactivate) an ACTIVE
 * WorkspaceMembership with the server-decided role, in one transaction.
 *
 * `personId` comes from the trusted session, never from the request body
 * (SEC-014 — the mutation fails closed without trusted identity). The claim is
 * an atomic PENDING→ACCEPTED updateMany, so a concurrent replay loses the race
 * instead of double-spending the token.
 */
export async function acceptWorkspaceInvite({ token, personId, db = prisma, now = Date.now() } = {}) {
  if (typeof token !== 'string' || !token || typeof personId !== 'string' || !personId) {
    throw failure(400, GENERIC_INVITE_REFUSAL)
  }

  const invite = await db.workspaceInvite.findUnique({
    where: { tokenHash: hashWorkspaceInviteToken(token) },
  })
  if (!invite || invite.status !== 'PENDING' || invite.expiresAt <= new Date(now)) {
    throw failure(400, GENERIC_INVITE_REFUSAL)
  }
  // Bound to the intended Profile when the inviter named one; the refusal is
  // the same generic answer, so probing a stolen token reveals nothing.
  if (invite.targetPersonId && invite.targetPersonId !== personId) {
    throw failure(400, GENERIC_INVITE_REFUSAL)
  }
  const person = await db.person.findUnique({ where: { id: personId }, select: { id: true } })
  if (!person) throw failure(400, GENERIC_INVITE_REFUSAL)

  return db.$transaction(async (tx) => {
    const claimed = await tx.workspaceInvite.updateMany({
      where: { id: invite.id, status: 'PENDING' },
      data: { status: 'ACCEPTED', acceptedAt: new Date(now), acceptedByPersonId: personId },
    })
    if (claimed.count !== 1) throw failure(400, GENERIC_INVITE_REFUSAL)

    const existing = await tx.workspaceMembership.findUnique({
      where: { portfolioId_personId: { portfolioId: invite.portfolioId, personId } },
    })
    let membership
    if (!existing) {
      membership = await tx.workspaceMembership.create({
        data: {
          portfolioId: invite.portfolioId,
          personId,
          role: invite.role,
          status: 'ACTIVE',
          invitedByPersonId: invite.invitedByPersonId,
        },
      })
    } else if (existing.status !== 'ACTIVE') {
      membership = await tx.workspaceMembership.update({
        where: { id: existing.id },
        data: {
          role: invite.role,
          status: 'ACTIVE',
          invitedByPersonId: invite.invitedByPersonId,
          version: { increment: 1 },
        },
      })
    } else {
      // Already an ACTIVE member: burn the token but never let a token change a
      // standing grant — role changes are an owner mutation, not an acceptance.
      membership = existing
    }

    await recordAudit(tx, {
      entityType: 'WORKSPACE_MEMBERSHIP',
      entityId: membership.id,
      action: 'WORKSPACE_INVITE_ACCEPTED',
      actorId: personId,
      payload: { portfolioId: invite.portfolioId, inviteId: invite.id, role: membership.role },
    })

    return {
      membershipId: membership.id,
      portfolioId: invite.portfolioId,
      role: membership.role,
      status: membership.status,
    }
  })
}

/**
 * Revoke a PENDING invite. Same authority as mint; a revoked token fails the
 * next acceptance with the generic refusal (AC-067.2 fail-closed revocation).
 */
export async function revokeWorkspaceInvite({ viewer, inviteId, db = prisma, now = Date.now() } = {}) {
  if (typeof inviteId !== 'string' || !inviteId) throw failure(404, 'Invite not found')
  const invite = await db.workspaceInvite.findUnique({
    where: { id: inviteId },
    select: { id: true, portfolioId: true, status: true },
  })
  if (!invite) throw failure(404, 'Invite not found')
  await assertWorkspaceAdminAuthority(viewer, invite.portfolioId, db)

  const revoked = await db.workspaceInvite.updateMany({
    where: { id: invite.id, status: 'PENDING' },
    data: { status: 'REVOKED', revokedAt: new Date(now) },
  })
  if (revoked.count !== 1) throw failure(409, 'INVITE_NOT_PENDING')

  await recordAudit(db, {
    entityType: 'WORKSPACE_INVITE',
    entityId: invite.id,
    action: 'WORKSPACE_INVITE_REVOKED',
    actorId: viewer.principal.id,
    payload: { portfolioId: invite.portfolioId },
  })
  return { inviteId: invite.id, status: 'REVOKED' }
}

/**
 * Remove a member from the Workspace (status → REMOVED, audited). The next
 * protected read re-derives from these rows, so removal needs no client state
 * (AC-067.7).
 */
export async function removeWorkspaceMembership({ viewer, portfolioId, personId, db = prisma, now = Date.now() } = {}) {
  await assertWorkspaceAdminAuthority(viewer, portfolioId, db)
  if (typeof personId !== 'string' || !personId) throw failure(404, 'Membership not found')

  const membership = await db.workspaceMembership.findUnique({
    where: { portfolioId_personId: { portfolioId, personId } },
    select: { id: true, status: true },
  })
  if (!membership || membership.status !== 'ACTIVE') throw failure(404, 'Membership not found')

  const updated = await db.workspaceMembership.update({
    where: { id: membership.id },
    data: { status: 'REMOVED', version: { increment: 1 } },
  })
  await recordAudit(db, {
    entityType: 'WORKSPACE_MEMBERSHIP',
    entityId: membership.id,
    action: 'WORKSPACE_MEMBERSHIP_REMOVED',
    actorId: viewer.principal.id,
    payload: { portfolioId, personId },
  })
  return { membershipId: updated.id, status: updated.status }
}

/**
 * The owner-side roster of one Workspace: who is an ACTIVE member, and which
 * invites are still PENDING. The read behind the Workspace Home collaboration
 * panel — an owner cannot revoke an invite or remove a member they cannot see.
 *
 * Same authority as every other owner mutation here, so a non-owner gets the
 * same 404 an absent Workspace produces (ADR-027 D9) and this read can never
 * confirm that a hidden Workspace exists.
 *
 * Carries NO token material in any form (SEC-014): `tokenHash` is not selected,
 * and the raw token existed only in the mint response. Expiry is returned as a
 * timestamp and classified by the caller, matching the fail-closed comparison at
 * acceptance rather than a status column nobody updates.
 */
export async function listWorkspaceCollaboration({ viewer, portfolioId, db = prisma } = {}) {
  await assertWorkspaceAdminAuthority(viewer, portfolioId, db)

  const [memberships, invites] = await Promise.all([
    db.workspaceMembership.findMany({
      where: { portfolioId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        createdAt: true,
        person: { select: { id: true, code: true, displayName: true } },
      },
    }),
    db.workspaceInvite.findMany({
      where: { portfolioId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        invitedEmail: true,
        targetPersonId: true,
        expiresAt: true,
        createdAt: true,
      },
    }),
  ])

  // `targetPersonId` has no relation on WorkspaceInvite, so the name is a
  // separate lookup rather than an include — one query for the whole page, not
  // one per invite, and skipped entirely when no invite names a Profile.
  const targetIds = [...new Set(invites.map((i) => i.targetPersonId).filter(Boolean))]
  const targetNames = new Map()
  if (targetIds.length) {
    const people = await db.person.findMany({
      where: { id: { in: targetIds } },
      select: { id: true, displayName: true },
    })
    for (const person of people) targetNames.set(person.id, person.displayName)
  }

  const iso = (value) => (value instanceof Date ? value.toISOString() : value)
  return {
    portfolioId,
    members: memberships.map((m) => ({
      membershipId: m.id,
      personId: m.person.id,
      code: m.person.code,
      displayName: m.person.displayName,
      role: m.role,
      joinedAt: iso(m.createdAt),
      // Marked here rather than compared in the client: the session principal is
      // the server's to know, and the onboarding read model does not carry the
      // person's own id. The UI uses it to refuse self-removal, which would
      // strip an owner of the very panel that could undo it.
      isSelf: m.person.id === viewer.principal.id,
    })),
    pendingInvites: invites.map((invite) => ({
      id: invite.id,
      role: invite.role,
      invitedEmail: invite.invitedEmail || null,
      targetPersonId: invite.targetPersonId || null,
      targetName: targetNames.get(invite.targetPersonId) || null,
      expiresAt: iso(invite.expiresAt),
      createdAt: iso(invite.createdAt),
    })),
  }
}

/**
 * The Workspaces this person has joined — collaboration visibility only
 * (AC-067.4): Workspace identity and the member's own role, never Tenant,
 * Business, Space, Project, file or domain data.
 */
export async function listJoinedWorkspaces({ personId, db = prisma } = {}) {
  if (typeof personId !== 'string' || !personId) return []
  const memberships = await db.workspaceMembership.findMany({
    where: { personId, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: {
      role: true,
      createdAt: true,
      portfolio: { select: { id: true, code: true, name: true } },
    },
  })
  return memberships.map((m) => ({
    portfolioId: m.portfolio.id,
    code: m.portfolio.code,
    name: m.portfolio.name,
    role: m.role,
    joinedAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt,
  }))
}
