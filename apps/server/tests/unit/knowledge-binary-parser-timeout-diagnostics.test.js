// @req FR-288 — managed binary projection and immutable source locations.
// @spec SDD-114 — versioned binary source projection and bounded parsing.
// @tested tests/unit/knowledge-binary-parser-timeout-diagnostics.test.js
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

const workerState = vi.hoisted(() => ({ instances: [] }))
const clock = vi.hoisted(() => ({ now: 100 }))

vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    Worker: class FakeWorker extends EventEmitter {
      constructor() {
        super()
        workerState.instances.push(this)
        setTimeout(() => {
          clock.now = 105
          this.emit('online')
        }, 0)
      }

      terminate() {
        return Promise.resolve(1)
      }
    },
  }
})

import { KNOWLEDGE_BINARY_TIMEOUT_MS, parseKnowledgeBinary } from '@/modules/knowledge/knowledge-binary-parser'

describe('binary parser timeout diagnostics', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    workerState.instances.length = 0
    clock.now = 100
  })

  it('records monotonic phase and timer overshoot when the unchanged guard fires', async () => {
    const { performance } = await import('node:perf_hooks')
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now)
    vi.useFakeTimers()
    const bytes = readFileSync(new URL('../fixtures/knowledge-binary/basic.pdf', import.meta.url))
    const pending = parseKnowledgeBinary({ bytes, mediaType: 'application/pdf' })
    const settled = pending.then(() => null, (cause) => cause)

    await vi.advanceTimersByTimeAsync(0)
    expect(workerState.instances).toHaveLength(1)
    clock.now = 60_115
    await vi.advanceTimersByTimeAsync(KNOWLEDGE_BINARY_TIMEOUT_MS)

    const error = await settled
    expect(error).toMatchObject({ code: 'PARSER_TIMEOUT', status: 408 })
    expect(error.parserDiagnostics).toMatchObject({
      phase: 'worker-online',
      elapsedMs: KNOWLEDGE_BINARY_TIMEOUT_MS + 15,
      phaseElapsedMs: KNOWLEDGE_BINARY_TIMEOUT_MS + 10,
      timeoutOvershootMs: 15,
      phaseHistory: [
        { phase: 'worker-constructed', startedAfterMs: 0, durationMs: 5 },
        { phase: 'worker-online', startedAfterMs: 5, durationMs: KNOWLEDGE_BINARY_TIMEOUT_MS + 10 },
      ],
      workerLifecycle: {
        onlineElapsedMs: 5,
        terminationRequestedElapsedMs: KNOWLEDGE_BINARY_TIMEOUT_MS + 15,
        terminationStatus: expect.stringMatching(/^(pending|completed)$/u),
      },
    })
  })
})
