import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

// @req FR-149, FR-150 — deployment and device route identities cannot be replaced by request payload.
// @spec ADR-061, SEC-001, SEC-025
// @tested tests/unit/server-line-worker-routes.test.js
const mocks = vi.hoisted(() => ({
  ports: vi.fn(), answer: vi.fn(), tick: vi.fn(), resolveDevice: vi.fn(),
  claim: vi.fn(), complete: vi.fn(), fail: vi.fn(),
}))
vi.mock('@/modules/line-oa-studio/application/server-line-runtime', () => ({ serverLinePorts: mocks.ports }))
vi.mock('@/modules/agent/server-line-answer', () => ({ createServerLineAnswer: mocks.answer }))
vi.mock('@/modules/identity/edge-device-credential', () => ({ resolveEdgeDeviceContext: mocks.resolveDevice }))
vi.mock('@/modules/line-oa-studio/application/line-conversation-jobs', () => ({
  runLineConversationWorker: mocks.tick, claimEdgeConversation: mocks.claim,
  completeEdgeConversation: mocks.complete, failEdgeConversation: mocks.fail,
}))
import { POST as workerPost } from '@/app/api/line-oa/worker/route'
import { POST as claimPost } from '@/app/api/edge/conversation-jobs/claim/route'
import { POST as completePost } from '@/app/api/edge/conversation-jobs/[id]/complete/route'
import { POST as failPost } from '@/app/api/edge/conversation-jobs/[id]/fail/route'

const token = 'w'.repeat(40)
const device = Object.freeze({ isEdgeDevice: true, tenantId: 'verified-tenant', businessId: 'verified-business', credentialId: 'verified-credential' })
const request = (body = '{}', authorization) => new Request('http://local/api/test', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body,
})
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('ZURI_LINE_WORKER_TOKEN', token)
  vi.stubEnv('ZURI_LINE_SERVER_ENABLED', 'true')
  mocks.ports.mockReturnValue({ resolveAccount: 'server-port' })
  mocks.answer.mockReturnValue('answer-port')
  mocks.tick.mockResolvedValue({ status: 'IDLE' })
  mocks.resolveDevice.mockResolvedValue(device)
  mocks.claim.mockResolvedValue(null)
  mocks.complete.mockResolvedValue({ status: 'READY' })
  mocks.fail.mockResolvedValue({ status: 'FAILED' })
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
    expect(mocks.tick).toHaveBeenCalledWith({ resolveAccount: 'server-port', answer: 'answer-port' })
  })
  it('redacts disabled/unavailable runtime errors and does not run a tick', async () => {
    mocks.ports.mockImplementation(() => { throw new Error('PRIVATE_MOUNT_PATH_AND_SECRET') })
    const response = await workerPost(request('{}', `Bearer ${token}`))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'LINE_WORKER_UNAVAILABLE' })
    expect(mocks.tick).not.toHaveBeenCalled()
  })
})

describe('device compute routes', () => {
  it('requires a resolved credential before parsing malformed JSON or touching any service', async () => {
    mocks.resolveDevice.mockResolvedValue(null)
    for (const post of [claimPost, completePost, failPost]) {
      expect((await post(request('{malformed'), { params: { id: 'job' } })).status).toBe(401)
    }
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(mocks.fail).not.toHaveBeenCalled()
  })
  it('returns 400 for authenticated malformed JSON and refuses body-selected claim scope', async () => {
    for (const post of [claimPost, completePost, failPost]) {
      expect((await post(request('{malformed'), { params: { id: 'job' } })).status).toBe(400)
    }
    expect((await claimPost(request('{"businessId":"foreign","tenantId":"foreign"}'))).status).toBe(400)
    expect(mocks.claim).not.toHaveBeenCalled()
    expect(mocks.complete).not.toHaveBeenCalled()
    expect(mocks.fail).not.toHaveBeenCalled()
  })
  it('passes verified identity separately from payload to completion and failure', async () => {
    const complete = { version: 2, text: 'answer' }
    expect((await completePost(request(JSON.stringify(complete)), { params: { id: 'job' } })).status).toBe(200)
    expect(mocks.complete).toHaveBeenCalledWith('job', complete, { deviceContext: device })
    const fail = { version: 2, code: 'LOCAL_POLICY_UNAVAILABLE' }
    expect((await failPost(request(JSON.stringify(fail)), { params: { id: 'job' } })).status).toBe(200)
    expect(mocks.fail).toHaveBeenCalledWith('job', fail, { deviceContext: device })
    expect((await claimPost(request())).status).toBe(204)
    expect(mocks.claim).toHaveBeenCalledWith({ deviceContext: device })
  })
  it('maps strict service contract rejection to 400 and redacts internal failures', async () => {
    const invalid = z.object({}).strict().safeParse({ tenantId: 'foreign' }).error
    mocks.complete.mockRejectedValueOnce(invalid)
    const response = await completePost(request('{"tenantId":"foreign"}'), { params: { id: 'job' } })
    expect(response.status).toBe(400)
    mocks.fail.mockRejectedValueOnce(new Error('PRIVATE_DATABASE_URL'))
    const failed = await failPost(request('{}'), { params: { id: 'job' } })
    expect(failed.status).toBe(503)
    expect(await failed.json()).toEqual({ error: 'CONVERSATION_JOB_REQUEST_REJECTED' })
  })
  it('keeps the device surface disabled when server LINE is disabled', async () => {
    vi.stubEnv('ZURI_LINE_SERVER_ENABLED', 'false')
    for (const post of [claimPost, completePost, failPost]) expect((await post(request(), { params: { id: 'job' } })).status).toBe(503)
    expect(mocks.resolveDevice).not.toHaveBeenCalled()
  })
})
