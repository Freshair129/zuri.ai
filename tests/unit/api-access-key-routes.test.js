// @req FR-106 — the mint and revoke routes resolve a trusted viewer before the
// service; the raw key appears only in the authenticated mint response.
// @spec SEC-006, SEC-008
// @tested tests/unit/api-access-key-routes.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../factories/viewer'

const { mintApiAccessKey, revokeApiAccessKey, resolveRequestViewer } = vi.hoisted(() => ({
  mintApiAccessKey: vi.fn(),
  revokeApiAccessKey: vi.fn(),
  resolveRequestViewer: vi.fn(),
}))

vi.mock('@/modules/identity/api-access-auth', async (importOriginal) => ({
  ...(await importOriginal()),
  mintApiAccessKey,
  revokeApiAccessKey,
}))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))

const { POST: MINT } = await import('@/app/api/platform/api-access-keys/route')
const { DELETE: REVOKE } = await import('@/app/api/platform/api-access-keys/[id]/route')

const viewer = makeViewer({ role: 'OWNER', visibleBusinessIds: [], ownedBusinessIds: [], ownedTenantIds: ['tnt-1'] })

const send = (handler, method, url, body, context) => handler(new Request(url, {
  method,
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
}), context)

beforeEach(() => {
  vi.clearAllMocks()
  resolveRequestViewer.mockResolvedValue(viewer)
})

describe('POST /api/platform/api-access-keys', () => {
  it('resolves the viewer and delegates to the service', async () => {
    mintApiAccessKey.mockResolvedValue({ id: 'apik-1', key: 'apik_raw', label: 'erp', tenantId: 'tnt-1' })
    const res = await send(MINT, 'POST', 'http://local/api/platform/api-access-keys', { label: 'erp', tenantId: 'tnt-1' })
    expect(mintApiAccessKey).toHaveBeenCalledWith({ label: 'erp', tenantId: 'tnt-1', viewer })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ key: 'apik_raw' })
  })

  it('never calls the service for an unauthenticated caller', async () => {
    resolveRequestViewer.mockRejectedValue(Object.assign(new Error('AUTH_REQUIRED'), { status: 401 }))
    const res = await send(MINT, 'POST', 'http://local/api/platform/api-access-keys', { label: 'erp', tenantId: 'tnt-1' })
    expect(res.status).toBe(401)
    expect(mintApiAccessKey).not.toHaveBeenCalled()
  })

  it('carries the service refusal status through', async () => {
    mintApiAccessKey.mockRejectedValue(Object.assign(new Error('denied'), { status: 403 }))
    const res = await send(MINT, 'POST', 'http://local/api/platform/api-access-keys', { label: 'erp', tenantId: 'tnt-1' })
    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/platform/api-access-keys/{id}', () => {
  it('resolves the viewer and delegates to the service with the path id', async () => {
    revokeApiAccessKey.mockResolvedValue({ id: 'apik-1', revoked: true })
    const res = await send(REVOKE, 'DELETE', 'http://local/api/platform/api-access-keys/apik-1', { reason: 'rotated' }, { params: { id: 'apik-1' } })
    expect(revokeApiAccessKey).toHaveBeenCalledWith('apik-1', { reason: 'rotated', viewer })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ id: 'apik-1', revoked: true })
  })

  it('defaults the reason when the request has no body', async () => {
    revokeApiAccessKey.mockResolvedValue({ id: 'apik-1', revoked: true })
    const res = await send(REVOKE, 'DELETE', 'http://local/api/platform/api-access-keys/apik-1', undefined, { params: { id: 'apik-1' } })
    expect(revokeApiAccessKey).toHaveBeenCalledWith('apik-1', { reason: 'REVOKED', viewer })
    expect(res.status).toBe(200)
  })

  it('never calls the service for an unauthenticated caller', async () => {
    resolveRequestViewer.mockRejectedValue(Object.assign(new Error('AUTH_REQUIRED'), { status: 401 }))
    const res = await send(REVOKE, 'DELETE', 'http://local/api/platform/api-access-keys/apik-1', undefined, { params: { id: 'apik-1' } })
    expect(res.status).toBe(401)
    expect(revokeApiAccessKey).not.toHaveBeenCalled()
  })
})
