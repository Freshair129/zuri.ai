import { afterEach, describe, expect, it, vi } from 'vitest'
const ports = vi.hoisted(() => ({ append: vi.fn() }))
vi.mock('@/modules/agent/execution-trace', () => ({ appendTraceEvent: ports.append }))
import { enqueueEdgeInvocationTrace, drainEdgeInvocationTraces } from '@/modules/agent/edge-invocation-trace'

// @req FR-171, FR-234 — trace failure never fails or waits on the business request.
// @spec ADR-070, SEC-001
const job = { id: 'job', tenantId: 'tenant', businessId: 'business', executionId: 'execution',
  version: 3, claimantId: 'edge' }
const event = { kind: 'TOOL_INVOKED', key: 'tool:id:STARTED', occurredAt: new Date(),
  payload: { phase: 'STARTED', toolName: 'search_project_work' } }
afterEach(async () => { await drainEdgeInvocationTraces(); vi.restoreAllMocks(); ports.append.mockReset() })
describe('best-effort queued Edge trace', () => {
  it('returns before a slow write and binds queued rows to the persisted execution', async () => {
    let release
    const gate = new Promise(resolve => { release = resolve })
    const tx = { lineConversationJob: { findFirst: vi.fn(async () => job) } }
    const db = { $transaction: vi.fn(async write => { await gate; return write(tx) }) }
    expect(enqueueEdgeInvocationTrace(db, job, event)).toBeUndefined()
    await Promise.resolve()
    expect(ports.append).not.toHaveBeenCalled()
    release()
    await drainEdgeInvocationTraces()
    expect(tx.lineConversationJob.findFirst).toHaveBeenCalledWith({ where: { ...job, id: job.id,
      executionMode: 'EDGE', status: 'CLAIMED' } })
    expect(ports.append).toHaveBeenCalledWith(tx, expect.objectContaining({ turnId: job.id,
      executionId: job.executionId, scope: { tenantId: job.tenantId, businessId: job.businessId },
      payload: event.payload, occurredAt: event.occurredAt }))
  })
  it('drops stale queued executions and emits only a fixed diagnostic on write failure', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    enqueueEdgeInvocationTrace({ $transaction: async write => write({ lineConversationJob: { findFirst: async () => null } }) }, job, event)
    await drainEdgeInvocationTraces()
    expect(ports.append).not.toHaveBeenCalled()
    enqueueEdgeInvocationTrace({ $transaction: async () => { throw new Error('private provider detail') } }, job, event)
    await expect(drainEdgeInvocationTraces()).resolves.toBeUndefined()
    expect(warning).toHaveBeenCalledTimes(1)
    expect(warning).toHaveBeenCalledWith('EDGE_INVOCATION_TRACE_UNAVAILABLE')
  })
})
