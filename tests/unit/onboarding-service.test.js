import { describe, expect, it, vi } from 'vitest'
import {
  completeProfile,
  createOnboardingWorkspace,
  getOnboardingState,
} from '@/modules/identity/onboarding-service'
import { ONBOARDING_STEP_PATHS, onboardingPathFor } from '@/modules/identity/onboarding-steps'

// @req FR-066 — the profile gate, the Waiting Room read model (own invites and
// joined Workspaces only), and the owner path's Workspace creation.
// @spec BR-016, SEC-014, SDD-038

const PERSON = {
  id: 'per-1',
  code: 'PER-1',
  displayName: 'คนใหม่',
  email: 'new@example.com',
  profileCompletedAt: null,
}

function mockDb({
  person = PERSON,
  memberships = 0,
  workspaceMemberships = [],
  invites = [],
} = {}) {
  const created = { portfolios: [], workspaceMemberships: [], audits: [] }
  const db = {
    created,
    person: {
      findUnique: vi.fn().mockResolvedValue(person),
      update: vi.fn(async ({ data }) => ({ ...person, ...data })),
    },
    membership: { count: vi.fn().mockResolvedValue(memberships) },
    workspaceMembership: {
      findMany: vi.fn().mockResolvedValue(workspaceMemberships),
      create: vi.fn(async ({ data }) => { created.workspaceMemberships.push(data); return { id: 'wm-1', ...data } }),
    },
    workspaceInvite: { findMany: vi.fn().mockResolvedValue(invites) },
    portfolio: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }) => { created.portfolios.push(data); return { id: 'pf-new', ...data } }),
    },
    auditEvent: { create: vi.fn(async ({ data }) => { created.audits.push(data); return { id: 'a-1', ...data } }) },
  }
  db.$transaction = vi.fn(async (fn) => fn(db))
  return db
}

const joined = (over = {}) => ({
  role: 'MEMBER',
  createdAt: new Date('2026-08-26T00:00:00Z'),
  portfolio: { id: 'pf-1', code: 'PF-1', name: 'ทีมแรก' },
  ...over,
})

// @req FR-122 — the three fields the Profile now carries. Every call below
// supplies them, because the service refuses without them.
const IDENTITY = { firstName: 'วรรณภา', lastName: 'ใจดี', phone: '0812345678' }

describe('completeProfile (AC-066.1, AC-066.7)', () => {
  it('stamps profileCompletedAt on first completion and audits PROFILE_COMPLETED', async () => {
    const db = mockDb()
    const result = await completeProfile({ personId: 'per-1', displayName: 'วรรณภา', ...IDENTITY, db })
    expect(result.profileComplete).toBe(true)
    expect(db.person.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ displayName: 'วรรณภา', profileCompletedAt: expect.any(Date) }),
    }))
    expect(db.created.audits[0].action).toBe('PROFILE_COMPLETED')
  })

  it('later edits keep the completion stamp and audit PROFILE_UPDATED', async () => {
    const db = mockDb({ person: { ...PERSON, profileCompletedAt: new Date('2026-08-01') } })
    await completeProfile({ personId: 'per-1', displayName: 'ชื่อใหม่', ...IDENTITY, db })
    const data = db.person.update.mock.calls[0][0].data
    expect(data.profileCompletedAt).toBeUndefined()
    expect(db.created.audits[0].action).toBe('PROFILE_UPDATED')
  })

  // @req FR-122
  it('writes the given name, family name and telephone number it was given', async () => {
    const db = mockDb()
    const result = await completeProfile({ personId: 'per-1', displayName: 'วรรณภา', ...IDENTITY, db })
    expect(db.person.update.mock.calls[0][0].data).toMatchObject(IDENTITY)
    expect(result).toMatchObject(IDENTITY)
  })

  // @req FR-122 — the reason display name is optional at the boundary. It is
  // never stored empty, so the check is on what reached the database, not on
  // what the caller omitted.
  it('composes a display name from the two names when none is supplied', async () => {
    const db = mockDb()
    await completeProfile({ personId: 'per-1', ...IDENTITY, db })
    expect(db.person.update.mock.calls[0][0].data.displayName).toBe('วรรณภา ใจดี')
  })

  it('keeps a supplied display name instead of composing over it', async () => {
    const db = mockDb()
    await completeProfile({ personId: 'per-1', displayName: 'ครูน้ำ', ...IDENTITY, db })
    expect(db.person.update.mock.calls[0][0].data.displayName).toBe('ครูน้ำ')
  })

  it('fails closed without a trusted person id (SEC-014)', async () => {
    const db = mockDb()
    await expect(completeProfile({ personId: '', ...IDENTITY, db })).rejects.toMatchObject({ status: 401 })
    expect(db.person.update).not.toHaveBeenCalled()
  })

  // @req FR-122 — each field refused on its own, and whitespace refused the same
  // as absence. One case per field, because a single combined assertion passes
  // while two of the three checks are missing.
  it.each([
    ['firstName', { ...IDENTITY, firstName: '   ' }],
    ['lastName', { ...IDENTITY, lastName: '' }],
    ['phone', { ...IDENTITY, phone: '  ' }],
    ['firstName missing entirely', { lastName: 'ใจดี', phone: '0812345678' }],
    ['lastName missing entirely', { firstName: 'วรรณภา', phone: '0812345678' }],
    ['phone missing entirely', { firstName: 'วรรณภา', lastName: 'ใจดี' }],
  ])('refuses a profile with %s and writes nothing', async (_label, identity) => {
    const db = mockDb()
    await expect(completeProfile({ personId: 'per-1', displayName: 'x', ...identity, db }))
      .rejects.toMatchObject({ status: 400 })
    expect(db.person.update).not.toHaveBeenCalled()
  })
})

