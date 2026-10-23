import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createKnowledgeRuntimeLoop, notifyKnowledgeWorkerObserver } from '@/platform/integrations/core/knowledge-runtime-loop.mjs'

// @req FR-109 — bounded process retry scheduling preserves durable run/attempt semantics.
// @req FR-173 — worker lifecycle and observer failures cannot corrupt admitted work.
// @spec ADR-073
// @tested tests/unit/knowledge-runtime-loop.test.js

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-23T00:00:00Z')) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('Knowledge process-local worker loop', () => {
  it('coalesces manual and automatic passes and drains stop without scheduling more work', async () => {
    const pending = deferred()
    const run = vi.fn(() => pending.promise)
    const loop = createKnowledgeRuntimeLoop({ run })
    const first = loop.runOnce()
    expect(loop.runOnce()).toBe(first)
    loop.start()
    loop.start()
    await Promise.resolve()
    expect(run).toHaveBeenCalledTimes(1)
    expect(loop.getStatus()).toMatchObject({ active: true, running: true })
    let stopped = false
    const stopping = loop.stop().then(() => { stopped = true })
    await Promise.resolve()
    expect(stopped).toBe(false)
    pending.resolve({ persisted: true })
    await expect(first).resolves.toEqual({ persisted: true })
    await stopping
    await vi.advanceTimersByTimeAsync(120000)
    expect(run).toHaveBeenCalledTimes(1)
    expect(loop.getStatus()).toMatchObject({ active: false, running: false, nextRunAt: null })
  })

  it('uses bounded exponential backoff then cooldown without abandoning durable work', async () => {
    const run = vi.fn().mockRejectedValue(new Error('dependency down'))
    const events = []
    const loop = createKnowledgeRuntimeLoop({ run, intervalMs: 1000, maxRetryIntervalMs: 8000, retryBudget: 3, random: () => 0, onError: (event) => events.push(event) })
    loop.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(events[0]).toMatchObject({ code: 'KNOWLEDGE_WORKER_RETRY', consecutiveFailures: 1, retryInMs: 500, retryBudgetExhausted: false })
    await vi.advanceTimersByTimeAsync(500)
    expect(events[1].retryInMs).toBe(1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(events[2]).toMatchObject({ code: 'KNOWLEDGE_WORKER_RETRY_BUDGET', consecutiveFailures: 3, retryInMs: 4000, retryBudgetExhausted: true })
    await vi.advanceTimersByTimeAsync(4000)
    expect(run).toHaveBeenCalledTimes(4)
    expect(events[3].retryInMs).toBe(4000)
    expect(loop.getStatus()).toMatchObject({ consecutiveFailures: 4, retryBudgetExhausted: true, lastOutcome: 'FAILED' })
    await loop.stop()
  })

  it('resets exhaustion after a successful pass and returns to the normal interval', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue('ok')
    const loop = createKnowledgeRuntimeLoop({ run, intervalMs: 1000, maxRetryIntervalMs: 4000, retryBudget: 1, random: () => 0 })
    loop.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(loop.getStatus().retryBudgetExhausted).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(loop.getStatus()).toMatchObject({ consecutiveFailures: 0, retryBudgetExhausted: false, lastOutcome: 'SUCCEEDED', nextRunAt: Date.now() + 1000 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(3)
    await loop.stop()
  })

  it('backs off handled retry outcomes without changing the manual result', async () => {
    const result = { examined: 1, retryableFailures: 1 }
    const run = vi.fn().mockResolvedValueOnce(result).mockResolvedValueOnce(result).mockResolvedValue({ examined: 1, retryableFailures: 0 })
    const onError = vi.fn()
    const loop = createKnowledgeRuntimeLoop({ run, retryBudget: 2, maxRetryIntervalMs: 4000, random: () => 0, onError })
    loop.start()
    await expect(loop.runOnce()).resolves.toBe(result)
    expect(loop.getStatus()).toMatchObject({ consecutiveFailures: 1, lastOutcome: 'RETRY_PENDING' })
    await vi.advanceTimersByTimeAsync(500)
    expect(loop.getStatus().retryBudgetExhausted).toBe(true)
    expect(onError.mock.calls[1][0]).toMatchObject({ retryBudgetExhausted: true, retryInMs: 2000 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(loop.getStatus()).toMatchObject({ consecutiveFailures: 0, lastOutcome: 'SUCCEEDED' })
    await loop.stop()
  })

  it.each(['throw', 'reject'])('contains an observer that can %s without losing the next retry', async (kind) => {
    const run = vi.fn().mockRejectedValue(new Error('down'))
    const onError = vi.fn(() => kind === 'throw' ? (() => { throw new Error('observer') })() : Promise.reject(new Error('observer')))
    const loop = createKnowledgeRuntimeLoop({ run, onError, random: () => 0 })
    loop.start()
    await vi.advanceTimersByTimeAsync(500)
    expect(run).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledTimes(2)
    await loop.stop()
  })

  it('reports only fixed diagnostics even for hostile external errors', async () => {
    const error = Object.assign(new Error('private document and credential'), { code: 'secret-token', source: 'raw payload', credential: 'private' })
    const onError = vi.fn()
    const loop = createKnowledgeRuntimeLoop({ run: async () => { throw error }, onError, random: () => 0 })
    loop.start()
    await vi.advanceTimersByTimeAsync(0)
    const event = onError.mock.calls[0][0]
    expect(Object.keys(event).sort()).toEqual(['code', 'consecutiveFailures', 'message', 'retryBudgetExhausted', 'retryInMs'])
    expect(JSON.stringify(event)).not.toMatch(/private|secret-token|raw payload/)
    const snapshot = loop.getStatus()
    snapshot.consecutiveFailures = 999
    expect(loop.getStatus().consecutiveFailures).toBe(1)
    await loop.stop()
  })

  it('keeps direct runOnce results and original rejection available to its authorized caller', async () => {
    const error = new Error('original rejection')
    const onError = vi.fn()
    const loop = createKnowledgeRuntimeLoop({ run: vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(42), onError })
    await expect(loop.runOnce()).rejects.toBe(error)
    await expect(loop.runOnce()).resolves.toBe(42)
    expect(onError).not.toHaveBeenCalled()
    expect(loop.getStatus()).toMatchObject({ active: false, consecutiveFailures: 0 })
  })

  it('does not let an old pass schedule a second loop after stop followed by start', async () => {
    const pending = deferred()
    const run = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined)
    const loop = createKnowledgeRuntimeLoop({ run })
    loop.start()
    await Promise.resolve()
    const stopping = loop.stop()
    loop.start()
    pending.resolve()
    await stopping
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(2)
    await loop.stop()
  })

  it.each([
    { intervalMs: 9 }, { intervalMs: 2147483648 },
    { intervalMs: 1000, maxRetryIntervalMs: 999 },
    { maxRetryIntervalMs: Infinity }, { retryBudget: 0 },
    { retryBudget: 1.5 }, { random: 'invalid' },
  ])('rejects invalid timing configuration %j before any work', (settings) => {
    const run = vi.fn()
    expect(() => createKnowledgeRuntimeLoop({ run, ...settings })).toThrow(/Invalid/)
    expect(run).not.toHaveBeenCalled()
  })

  it('contains callbacks outside the scheduler, including rejected promises', async () => {
    expect(() => notifyKnowledgeWorkerObserver(() => { throw new Error('observer') }, { code: 'KNOWN' })).not.toThrow()
    notifyKnowledgeWorkerObserver(() => Promise.reject(new Error('observer')), { code: 'KNOWN' })
    await Promise.resolve()
  })
})
