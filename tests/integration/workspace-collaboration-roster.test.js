import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { makeViewer } from '../factories/viewer'
import { createOnboardingWorkspace } from '@/modules/identity/onboarding-service'
import {
  acceptWorkspaceInvite,
  listWorkspaceCollaboration,
  mintWorkspaceInvite,
  removeWorkspaceMembership,
  revokeWorkspaceInvite,
} from '@/modules/identity/workspace-membership-service'

// @req FR-067 — the owner roster behind the Workspace Home collaboration panel,
// against real rows: it lists exactly the ACTIVE members and still-PENDING
// invites, carries no token material, marks the session principal, re-derives
// after every mutation, and answers a non-owner with the same 404 an absent
// Workspace produces (ADR-027 D9). Owner-side controls that cannot see their own
// targets cannot revoke or remove them, which is why this read is the fix's
// load-bearing half.
// @spec BR-016, SEC-014, SDD-038
// @tested tests/integration/workspace-collaboration-roster.test.js

const suffix = randomUUID().slice(0, 6)

const viewerFor = (person) => makeViewer({
  visibleBusinessIds: [],
  visibleDomains: [],
  principal: { id: person.id, code: person.code, displayName: person.displayName },
})

let owner, member, outsider, ownerViewer

describe('FR-067 workspace collaboration roster', () => {
  beforeAll(async () => {
    owner = await prisma.person.create({
      data: { code: `PER-ROSTER-OWNER-${suffix}`, displayName: 'เจ้าของโรสเตอร์', profileCompletedAt: new Date() },
    })
    member = await prisma.person.create({
      data: { code: `PER-ROSTER-MEMBER-${suffix}`, displayName: 'สมาชิกโรสเตอร์' },
    })
    outsider = await prisma.person.create({
      data: { code: `PER-ROSTER-OUT-${suffix}`, displayName: 'คนนอก' },
    })
    ownerViewer = viewerFor(owner)
  })

  it('lists the owner as an ACTIVE member and marks them as the session principal', async () => {
    const workspace = await createOnboardingWorkspace({ personId: owner.id, name: `โรสเตอร์ ${suffix}` })

    const roster = await listWorkspaceCollaboration({ viewer: ownerViewer, portfolioId: workspace.portfolioId })

    expect(roster.portfolioId).toBe(workspace.portfolioId)
    expect(roster.members).toHaveLength(1)
    expect(roster.members[0]).toMatchObject({
      personId: owner.id,
      code: owner.code,
      displayName: owner.displayName,
      role: 'OWNER',
      // The client cannot compute this: the onboarding read model carries no
      // person id, and self-removal is the one action the panel blocks.
      isSelf: true,
    })
    expect(typeof roster.members[0].joinedAt).toBe('string')
    expect(roster.pendingInvites).toEqual([])
  })

  it('shows a pending invite with its audience and expiry, and never any token material', async () => {
    const workspace = await createOnboardingWorkspace({ personId: owner.id, name: `โรสเตอร์เชิญ ${suffix}` })
    const minted = await mintWorkspaceInvite({
      viewer: ownerViewer,
      portfolioId: workspace.portfolioId,
      role: 'ADMIN',
      targetPersonId: member.id,
    })

    const roster = await listWorkspaceCollaboration({ viewer: ownerViewer, portfolioId: workspace.portfolioId })

    expect(roster.pendingInvites).toHaveLength(1)
    expect(roster.pendingInvites[0]).toMatchObject({
      id: minted.inviteId,
      role: 'ADMIN',
      invitedEmail: null,
      targetPersonId: member.id,
      // Resolved by a separate lookup — WorkspaceInvite has no targetPerson
      // relation to include.
      targetName: member.displayName,
      expiresAt: minted.expiresAt,
    })

    // SEC-014 — neither the raw token nor its digest may leave this read.
    const serialized = JSON.stringify(roster)
    expect(serialized).not.toContain(minted.inviteToken)
    expect(serialized).not.toContain('tokenHash')
  })

  it('re-derives after every owner mutation: accept, revoke and remove all move the lists', async () => {
    const workspace = await createOnboardingWorkspace({ personId: owner.id, name: `โรสเตอร์วงจร ${suffix}` })
    const joining = await mintWorkspaceInvite({ viewer: ownerViewer, portfolioId: workspace.portfolioId })
    const doomed = await mintWorkspaceInvite({
      viewer: ownerViewer,
      portfolioId: workspace.portfolioId,
      invitedEmail: `Revoke-${suffix}@Example.com`,
    })

    let roster = await listWorkspaceCollaboration({ viewer: ownerViewer, portfolioId: workspace.portfolioId })
    expect(roster.members).toHaveLength(1)
    expect(roster.pendingInvites.map((i) => i.id).sort()).toEqual([joining.inviteId, doomed.inviteId].sort())
    // Stored lowercased at mint; the panel shows what the server holds.
    const byEmail = roster.pendingInvites.find((i) => i.id === doomed.inviteId)
    expect(byEmail.invitedEmail).toBe(`revoke-${suffix}@example.com`)

    // Accepting takes an invite out of pending and puts a member in.
    await acceptWorkspaceInvite({ token: joining.inviteToken, personId: member.id })
    roster = await listWorkspaceCollaboration({ viewer: ownerViewer, portfolioId: workspace.portfolioId })
    expect(roster.members.map((m) => m.personId).sort()).toEqual([owner.id, member.id].sort())
    expect(roster.members.find((m) => m.personId === member.id)).toMatchObject({ role: 'MEMBER', isSelf: false })
    expect(roster.pendingInvites.map((i) => i.id)).toEqual([doomed.inviteId])

    // Revoking takes the other one out.
    await revokeWorkspaceInvite({ viewer: ownerViewer, inviteId: doomed.inviteId })
    roster = await listWorkspaceCollaboration({ viewer: ownerViewer, portfolioId: workspace.portfolioId })
    expect(roster.pendingInvites).toEqual([])

    // AC-067.7 — removal is re-derived from the row, not from client state.
    await removeWorkspaceMembership({ viewer: ownerViewer, portfolioId: workspace.portfolioId, personId: member.id })
    roster = await listWorkspaceCollaboration({ viewer: ownerViewer, portfolioId: workspace.portfolioId })
    expect(roster.members.map((m) => m.personId)).toEqual([owner.id])
  })

  it('keeps an expired invite visible while it is still PENDING, so the owner can retire it', async () => {
    const workspace = await createOnboardingWorkspace({ personId: owner.id, name: `โรสเตอร์หมดอายุ ${suffix}` })
    const past = Date.now() - 8 * 24 * 60 * 60 * 1000
    const stale = await mintWorkspaceInvite({ viewer: ownerViewer, portfolioId: workspace.portfolioId, now: past })

    const roster = await listWorkspaceCollaboration({ viewer: ownerViewer, portfolioId: workspace.portfolioId })

    // EXPIRED is not a persisted status; the row is still PENDING and the panel
    // classifies it from `expiresAt`, exactly as acceptance does.
    expect(roster.pendingInvites.map((i) => i.id)).toEqual([stale.inviteId])
    expect(Date.parse(roster.pendingInvites[0].expiresAt)).toBeLessThan(Date.now())
    // …and it can still be revoked, which is why hiding it would be wrong.
    await expect(revokeWorkspaceInvite({ viewer: ownerViewer, inviteId: stale.inviteId })).resolves.toMatchObject({
      status: 'REVOKED',
    })
  })

  it('a plain member and an outsider get the same 404 an absent Workspace produces (ADR-027 D9)', async () => {
    const workspace = await createOnboardingWorkspace({ personId: owner.id, name: `โรสเตอร์ปิด ${suffix}` })
    const invite = await mintWorkspaceInvite({ viewer: ownerViewer, portfolioId: workspace.portfolioId })
    await acceptWorkspaceInvite({ token: invite.inviteToken, personId: member.id })

    // An ACTIVE MEMBER of this very Workspace is not an administrator of it.
    await expect(
      listWorkspaceCollaboration({ viewer: viewerFor(member), portfolioId: workspace.portfolioId }),
    ).rejects.toMatchObject({ status: 404, message: 'Workspace not found' })

    // Someone with no relationship to it gets a refusal it cannot tell apart.
    await expect(
      listWorkspaceCollaboration({ viewer: viewerFor(outsider), portfolioId: workspace.portfolioId }),
    ).rejects.toMatchObject({ status: 404, message: 'Workspace not found' })

    await expect(
      listWorkspaceCollaboration({ viewer: ownerViewer, portfolioId: `pf-does-not-exist-${suffix}` }),
    ).rejects.toMatchObject({ status: 404, message: 'Workspace not found' })
  })

  it('fails closed without a trusted session principal (SEC-014)', async () => {
    const workspace = await createOnboardingWorkspace({ personId: owner.id, name: `โรสเตอร์ไร้เซสชัน ${suffix}` })
    await expect(
      listWorkspaceCollaboration({ viewer: undefined, portfolioId: workspace.portfolioId }),
    ).rejects.toMatchObject({ status: 401, message: 'AUTH_REQUIRED' })
  })

  it('is a read: it records no audit event of its own', async () => {
    const workspace = await createOnboardingWorkspace({ personId: owner.id, name: `โรสเตอร์อ่าน ${suffix}` })
    const before = await prisma.auditEvent.count()
    await listWorkspaceCollaboration({ viewer: ownerViewer, portfolioId: workspace.portfolioId })
    expect(await prisma.auditEvent.count()).toBe(before)
  })
})
