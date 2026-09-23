// @req FR-149 — durable job polling is owned by the Conversation Runtime process.
// @spec ADR-106 D1/D4, SDD-108 — idle backoff, no process-local queue authority.
// @tested services/conversation-runtime/test/worker-loop.test.js
export function createWorkerLoop({ runtime, logger = () => {}, idleStartMs = 500, idleMaxMs = 10_000 } = {}) {
  if (!runtime || typeof runtime.runOne !== 'function') throw new Error('WORKER_RUNTIME_REQUIRED')
  let stopping = false
  let idleMs = idleStartMs
  let current = null
  async function run({ signal } = {}) {
    while (!stopping && !signal?.aborted) {
      try {
        current = runtime.runOne({ signal })
        const result = await current
        current = null
        logger({ event: 'conversation-runtime.tick', status: result?.status ?? 'UNKNOWN' })
        if (result?.status === 'IDLE') {
          await new Promise(resolve => setTimeout(resolve, idleMs))
          idleMs = Math.min(idleMaxMs, Math.max(idleStartMs, idleMs * 2))
        } else idleMs = idleStartMs
      } catch (error) {
        current = null
        logger({ event: 'conversation-runtime.unavailable', code: safeCode(error) })
        await new Promise(resolve => setTimeout(resolve, idleMs))
        idleMs = Math.min(idleMaxMs, Math.max(idleStartMs, idleMs * 2))
      }
    }
  }
  async function stop() {
    stopping = true
    await current?.catch(() => {})
  }
  return Object.freeze({ run, stop })
}

function safeCode(error) {
  return typeof error?.code === 'string' && /^[A-Z0-9_:-]{1,80}$/.test(error.code) ? error.code : 'WORKER_UNAVAILABLE'
}
