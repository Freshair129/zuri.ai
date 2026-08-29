// @req FR-066, FR-067 — every onboarding and workspace-collaboration route
// resolves a trusted viewer first and fails closed without one (SEC-014); the
// mutation targets are always the session principal, never a body claim; the
// mint route's role enum excludes OWNER at the boundary.
// @spec BR-016, SEC-014, SDD-038
// @tested tests/unit/workspace-onboarding-routes.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../factories/viewer'

const {
  completeProfile,
  getOnboardingState,
  createOnboardingWorkspace,
  mintWorkspaceInvite,
  acceptWorkspaceInvite,
  revokeWorkspaceInvite,
  removeWorkspaceMembership,
  resolveRequestViewer,
} = vi.hoisted(() => ({
  completeProfile: vi.fn(),
  getOnboardingState: vi.fn(),
  createOnboardingWorkspace: vi.fn(),
  mintWorkspaceInvite: vi.fn(),
  acceptWorkspaceInvite: vi.fn(),
  revokeWorkspaceInvite: vi.fn(),
  removeWorkspaceMembership: vi.fn(),
  resolveRequestViewer: vi.fn(),
}))

vi.mock('@/modules/identity/onboarding-service', () => ({
  completeProfile,
  getOnboardingState,
  createOnboardingWorkspace,
}))
vi.mock('@/modules/identity/workspace-membership-service', async (importOriginal) => ({
  ...(await importOriginal()),
  mintWorkspaceInvite,
  acceptWorkspaceInvite,
  revokeWorkspaceInvite,
  removeWorkspaceMembership,
}))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))

const { GET: STATE } = await import('@/app/api/onboarding/state/route')
const { POST: PROFILE } = await import('@/app/api/onboarding/profile/route')
const { POST: WORKSPACE } = await import('@/app/api/onboarding/workspaces/route')
const { POST: MINT } = await import('@/app/api/workspace-invites/route')
const { POST: ACCEPT } = await import('@/app/api/workspace-invites/accept/route')
const { DELETE: REVOKE } = await import('@/app/api/workspace-invites/[id]/route')
const { DELETE: REMOVE } = await import('@/app/api/workspace-memberships/route')

const viewer = makeViewer({ principal: { id: 'per-session', code: 'PER-S', displayName: 'Session Person' } })

const post = (handler, url, body) => handler(new Request(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}))

// @req FR-122 — a body the profile contract actually accepts. Named once so the
// three call sites below cannot drift apart from the schema, and from each other.
const PROFILE_BODY = {
  displayName: 'วรรณภา',
  firstName: 'วรรณภา',
  lastName: 'ใจดี',
  phone: '0812345678',
}

beforeEach(() => {
  vi.clearAllMocks()
  resolveRequestViewer.mockResolvedValue(viewer)
})

describe('session-first, fail-closed (SEC-014)', () => {
  const cases = [
    ['GET /api/onboarding/state', () => STATE(new Request('http://local/api/onboarding/state')), getOnboardingState],
    ['POST /api/onboarding/profile', () => post(PROFILE, 'http://local/api/onboarding/profile', PROFILE_BODY), completeProfile],
    ['POST /api/onboarding/workspaces', () => post(WORKSPACE, 'http://local/api/onboarding/workspaces', { name: 'x' }), createOnboardingWorkspace],
    ['POST /api/workspace-invites', () => post(MINT, 'http://local/api/workspace-invites', { portfolioId: 'pf-1' }), mintWorkspaceInvite],
    ['POST /api/workspace-invites/accept', () => post(ACCEPT, 'http://local/api/workspace-invites/accept', { token: 't' }), acceptWorkspaceInvite],
    ['DELETE /api/workspace-invites/[id]', () => REVOKE(new Request('http://local/api/workspace-invites/inv-1', { method: 'DELETE' }), { params: { id: 'inv-1' } }), revokeWorkspaceInvite],
    ['DELETE /api/workspace-memberships', () => REMOVE(new Request('http://local/api/workspace-memberships?portfolioId=pf-1&personId=per-2', { method: 'DELETE' })), removeWorkspaceMembership],
  ]

  for (const [name, run, service] of cases) {
    it(`${name} never reaches the service for an unauthenticated caller`, async () => {
      resolveRequestViewer.mockRejectedValue(Object.assign(new Error('AUTH_REQUIRED'), { status: 401 }))
      const res = await run()
      expect(res.status).toBe(401)
      expect(service).not.toHaveBeenCalled()
    })
  }
})

