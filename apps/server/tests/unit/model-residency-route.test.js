import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// @req FR-244 — the residency route's authentication and disabled-surface gates
//   match every other /api/edge/* route exactly (ADR-061, SEC-001, SEC-025).
// @tested tests/unit/model-residency-route.test.js
const mocks = vi.hoisted(() => ({ resolveDevice: vi.fn(), directive: vi.fn() }))
vi.mock('@/modules/identity/edge-device-credential', () => ({ resolveEdgeDeviceContext: mocks.resolveDevice }))
vi.mock('@/modules/line-oa-studio/application/model-residency-service', () => ({ getModelResidencyDirective: mocks.directive }))
import { POST } from '@/app/api/edge/model-residency/route'

const device = Object.freeze({ isEdgeDevice: true, credentialId: 'verified-credential' })
const request = (body = '{}') => new Request('http://local/api/test', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body,
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('ZURI_LINE_SERVER_ENABLED', 'true')
  mocks.resolveDevice.mockResolvedValue(device)
  mocks.directive.mockResolvedValue({ shouldBeWarm: true })
})
afterEach(() => vi.unstubAllEnvs())

describe('FR-244 model residency route', () => {
  it('is disabled with the rest of the device surface when server LINE is off, before any credential check', async () => {
    vi.stubEnv('ZURI_LINE_SERVER_ENABLED', 'false')
    expect((await POST(request())).status).toBe(503)
    expect(mocks.resolveDevice).not.toHaveBeenCalled()
  })
  it('requires a resolved edge credential', async () => {
    mocks.resolveDevice.mockResolvedValue(null)
    expect((await POST(request())).status).toBe(401)
    expect(mocks.directive).not.toHaveBeenCalled()
  })
  it('refuses a non-empty body — the directive is never scoped by anything the caller sends', async () => {
    expect((await POST(request('{"accountId":"leak"}'))).status).toBe(400)
    expect(mocks.directive).not.toHaveBeenCalled()
  })
  it('returns exactly the directive the service computes, with no other field', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ shouldBeWarm: true })
    expect(mocks.directive).toHaveBeenCalledWith({})
  })
  it('redacts an internal failure to 503', async () => {
    mocks.directive.mockRejectedValueOnce(new Error('PRIVATE_DATABASE_URL'))
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'MODEL_RESIDENCY_REQUEST_REJECTED' })
  })
})
