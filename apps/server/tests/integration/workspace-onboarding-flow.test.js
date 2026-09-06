import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { makeViewer } from '../factories/viewer'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import {
  completeProfile,
  createOnboardingWorkspace,
  getOnboardingState,
} from '@/modules/identity/onboarding-service'
import {
  acceptWorkspaceInvite,
  hashWorkspaceInviteToken,
  mintWorkspaceInvite,
  removeWorkspaceMembership,
  revokeWorkspaceInvite,
} from '@/modules/identity/workspace-membership-service'

// @req FR-122 — the Profile's own identity fields, required by the service.
const IDENTITY = { firstName: 'วรรณภา', lastName: 'ใจดี', phone: '0812345678' }

// @req FR-066 — the whole profile-first journey against the real database:
// profile → Waiting Room with ZERO scope rows created → owner creates a
// Workspace → member joins by invite — and a Workspace membership grants
// nothing on the viewer contract.
// @req FR-067 — mint/accept/replay/expiry/revocation against real rows.
// @spec BR-016, SEC-014, SDD-038

const suffix = randomUUID().slice(0, 6)

let owner, member

async function scopeRowCounts() {
  const [tenants, businesses, spaces, projects] = await Promise.all([
    prisma.tenant.count(),
    prisma.business.count(),
    prisma.workspace.count(),
    prisma.project.count(),
  ])
  return { tenants, businesses, spaces, projects }
}