describe('the session principal is the subject — never a body claim', () => {
  it('profile completion targets viewer.principal.id and rejects a body-supplied person claim', async () => {
    completeProfile.mockResolvedValue({ profileComplete: true })
    const ok = await post(PROFILE, 'http://local/api/onboarding/profile', PROFILE_BODY)
    expect(ok.status).toBe(200)
    expect(completeProfile).toHaveBeenCalledWith(expect.objectContaining({ personId: 'per-session' }))

    const smuggled = await post(PROFILE, 'http://local/api/onboarding/profile', { ...PROFILE_BODY, personId: 'per-victim' })
    expect(smuggled.status).toBe(400) // .strict() refuses the extra key
  })

  // @req FR-122 — refused at the contract, before the service is reached. The
  // second assertion is the one that matters: a 400 that still called through
  // would mean the schema is decoration.
  it.each(['firstName', 'lastName', 'phone'])(
    'refuses a profile body with no %s and never reaches the service',
    async (field) => {
      completeProfile.mockResolvedValue({ profileComplete: true })
      const body = { ...PROFILE_BODY }
      delete body[field]
      const res = await post(PROFILE, 'http://local/api/onboarding/profile', body)
      expect(res.status).toBe(400)
      expect(completeProfile).not.toHaveBeenCalled()
    },
  )

  // @req FR-122 — display name is the one that may be absent, and the contract
  // has to actually let it through or the server can never compose it.
  it('accepts a profile body with no display name', async () => {
    completeProfile.mockResolvedValue({ profileComplete: true })
    const { displayName, ...withoutDisplayName } = PROFILE_BODY
    const res = await post(PROFILE, 'http://local/api/onboarding/profile', withoutDisplayName)
    expect(res.status).toBe(200)
    expect(completeProfile).toHaveBeenCalledWith(expect.objectContaining({
      firstName: 'วรรณภา', lastName: 'ใจดี', phone: '0812345678',
    }))
  })

  it('acceptance binds the trusted session principal to the token', async () => {
    acceptWorkspaceInvite.mockResolvedValue({ membershipId: 'wm-1', role: 'MEMBER', status: 'ACTIVE' })
    await post(ACCEPT, 'http://local/api/workspace-invites/accept', { token: 'raw' })
    expect(acceptWorkspaceInvite).toHaveBeenCalledWith({ token: 'raw', personId: 'per-session' })
  })

  it('workspace creation is attributed to the session principal', async () => {
    createOnboardingWorkspace.mockResolvedValue({ portfolioId: 'pf-1', role: 'OWNER' })
    await post(WORKSPACE, 'http://local/api/onboarding/workspaces', { name: 'ทีมของฉัน' })
    expect(createOnboardingWorkspace).toHaveBeenCalledWith({ personId: 'per-session', name: 'ทีมของฉัน' })
  })
})

describe('mint boundary (AC-067.6)', () => {
  it('refuses role OWNER at the schema boundary before the service runs', async () => {
    const res = await post(MINT, 'http://local/api/workspace-invites', { portfolioId: 'pf-1', role: 'OWNER' })
    expect(res.status).toBe(400)
    expect(mintWorkspaceInvite).not.toHaveBeenCalled()
  })

  it('delegates an allowed role with the viewer attached', async () => {
    mintWorkspaceInvite.mockResolvedValue({ inviteId: 'inv-1', inviteToken: 'raw' })
    const res = await post(MINT, 'http://local/api/workspace-invites', { portfolioId: 'pf-1', role: 'ADMIN' })
    expect(res.status).toBe(200)
    expect(mintWorkspaceInvite).toHaveBeenCalledWith(expect.objectContaining({ viewer, portfolioId: 'pf-1', role: 'ADMIN' }))
  })
})
