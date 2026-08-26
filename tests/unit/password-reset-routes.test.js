// @req FR-104 — the mint route resolves a trusted viewer before the service;
// the consume route is public but returns only success or one generic error.
// @spec SDD-054, SEC-008
// @tested tests/unit/password-reset-routes.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../factories/viewer'

const { mintPasswordReset, resetPassword, resolveRequestViewer } = vi.hoisted(() => ({
  mintPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  resolveRequestViewer: vi.fn(),
}))

vi.mock('@/modules/identity/auth-service', async (importOriginal) => ({
  ...(await importOriginal()),
  mintPasswordReset,
  resetPassword,
}))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))

const { POST: MINT } = await import('@/app/api/platform/users/password-resets/route')
const { POST: CONSUME } = await import('@/app/api/auth/reset-password/route')

const viewer = makeViewer({ ownedBusinessIds: ['b-1'], visibleBusinessIds: ['b-1'] })

const post = (handler, url, body) => handler(new Request(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}))

beforeEach(() => {
  vi.clearAllMocks()
  resolveRequestViewer.mockResolvedValue(viewer)
})

describe('POST /api/platform/users/password-resets', () => {
  it('resolves the viewer and delegates to the service', async () => {
    mintPasswordReset.mockResolvedValue({ resetToken: 'raw', personId: 'per-1', expiresAt: 'later' })
    const res = await post(MINT, 'http://local/api/platform/users/password-resets', { personId: 'per-1' })
    expect(mintPasswordReset).toHaveBeenCalledWith({ targetPersonId: 'per-1', viewer })
    expect(res.status).toBe(200)
  })

  it('never calls the service for an unauthenticated caller', async () => {
    resolveRequestViewer.mockRejectedValue(Object.assign(new Error('AUTH_REQUIRED'), { status: 401 }))
    const res = await post(MINT, 'http://local/api/platform/users/password-resets', { personId: 'per-1' })
    expect(res.status).toBe(401)
    expect(mintPasswordReset).not.toHaveBeenCalled()
  })

  it('carries the service refusal status through', async () => {
    mintPasswordReset.mockRejectedValue(Object.assign(new Error('denied'), { status: 403 }))
    const res = await post(MINT, 'http://local/api/platform/users/password-resets', { personId: 'per-1' })
    expect(res.status).toBe(403)
  })
})

describe('POST /api/auth/reset-password', () => {
  it('consumes without any viewer resolution — the token is the credential', async () => {
    resetPassword.mockResolvedValue({ success: true })
    const res = await post(CONSUME, 'http://local/api/auth/reset-password', { token: 't', newPassword: 'p'.repeat(10) })
    expect(res.status).toBe(200)
    expect(resolveRequestViewer).not.toHaveBeenCalled()
    await expect(res.json()).resolves.toEqual({ success: true })
  })

  it('maps a service failure to 400 with the generic error only', async () => {
    resetPassword.mockResolvedValue({ success: false, error: 'INVALID_OR_EXPIRED_TOKEN' })
    const res = await post(CONSUME, 'http://local/api/auth/reset-password', { token: 'bad', newPassword: 'p'.repeat(10) })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'INVALID_OR_EXPIRED_TOKEN' })
  })
})
