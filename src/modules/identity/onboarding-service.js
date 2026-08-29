import prisma from '@/lib/db'
import { uniqueHumanCode } from '@/lib/ids'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { listJoinedWorkspaces } from './workspace-membership-service'

// @req FR-066 — profile-first onboarding: after a provider-neutral local
// identity/session exists, every new person completes a Profile before being
// asked to create or select operating scope. A Profile-only member may remain
// in the Waiting Room with zero Organization/Tenant/Business/Space/Project rows
// created; an owner may continue from Profile to create a top-level Workspace
// (schema Portfolio, ADR-027 §D2) and add scopes only when needed.
// @spec BR-016 — Profile is an identity step over Person, never an
// authorization grant: nothing here widens the viewer contract, and the state
// read model exposes only the person's own invites and joined Workspaces
// (AC-066.3), never a scope inventory.
// @spec SEC-014, SDD-038 — every mutation takes `personId` from the trusted
// session (the route resolves the viewer and passes `viewer.principal.id`),
// never from the request body, and fails closed without it.
// @tested tests/unit/onboarding-service.test.js
// @tested tests/integration/workspace-onboarding-flow.test.js

function failure(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function requirePersonId(personId) {
  if (typeof personId !== 'string' || !personId.trim()) throw failure(401, 'AUTH_REQUIRED')
  return personId
}

/**
 * Complete (or update) the Profile over the existing Person (ADR-027 D1).
 * First completion stamps `profileCompletedAt`; later calls are the same edit
 * surface and never clear it.
 */
// @req FR-122 — given name, family name and telephone number are required here,
// at the profile boundary, and nullable in the database. That split is the whole
// design: Person rows exist that can never satisfy them — the seed, FR-107's
// operator bootstrap, and every Person FR-023's LINE ingest creates from a
// `lineUserId` on first contact — so the column cannot carry the requirement,
// and this function is the only place a person states these things themselves.
export async function completeProfile({
  personId, displayName, email, firstName, lastName, phone,
  db = prisma, now = Date.now(),
} = {}) {
  requirePersonId(personId)
  const text = (value) => (typeof value === 'string' ? value.trim() : '')
  const given = text(firstName)
  const family = text(lastName)
  const telephone = text(phone)
  if (!given) throw failure(400, 'FIRST_NAME_REQUIRED')
  if (!family) throw failure(400, 'LAST_NAME_REQUIRED')
  if (!telephone) throw failure(400, 'PHONE_REQUIRED')

  // Display name is what every existing surface renders, so it can never be
  // empty — but asking for it separately makes the person type their own name
  // twice. Supplied wins; otherwise it is composed from the two names above.
  const name = text(displayName) || `${given} ${family}`

  const person = await db.person.findUnique({
    where: { id: personId },
    select: { id: true, code: true, profileCompletedAt: true },
  })
  if (!person) throw failure(401, 'AUTH_REQUIRED')

  const firstCompletion = !person.profileCompletedAt
  const updated = await db.person.update({
    where: { id: personId },
    data: {
      displayName: name,
      firstName: given,
      lastName: family,
      phone: telephone,
      ...(typeof email === 'string' && email.trim() ? { email: email.trim().toLowerCase() } : {}),
      ...(firstCompletion ? { profileCompletedAt: new Date(now) } : {}),
    },
    select: {
      id: true, code: true, displayName: true, email: true, profileCompletedAt: true,
      firstName: true, lastName: true, phone: true,
    },
  })
  await recordAudit(db, {
    entityType: 'PERSON',
    entityId: personId,
    action: firstCompletion ? 'PROFILE_COMPLETED' : 'PROFILE_UPDATED',
    actorId: personId,
    payload: { personCode: person.code },
  })

  return {
    personId: updated.id,
    displayName: updated.displayName,
    email: updated.email,
    firstName: updated.firstName,
    lastName: updated.lastName,
    phone: updated.phone,
    profileComplete: Boolean(updated.profileCompletedAt),
  }
}

/**
 * The pre-Business onboarding state for one person: the FR-066 journey's
 * routing answer plus what the Waiting Room may show — the person's own
 * pending invitations and joined Workspaces only (AC-066.3), and a boolean for
 * Business access. Deliberately no Business/Tenant inventory: a Profile or
 * Workspace membership alone reveals no Business-bound data (AC-066.4, AC-067.4).
 */
export async function getOnboardingState({ personId, db = prisma, now = Date.now() } = {}) {
  requirePersonId(personId)
  const person = await db.person.findUnique({
    where: { id: personId },
    select: {
      id: true, displayName: true, email: true, profileCompletedAt: true,
      // @req FR-122 — so the profile form can show what is already stored
      // rather than making a returning person retype it.
      firstName: true, lastName: true, phone: true,
    },
  })
  if (!person) throw failure(401, 'AUTH_REQUIRED')

  const [workspaces, businessMembershipCount] = await Promise.all([
    listJoinedWorkspaces({ personId, db }),
    db.membership.count({ where: { personId, status: 'ACTIVE' } }),
  ])

  // The person's own pending invitations: addressed to them by id, or to their
  // verified profile email. Expired invites are filtered here (fail-closed at
  // acceptance too) rather than by a status nobody updates.
  const email = typeof person.email === 'string' && person.email.trim() ? person.email.trim().toLowerCase() : null
  const invites = await db.workspaceInvite.findMany({
    where: {
      status: 'PENDING',
      expiresAt: { gt: new Date(now) },
      OR: [{ targetPersonId: personId }, ...(email ? [{ invitedEmail: email }] : [])],
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      role: true,
      expiresAt: true,
      portfolio: { select: { id: true, name: true } },
    },
  })

  const profileComplete = Boolean(person.profileCompletedAt)
  const hasBusinessAccess = businessMembershipCount > 0
  const nextStep = !profileComplete
    ? 'PROFILE'
    : hasBusinessAccess
      ? 'BUSINESS_ROUTING'
      : workspaces.length > 0
        ? 'WORKSPACE_HOME'
        : 'WAITING_ROOM'

  return {
    profile: {
      complete: profileComplete,
      displayName: person.displayName || '',
      email: person.email || null,
      firstName: person.firstName || '',
      lastName: person.lastName || '',
      phone: person.phone || '',
    },
    nextStep,
    workspaces,
    pendingInvites: invites.map((invite) => ({
      id: invite.id,
      workspaceName: invite.portfolio.name,
      role: invite.role,
      expiresAt: invite.expiresAt instanceof Date ? invite.expiresAt.toISOString() : invite.expiresAt,
    })),
    hasBusinessAccess,
  }
}

/**
 * Owner path: create a top-level Workspace (schema Portfolio) and bind the
 * creator as its OWNER WorkspaceMembership, in one transaction (ADR-027 D4).
 *
 * Self-service, not anonymous — the FR-074(c) precedent: a brand-new Workspace
 * has no prior owner to ask, the membership row attributes it to the creator,
 * and the audit event records it. This does not touch the FR-075 operator guard
 * on the /api/scope Portfolio primitive: that route stays operator-only; this
 * one creates the caller's own collaboration container and grants them nothing
 * on any Tenant or Business (BR-016 — the membership is not read by
 * resolveViewer).
 *
 * Gated on a completed Profile (AC-066.1: Profile setup comes before any scope
 * creation prompt) and creates no Organization/Tenant/Business/Space/Project
 * row (AC-066.2 — those arrive only when the owner continues into the existing
 * FR-020/FR-074(c) add-business flow, which is where AC-066.8..11 are enforced).
 */
export async function createOnboardingWorkspace({ personId, name, db = prisma } = {}) {
  requirePersonId(personId)
  const workspaceName = typeof name === 'string' ? name.trim() : ''
  if (!workspaceName) throw failure(400, 'WORKSPACE_NAME_REQUIRED')

  const person = await db.person.findUnique({
    where: { id: personId },
    select: { id: true, profileCompletedAt: true },
  })
  if (!person) throw failure(401, 'AUTH_REQUIRED')
  if (!person.profileCompletedAt) throw failure(403, 'PROFILE_REQUIRED')

  const code = await uniqueHumanCode('PF', workspaceName, async (candidate) =>
    Boolean(await db.portfolio.findUnique({ where: { code: candidate } })),
  )

  return db.$transaction(async (tx) => {
    const portfolio = await tx.portfolio.create({ data: { code, name: workspaceName } })
    const membership = await tx.workspaceMembership.create({
      data: { portfolioId: portfolio.id, personId, role: 'OWNER', status: 'ACTIVE' },
    })
    await recordAudit(tx, {
      entityType: 'PORTFOLIO',
      entityId: portfolio.id,
      action: 'WORKSPACE_CREATED',
      actorId: personId,
      payload: { code, via: 'onboarding', ownerPersonId: personId },
    })
    await recordAudit(tx, {
      entityType: 'WORKSPACE_MEMBERSHIP',
      entityId: membership.id,
      action: 'WORKSPACE_MEMBERSHIP_ADDED',
      actorId: personId,
      payload: { portfolioId: portfolio.id, role: 'OWNER' },
    })
    return {
      portfolioId: portfolio.id,
      code: portfolio.code,
      name: portfolio.name,
      role: 'OWNER',
    }
  })
}
