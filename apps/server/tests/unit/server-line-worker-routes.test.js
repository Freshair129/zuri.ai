import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// @req FR-149 — the deployment worker route's identity cannot be replaced by a request payload.
// @req FR-265 — the four device compute routes this file also covered are withdrawn
//   (ADR-100 D2); their cases are deleted rather than ported, because what they
//   proved was the device surface's own authority boundary and there is no device
//   surface for LINE conversation work to have one.
// @req FR-210 — the worker's answer port is the model answer wrapped once by the
//   `#sku` catalogue command, and that composition takes nothing from the request.
// @spec ADR-061, ADR-100 D2, ADR-084 D4, SEC-001, SEC-025
// @tested tests/unit/server-line-worker-routes.test.js
const mocks = vi.hoisted(() => ({
  ports: vi.fn(), answer: vi.fn(), catalog: vi.fn(), tick: vi.fn(),
}))
vi.mock('@/modules/line-oa-studio/application/server-line-runtime', () => ({ serverLinePorts: mocks.ports }))
vi.mock('@/modules/agent/server-line-answer', () => ({ createServerLineAnswer: mocks.answer }))
vi.mock('@/modules/agent/line-catalog-command', () => ({ withLineCatalogCommand: mocks.catalog }))
vi.mock('@/modules/line-oa-studio/application/line-conversation-jobs', () => ({
  runLineConversationWorker: mocks.tick,
}))
import { POST as workerPost } from '@/app/api/line-oa/worker/route'

const token = 'w'.repeat(40)
const request = (body = '{}', authorization) => new Request('http://local/api/test', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body,
})
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('ZURI_LINE_WORKER_TOKEN', token)
  vi.stubEnv('ZURI_LINE_SERVER_ENABLED', 'true')
  mocks.ports.mockReturnValue({ resolveAccount: 'server-port' })
  mocks.answer.mockReturnValue('answer-port')
  mocks.catalog.mockImplementation((port) => ({ catalogCommandWraps: port }))
  mocks.tick.mockResolvedValue({ status: 'IDLE' })
})
afterEach(() => vi.unstubAllEnvs())

describe('deployment worker route', () => {
  it('rejects missing, short and same-length incorrect bearers before composing or running a worker', async () => {
    for (const bearer of [undefined, 'Bearer short', `Bearer ${'x'.repeat(40)}`]) {
      expect((await workerPost(request('{}', bearer))).status).toBe(401)
    }
    vi.stubEnv('ZURI_LINE_WORKER_TOKEN', 'short')
    expect((await workerPost(request('{}', 'Bearer short'))).status).toBe(401)
    vi.stubEnv('ZURI_LINE_WORKER_TOKEN', '')
    expect((await workerPost(request('{}', 'Bearer '))).status).toBe(401)
    expect(mocks.ports).not.toHaveBeenCalled()
    expect(mocks.tick).not.toHaveBeenCalled()
  })
  it('runs only with matching deployment bearer and ignores any client authority payload', async () => {
    const response = await workerPost(request('{"tenantId":"evil","resolveAccount":"evil"}', `Bearer ${token}`))
    expect(response.status).toBe(200)
    // The model answer is wrapped exactly once by the `#sku` command (FR-210);
    // nothing from the request body reaches the composition.
    expect(mocks.catalog).toHaveBeenCalledTimes(1)
    expect(mocks.catalog).toHaveBeenCalledWith('answer-port')
    expect(mocks.tick).toHaveBeenCalledWith({ resolveAccount: 'server-port', answer: { catalogCommandWraps: 'answer-port' } })
  })
  it('redacts disabled/unavailable runtime errors and does not run a tick', async () => {
    mocks.ports.mockImplementation(() => { throw new Error('PRIVATE_MOUNT_PATH_AND_SECRET') })
    const response = await workerPost(request('{}', `Bearer ${token}`))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'LINE_WORKER_UNAVAILABLE' })
    expect(mocks.tick).not.toHaveBeenCalled()
  })
})
