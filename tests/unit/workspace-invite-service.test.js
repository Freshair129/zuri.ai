import { describe, expect, it, vi } from 'vitest'
import { makeViewer, makeDevViewer, ownsElsewhere } from '../factories/viewer'
import {
  WORKSPACE_INVITE_TTL_MS,
  acceptWorkspaceInvite,
  hashWorkspaceInviteToken,
  mintWorkspaceInvite,
  removeWorkspaceMembership,
  revokeWorkspaceInvite,
} from '@/modules/identity/workspace-membership-service'

// @req FR-067 — mint is authority-gated, hash-bound and role-limited; accept is
// single-use, expiring, target-bound and generic-on-failure; revocation and
// removal fail closed and audit.
// @spec BR-016, SEC-014, SDD-038

const PORTFOLIO_ID = 'pf-1'
const INVITER = { id: 'per-owner', code: 'PER-OWNER', displayName: 'Owner' }

function mockDb({
  workspaceOwnerMembership = { id: 'wm-owner' },
  tenantUnderPortfolio = null,
  invite = null,
  existingMembership = null,
  person = { id: 'per-member' },
} = {}) {
  const created = { invites: [], memberships: [], audits: [] }
  const db = {
    created,
    workspaceMembership: {
      findFirst: vi.fn().mockResolvedValue(workspaceOwnerMembership),
      findUnique: vi.fn().mockResolvedValue(existingMembership),
      create: vi.fn(async ({ data }) => { created.memberships.push(data); return { id: 'wm-new', ...data } }),
      update: vi.fn(async ({ data }) => ({ id: existingMembership?.id || 'wm-upd', ...existingMembership, ...data })),
    },
    tenant: { findFirst: vi.fn().mockResolvedValue(tenantUnderPortfolio) },
    person: { findUnique: vi.fn().mockResolvedValue(person) },
    workspaceInvite: {
      create: vi.fn(async ({ data }) => { created.invites.push(data); return { id: 'inv-1', ...data } }),
      findUnique: vi.fn().mockResolvedValue(invite),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    auditEvent: { create: vi.fn(async ({ data }) => { created.audits.push(data); return { id: 'audit-1', ...data } }) },
  }
  db.$transaction = vi.fn(async (fn) => fn(db))
  return db
}

function workspaceOwnerViewer() {
  // The inviter's Workspace authority lives in WorkspaceMembership rows, not in
  // the viewer contract — the viewer can be a plain MEMBER with no Business at all.
  return makeViewer({ visibleBusinessIds: [], visibleDomains: [], principal: INVITER })
}

const FUTURE = new Date(Date.now() + 60 * 60 * 1000)

function pendingInvite(over = {}) {
  return {
    id: 'inv-1',
    portfolioId: PORTFOLIO_ID,
    invitedByPersonId: INVITER.id,
    targetPersonId: null,
    role: 'MEMBER',
    status: 'PENDING',
    tokenHash: 'x',
    expiresAt: FUTURE,
    ...over,
  }
}

describe('mintWorkspaceInvite (AC-067.1, AC-067.6)', () => {
  it('lets an ACTIVE Workspace OWNER mint, stores only the digest, and audits without token material', async () => {
    const db = mockDb()
    const result = await mintWorkspaceInvite({ viewer: workspaceOwnerViewer(), portfolioId: PORTFOLIO_ID, db })

    expect(result.inviteToken).toMatch(/^[a-f0-9]{64}$/)
    expect(db.created.invites[0].tokenHash).toBe(hashWorkspaceInviteToken(result.inviteToken))
    expect(db.created.invites[0].tokenHash).not.toBe(result.inviteToken)
    // Single-use expiring contract: server-decided expiry.
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now())
    expect(new Date(result.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + WORKSPACE_INVITE_TTL_MS + 1000)
    // The audit event carries no token in any form.
    const audit = JSON.stringify(db.created.audits)
    expect(audit).not.toContain(result.inviteToken)
    expect(audit).not.toContain(hashWorkspaceInviteToken(result.inviteToken))
  })

  it('lets a Tenant Owner whose Tenant lives under the Portfolio mint', async () => {
    const db = mockDb({ workspaceOwnerMembership: null, tenantUnderPortfolio: { id: 't-1' } })
    const viewer = makeViewer({
      role: 'OWNER',
      visibleBusinessIds: [],
      ownedBusinessIds: [],
      ownedTenantIds: ['t-1'],
      visibleDomains: [],
      principal: INVITER,
    })
    const result = await mintWorkspaceInvite({ viewer, portfolioId: PORTFOLIO_ID, db })
    expect(result.inviteToken).toBeTruthy()
    expect(db.tenant.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['t-1'] }, portfolioId: PORTFOLIO_ID },
    }))
  })

  it('refuses a non-owner with the same 404 an absent Workspace produces (ADR-027 D9)', async () => {
    const db = mockDb({ workspaceOwnerMembership: null })
    await expect(
      mintWorkspaceInvite({ viewer: workspaceOwnerViewer(), portfolioId: PORTFOLIO_ID, db }),
    ).rejects.toMatchObject({ status: 404, message: 'Workspace not found' })
    expect(db.workspaceInvite.create).not.toHaveBeenCalled()
  })

  it('refuses an OWNER-of-a-Business-elsewhere — Business authority is not Workspace authority (BR-016)', async () => {
    const db = mockDb({ workspaceOwnerMembership: null })
    await expect(
      mintWorkspaceInvite({ viewer: ownsElsewhere(), portfolioId: PORTFOLIO_ID, db }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('refuses the platform DEV grant — cross-tenant visibility is not Workspace ownership', async () => {
    const db = mockDb({ workspaceOwnerMembership: null })
    await expect(
      mintWorkspaceInvite({ viewer: makeDevViewer(), portfolioId: PORTFOLIO_ID, db }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('never mints an OWNER invite, even from an authorized inviter (AC-067.6)', async () => {
    const db = mockDb()
    await expect(
      mintWorkspaceInvite({ viewer: workspaceOwnerViewer(), portfolioId: PORTFOLIO_ID, role: 'OWNER', db }),
    ).rejects.toMatchObject({ status: 400, message: 'INVITE_ROLE_NOT_ALLOWED' })
    expect(db.workspaceInvite.create).not.toHaveBeenCalled()
  })
})

describe('acceptWorkspaceInvite (AC-067.2, AC-067.3)', () => {
  it('creates an ACTIVE membership with the server-decided role and audits it', async () => {
    const db = mockDb({ invite: pendingInvite({ role: 'ADMIN' }) })
    const result = await acceptWorkspaceInvite({ token: 'raw-token', personId: 'per-member', db })

    expect(result).toMatchObject({ portfolioId: PORTFOLIO_ID, role: 'ADMIN', status: 'ACTIVE' })
    expect(db.created.memberships[0]).toMatchObject({ personId: 'per-member', role: 'ADMIN', status: 'ACTIVE' })
    expect(db.created.audits.some((a) => a.action === 'WORKSPACE_INVITE_ACCEPTED')).toBe(true)
    // The claim is atomic: PENDING → ACCEPTED via a guarded updateMany.
    expect(db.workspaceInvite.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'inv-1', status: 'PENDING' },
    }))
  })

  it('fails closed with one generic refusal for an unknown token', async () => {
    const db = mockDb({ invite: null })
    await expect(
      acceptWorkspaceInvite({ token: 'nope', personId: 'per-member', db }),
    ).rejects.toMatchObject({ status: 400, message: 'INVALID_OR_EXPIRED_INVITE' })
  })

  it('fails closed on an expired invite with the same generic refusal', async () => {
    const db = mockDb({ invite: pendingInvite({ expiresAt: new Date(Date.now() - 1000) }) })
    await expect(
      acceptWorkspaceInvite({ token: 'raw-token', personId: 'per-member', db }),
    ).rejects.toMatchObject({ message: 'INVALID_OR_EXPIRED_INVITE' })
  })

  it('fails closed on a revoked invite with the same generic refusal', async () => {
    const db = mockDb({ invite: pendingInvite({ status: 'REVOKED' }) })
    await expect(
      acceptWorkspaceInvite({ token: 'raw-token', personId: 'per-member', db }),
    ).rejects.toMatchObject({ message: 'INVALID_OR_EXPIRED_INVITE' })
  })

  it('fails closed when the invite names a different Profile — same generic refusal, no information leak', async () => {
    const db = mockDb({ invite: pendingInvite({ targetPersonId: 'per-somebody-else' }) })
    await expect(
      acceptWorkspaceInvite({ token: 'raw-token', personId: 'per-member', db }),
    ).rejects.toMatchObject({ message: 'INVALID_OR_EXPIRED_INVITE' })
    expect(db.workspaceMembership.create).not.toHaveBeenCalled()
  })

  it('loses a concurrent replay race: a claim that updates zero rows refuses', async () => {
    const db = mockDb({ invite: pendingInvite() })
    db.workspaceInvite.updateMany.mockResolvedValue({ count: 0 })
    await expect(
      acceptWorkspaceInvite({ token: 'raw-token', personId: 'per-member', db }),
    ).rejects.toMatchObject({ message: 'INVALID_OR_EXPIRED_INVITE' })
    expect(db.workspaceMembership.create).not.toHaveBeenCalled()
  })

  it('never lets a token change a standing ACTIVE grant', async () => {
    const existing = { id: 'wm-1', portfolioId: PORTFOLIO_ID, personId: 'per-member', role: 'MEMBER', status: 'ACTIVE' }
    const db = mockDb({ invite: pendingInvite({ role: 'ADMIN' }), existingMembership: existing })
    const result = await acceptWorkspaceInvite({ token: 'raw-token', personId: 'per-member', db })
    expect(result.role).toBe('MEMBER')
    expect(db.workspaceMembership.update).not.toHaveBeenCalled()
    expect(db.workspaceMembership.create).not.toHaveBeenCalled()
  })

  it('fails closed without a trusted person id (SEC-014)', async () => {
    const db = mockDb({ invite: pendingInvite() })
    await expect(
      acceptWorkspaceInvite({ token: 'raw-token', personId: null, db }),
    ).rejects.toMatchObject({ message: 'INVALID_OR_EXPIRED_INVITE' })
  })
})

describe('revokeWorkspaceInvite and removeWorkspaceMembership (AC-067.7, AC-067.8)', () => {
  it('revokes a PENDING invite with owner authority and audits it', async () => {
    const db = mockDb()
    db.workspaceInvite.findUnique.mockResolvedValue({ id: 'inv-1', portfolioId: PORTFOLIO_ID, status: 'PENDING' })
    const result = await revokeWorkspaceInvite({ viewer: workspaceOwnerViewer(), inviteId: 'inv-1', db })
    expect(result).toMatchObject({ status: 'REVOKED' })
    expect(db.created.audits.some((a) => a.action === 'WORKSPACE_INVITE_REVOKED')).toBe(true)
  })

  it('refuses revocation without workspace authority', async () => {
    const db = mockDb({ workspaceOwnerMembership: null })
    db.workspaceInvite.findUnique.mockResolvedValue({ id: 'inv-1', portfolioId: PORTFOLIO_ID, status: 'PENDING' })
    await expect(
      revokeWorkspaceInvite({ viewer: workspaceOwnerViewer(), inviteId: 'inv-1', db }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('removes an ACTIVE membership (status → REMOVED) and audits it', async () => {
    const db = mockDb({ existingMembership: { id: 'wm-1', status: 'ACTIVE' } })
    db.workspaceMembership.update.mockResolvedValue({ id: 'wm-1', status: 'REMOVED' })
    const result = await removeWorkspaceMembership({
      viewer: workspaceOwnerViewer(),
      portfolioId: PORTFOLIO_ID,
      personId: 'per-member',
      db,
    })
    expect(result).toMatchObject({ status: 'REMOVED' })
    expect(db.created.audits.some((a) => a.action === 'WORKSPACE_MEMBERSHIP_REMOVED')).toBe(true)
  })

  it('a member cannot remove another member (AC-067.6)', async () => {
    const db = mockDb({ workspaceOwnerMembership: null, existingMembership: { id: 'wm-1', status: 'ACTIVE' } })
    await expect(
      removeWorkspaceMembership({ viewer: workspaceOwnerViewer(), portfolioId: PORTFOLIO_ID, personId: 'per-member', db }),
    ).rejects.toMatchObject({ status: 404 })
    expect(db.workspaceMembership.update).not.toHaveBeenCalled()
  })
})