describe('FR-066/FR-067 workspace onboarding flow', () => {
  beforeAll(async () => {
    owner = await prisma.person.create({
      data: { code: `PER-ONB-OWNER-${suffix}`, displayName: 'Onboarding Owner' },
    })
    member = await prisma.person.create({
      data: { code: `PER-ONB-MEMBER-${suffix}`, displayName: 'Onboarding Member', email: `onb-${suffix}@example.com` },
    })
  })

  it('AC-066.1/2: profile completes first, and the Waiting Room state creates zero Tenant/Business/Space/Project rows', async () => {
    const before = await scopeRowCounts()

    let state = await getOnboardingState({ personId: member.id })
    expect(state.nextStep).toBe('PROFILE')

    await completeProfile({ personId: member.id, displayName: 'สมาชิกใหม่', ...IDENTITY })
    state = await getOnboardingState({ personId: member.id })
    expect(state.nextStep).toBe('WAITING_ROOM')
    expect(state.profile.complete).toBe(true)
    // @req FR-122 — the round trip through the real columns, which is the half a
    // mocked db cannot show: a missing migration fails here and nowhere else.
    expect(state.profile).toMatchObject(IDENTITY)
    expect(state.workspaces).toEqual([])
    expect(state.hasBusinessAccess).toBe(false)

    expect(await scopeRowCounts()).toEqual(before)
  })

  it('AC-066.5: the owner path creates a top-level Workspace (Portfolio + OWNER membership) and nothing below it', async () => {
    await completeProfile({ personId: owner.id, displayName: 'เจ้าของทีม', ...IDENTITY })
    const before = await scopeRowCounts()

    const workspace = await createOnboardingWorkspace({ personId: owner.id, name: `ทีมทดสอบ ${suffix}` })
    expect(workspace.role).toBe('OWNER')

    const membershipRow = await prisma.workspaceMembership.findUnique({
      where: { portfolioId_personId: { portfolioId: workspace.portfolioId, personId: owner.id } },
    })
    expect(membershipRow).toMatchObject({ role: 'OWNER', status: 'ACTIVE' })

    // A Workspace is a Portfolio; no Organization/Tenant/Business/Space/Project appears.
    expect(await scopeRowCounts()).toEqual(before)

    const ownerState = await getOnboardingState({ personId: owner.id })
    expect(ownerState.nextStep).toBe('WORKSPACE_HOME')
  })

  it('FR-067 full cycle: mint (hash-bound) → waiting room lists it → accept once → replay refused → viewer unchanged (BR-016)', async () => {
    const workspace = await createOnboardingWorkspace({ personId: owner.id, name: `ทีมเชิญ ${suffix}` })
    // The inviter's authority is the WorkspaceMembership row itself; the viewer
    // carries no Business or Tenant grant at all.
    const ownerViewer = makeViewer({
      visibleBusinessIds: [],
      visibleDomains: [],
      principal: { id: owner.id, code: owner.code, displayName: owner.displayName },
    })

    const minted = await mintWorkspaceInvite({
      viewer: ownerViewer,
      portfolioId: workspace.portfolioId,
      targetPersonId: member.id,
    })
    expect(minted.inviteToken).toMatch(/^[a-f0-9]{64}$/)

    // Hash-bound storage: the raw token exists nowhere in the database (SEC-014).
    const stored = await prisma.workspaceInvite.findUnique({
      where: { tokenHash: hashWorkspaceInviteToken(minted.inviteToken) },
    })
    expect(stored).toBeTruthy()
    expect(await prisma.workspaceInvite.findFirst({ where: { tokenHash: minted.inviteToken } })).toBeNull()

    // AC-066.3 — the invite shows up in the member's own waiting room…
    const waiting = await getOnboardingState({ personId: member.id })
    expect(waiting.pendingInvites.some((invite) => invite.id === minted.inviteId)).toBe(true)
    // …and not in an unrelated person's.
    const stranger = await prisma.person.create({
      data: { code: `PER-ONB-STRANGER-${suffix}`, displayName: 'Stranger' },
    })
    const strangerState = await getOnboardingState({ personId: stranger.id })
    expect(strangerState.pendingInvites.some((invite) => invite.id === minted.inviteId)).toBe(false)

    // Accept once — an audited ACTIVE membership with the server-decided role.
    const accepted = await acceptWorkspaceInvite({ token: minted.inviteToken, personId: member.id })
    expect(accepted).toMatchObject({ portfolioId: workspace.portfolioId, role: 'MEMBER', status: 'ACTIVE' })
    const audit = await prisma.auditEvent.findFirst({
      where: { action: 'WORKSPACE_INVITE_ACCEPTED', entityId: accepted.membershipId },
    })
    expect(audit).toBeTruthy()
    expect(audit.payloadJson).not.toContain(minted.inviteToken)

    // Replay fails closed with the generic refusal (AC-067.2).
    await expect(
      acceptWorkspaceInvite({ token: minted.inviteToken, personId: member.id }),
    ).rejects.toMatchObject({ message: 'INVALID_OR_EXPIRED_INVITE' })

    // BR-016 — the grants-nothing proof: the member's resolved viewer is
    // unchanged by the WorkspaceMembership. resolveViewer reads Membership only.
    const viewer = await resolveViewer({ principalId: member.id })
    expect(viewer.role).toBe('MEMBER')
    expect(viewer.visibleBusinessIds).toEqual([])
    expect(viewer.ownedBusinessIds).toEqual([])
    expect(viewer.ownedTenantIds).toEqual([])
    expect(viewer.visibleDomains).toEqual([])
    expect(viewer.domainsByBusinessId).toEqual({})
    expect(viewer.isOperator).toBe(false)

    // …and the joined Workspace now routes them to Workspace Home, still with
    // no Business access (AC-066.4).
    const joined = await getOnboardingState({ personId: member.id })
    expect(joined.nextStep).toBe('WORKSPACE_HOME')
    expect(joined.hasBusinessAccess).toBe(false)
  })

  it('AC-067.2: an expired invite fails closed with the same generic refusal', async () => {
    const workspace = await createOnboardingWorkspace({ personId: owner.id, name: `ทีมหมดอายุ ${suffix}` })
    const ownerViewer = makeViewer({
      visibleBusinessIds: [],
      visibleDomains: [],
      principal: { id: owner.id, code: owner.code, displayName: owner.displayName },
    })
    const past = Date.now() - 8 * 24 * 60 * 60 * 1000
    const minted = await mintWorkspaceInvite({ viewer: ownerViewer, portfolioId: workspace.portfolioId, now: past })
    await expect(
      acceptWorkspaceInvite({ token: minted.inviteToken, personId: member.id }),
    ).rejects.toMatchObject({ message: 'INVALID_OR_EXPIRED_INVITE' })
  })

  it('AC-067.2/7: revocation and removal fail closed and are audited', async () => {
    const workspace = await createOnboardingWorkspace({ personId: owner.id, name: `ทีมถอน ${suffix}` })
    const ownerViewer = makeViewer({
      visibleBusinessIds: [],
      visibleDomains: [],
      principal: { id: owner.id, code: owner.code, displayName: owner.displayName },
    })

    // Revoked invite refuses acceptance.
    const minted = await mintWorkspaceInvite({ viewer: ownerViewer, portfolioId: workspace.portfolioId })
    await revokeWorkspaceInvite({ viewer: ownerViewer, inviteId: minted.inviteId })
    await expect(
      acceptWorkspaceInvite({ token: minted.inviteToken, personId: member.id }),
    ).rejects.toMatchObject({ message: 'INVALID_OR_EXPIRED_INVITE' })

    // A member holds no admin authority over the Workspace (AC-067.6): the
    // refusal is indistinguishable from an absent Workspace.
    const second = await mintWorkspaceInvite({ viewer: ownerViewer, portfolioId: workspace.portfolioId })
    await acceptWorkspaceInvite({ token: second.inviteToken, personId: member.id })
    const memberViewer = makeViewer({
      visibleBusinessIds: [],
      visibleDomains: [],
      principal: { id: member.id, code: member.code, displayName: member.displayName },
    })
    await expect(
      mintWorkspaceInvite({ viewer: memberViewer, portfolioId: workspace.portfolioId }),
    ).rejects.toMatchObject({ status: 404 })

    // Removal flips the row and the next read no longer lists the Workspace.
    await removeWorkspaceMembership({ viewer: ownerViewer, portfolioId: workspace.portfolioId, personId: member.id })
    const state = await getOnboardingState({ personId: member.id })
    expect(state.workspaces.some((w) => w.portfolioId === workspace.portfolioId)).toBe(false)
    const removalAudit = await prisma.auditEvent.findFirst({ where: { action: 'WORKSPACE_MEMBERSHIP_REMOVED' } })
    expect(removalAudit).toBeTruthy()
  })
})
