import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// @req FR-149 — the deployment worker tick also runs the admission reconciler,
//   and a bad reconciler sweep must never turn into this route's own failure.
// @spec ADR-061, SEC-001
// @tested tests/unit/line-oa-worker-route-reconciler.test.js
const mocks = vi.hoisted(() => ({ ports: vi.fn(), answer: vi.fn(), tick: vi.fn(), reconcile: vi.fn() }))
vi.mock('@/modules/line-oa-studio/application/server-line-runtime', () => ({ serverLinePorts: mocks.ports }))
vi.mock('@/modules/agent/server-line-answer', () => ({ createServerLineAnswer: mocks.answer }))
vi.mock('@/modules/line-oa-studio/application/line-conversation-jobs', () => ({ runLineConversationWorker: mocks.tick }))
vi.mock('@/modules/line-oa-studio/application/line-admission-reconciler', () => ({ reconcileAbandonedLineAdmissions: mocks.reconcile }))
import { POST as workerPost } from '@/app/api/line-oa/worker/route'

const token = 'w'.repeat(40)
const request = (authorization) => new Request('http://local/api/line-oa/worker', {
  method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body: '{}',
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('ZURI_LINE_WORKER_TOKEN', token)
  vi.stubEnv('ZURI_LINE_SERVER_ENABLED', 'true')
  mocks.ports.mockReturnValue({ resolveAccount: 'server-port' })
  mocks.answer.mockReturnValue('answer-port')
  mocks.tick.mockResolvedValue({ status: 'IDLE' })
  mocks.reconcile.mockResolvedValue({ scanned: 0, admitted: 0, skipped: 0, failed: 0 })
})
afterEach(() => vi.unstubAllEnvs())

describe('worker route reconciler wiring', () => {
  it('returns 401 without a valid bearer and never runs the reconciler or the tick', async () => {
    const response = await workerPost(request(undefined))
    expect(response.status).toBe(401)
    expect(mocks.reconcile).not.toHaveBeenCalled()
    expect(mocks.tick).not.toHaveBeenCalled()
  })

  it('includes the reconciler outcome in the tick response without changing the existing shape', async () => {
    mocks.tick.mockResolvedValue({ status: 'IDLE' })
    mocks.reconcile.mockResolvedValue({ scanned: 2, admitted: 1, skipped: 0, failed: 1 })
    const response = await workerPost(request(`Bearer ${token}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'IDLE', reconciled: { scanned: 2, admitted: 1, skipped: 0, failed: 1 } })
  })

  it('still returns the worker tick result when the reconciler throws — its failure never becomes this route\'s failure', async () => {
    mocks.reconcile.mockRejectedValue(new Error('PRIVATE_RECONCILER_INTERNALS'))
    mocks.tick.mockResolvedValue({ status: 'IDLE' })
    const response = await workerPost(request(`Bearer ${token}`))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('IDLE')
    expect(body.reconciled).toEqual({ scanned: 0, admitted: 0, skipped: 0, failed: 0, error: true })
    expect(JSON.stringify(body)).not.toContain('PRIVATE_RECONCILER_INTERNALS')
  })

  it('still returns 503 when the worker tick itself fails, even though the reconciler ran fine', async () => {
    mocks.reconcile.mockResolvedValue({ scanned: 0, admitted: 0, skipped: 0, failed: 0 })
    mocks.tick.mockRejectedValue(new Error('PRIVATE_TICK_INTERNALS'))
    const response = await workerPost(request(`Bearer ${token}`))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'LINE_WORKER_UNAVAILABLE' })
  })
})