describe('getOnboardingState — the FR-066 journey routing answer', () => {
  it('routes an incomplete profile to PROFILE before anything else (AC-066.1)', async () => {
    const db = mockDb({ workspaceMemberships: [joined()], memberships: 2 })
    const state = await getOnboardingState({ personId: 'per-1', db })
    expect(state.nextStep).toBe('PROFILE')
    expect(state.profile.complete).toBe(false)
  })

  it('a Profile-only member lands in the WAITING_ROOM (AC-066.2)', async () => {
    const db = mockDb({ person: { ...PERSON, profileCompletedAt: new Date() } })
    const state = await getOnboardingState({ personId: 'per-1', db })
    expect(state.nextStep).toBe('WAITING_ROOM')
    expect(state.workspaces).toEqual([])
    expect(state.hasBusinessAccess).toBe(false)
  })

  it('a Workspace member without Business access lands in WORKSPACE_HOME, not BusinessShell (AC-066.4)', async () => {
    const db = mockDb({ person: { ...PERSON, profileCompletedAt: new Date() }, workspaceMemberships: [joined()] })
    const state = await getOnboardingState({ personId: 'per-1', db })
    expect(state.nextStep).toBe('WORKSPACE_HOME')
    expect(state.hasBusinessAccess).toBe(false)
  })

  it('Business access routes to BUSINESS_ROUTING without changing the Profile identity (AC-066.6)', async () => {
    const db = mockDb({ person: { ...PERSON, profileCompletedAt: new Date() }, memberships: 1 })
    const state = await getOnboardingState({ personId: 'per-1', db })
    expect(state.nextStep).toBe('BUSINESS_ROUTING')
  })

  it('lists only the current person\'s pending invitations (AC-066.3): scoped by person id or profile email', async () => {
    const db = mockDb({
      person: { ...PERSON, profileCompletedAt: new Date() },
      invites: [{
        id: 'inv-1',
        role: 'MEMBER',
        expiresAt: new Date('2026-09-01T00:00:00Z'),
        portfolio: { id: 'pf-1', name: 'ทีมแรก' },
      }],
    })
    const state = await getOnboardingState({ personId: 'per-1', db })
    expect(state.pendingInvites).toEqual([
      { id: 'inv-1', workspaceName: 'ทีมแรก', role: 'MEMBER', expiresAt: '2026-09-01T00:00:00.000Z' },
    ])
    // The query itself is scoped: PENDING, unexpired, and addressed to this
    // person by id or verified profile email — never a broad inventory.
    const where = db.workspaceInvite.findMany.mock.calls[0][0].where
    expect(where.status).toBe('PENDING')
    expect(where.OR).toEqual([{ targetPersonId: 'per-1' }, { invitedEmail: 'new@example.com' }])
    expect(where.expiresAt.gt).toBeInstanceOf(Date)
  })

  it('exposes no Business, Tenant or domain inventory (AC-066.4, AC-067.4)', async () => {
    const db = mockDb({ person: { ...PERSON, profileCompletedAt: new Date() }, workspaceMemberships: [joined()] })
    const state = await getOnboardingState({ personId: 'per-1', db })
    expect(Object.keys(state).sort()).toEqual(['hasBusinessAccess', 'nextStep', 'pendingInvites', 'profile', 'workspaces'])
    expect(Object.keys(state.workspaces[0]).sort()).toEqual(['code', 'joinedAt', 'name', 'portfolioId', 'role'])
  })
})

describe('createOnboardingWorkspace — the owner path (AC-066.5)', () => {
  it('requires a completed Profile first (AC-066.1)', async () => {
    const db = mockDb()
    await expect(
      createOnboardingWorkspace({ personId: 'per-1', name: 'ทีมของฉัน', db }),
    ).rejects.toMatchObject({ status: 403, message: 'PROFILE_REQUIRED' })
    expect(db.portfolio.create).not.toHaveBeenCalled()
  })

  it('creates the Portfolio and OWNER membership in one transaction, audited — and nothing else (AC-066.2)', async () => {
    const db = mockDb({ person: { ...PERSON, profileCompletedAt: new Date() } })
    const result = await createOnboardingWorkspace({ personId: 'per-1', name: 'ทีมของฉัน', db })
    expect(result.role).toBe('OWNER')
    expect(db.created.portfolios).toHaveLength(1)
    expect(db.created.workspaceMemberships[0]).toMatchObject({ personId: 'per-1', role: 'OWNER', status: 'ACTIVE' })
    expect(db.created.audits.map((a) => a.action)).toEqual(['WORKSPACE_CREATED', 'WORKSPACE_MEMBERSHIP_ADDED'])
    // No Organization/Tenant/Business/Space/Project creation lives here: the
    // mock has no tenant/business/workspace/project delegates, so any such
    // write would have thrown.
  })

  it('fails closed without a trusted person id (SEC-014)', async () => {
    const db = mockDb()
    await expect(createOnboardingWorkspace({ personId: null, name: 'x', db })).rejects.toMatchObject({ status: 401 })
  })
})

describe('onboarding step → path map (ADR-027 D8)', () => {
  it('maps every step and falls back to Profile setup', () => {
    expect(onboardingPathFor('WAITING_ROOM')).toBe(ONBOARDING_STEP_PATHS.WAITING_ROOM)
    expect(onboardingPathFor('nonsense')).toBe(ONBOARDING_STEP_PATHS.PROFILE)
  })
})
