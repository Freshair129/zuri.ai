// @req FR-109 — process retries do not create execution attempts or stage outcomes.
// @req FR-173 — drainable admission/source lifecycle with safe operational observers.
// @spec ADR-073
// @tested tests/unit/knowledge-runtime-loop.test.js

const MAX_TIMER_MS = 2_147_483_647

/** Observers never decide whether a durable job succeeds, retries or releases its lease. */
export function notifyKnowledgeWorkerObserver(observer, event) {
  if (typeof observer !== 'function') return
  try { Promise.resolve(observer(event)).catch(() => {}) } catch { /* Diagnostic delivery cannot stop execution. */ }
}

/** Process-local scheduling only: the caller continues to own durable recovery and authority. */
export function createKnowledgeRuntimeLoop({ run, intervalMs = 1000, maxRetryIntervalMs = Math.max(60_000, intervalMs), retryBudget = 5, random = Math.random, onError } = {}) {
  if (typeof run !== 'function' || typeof random !== 'function'
    || !Number.isSafeInteger(intervalMs) || intervalMs < 10 || intervalMs > MAX_TIMER_MS
    || !Number.isSafeInteger(maxRetryIntervalMs) || maxRetryIntervalMs < intervalMs || maxRetryIntervalMs > MAX_TIMER_MS
    || !Number.isSafeInteger(retryBudget) || retryBudget < 1) throw new Error('Invalid knowledge worker scheduling configuration')

  let active = false, timer = null, inFlight = null, epoch = 0
  let consecutiveFailures = 0, nextRunAt = null, lastStartedAt = null, lastFinishedAt = null, lastOutcome = null

  function getStatus() {
    return {
      active, running: inFlight !== null, consecutiveFailures,
      retryBudgetExhausted: consecutiveFailures >= retryBudget,
      nextRunAt, lastStartedAt, lastFinishedAt, lastOutcome,
    }
  }

  function runOnce() {
    if (inFlight) return inFlight
    lastStartedAt = Date.now()
    inFlight = Promise.resolve().then(run).then((result) => {
      // Admission contains per-job exceptions to preserve durable classification and lease cleanup.
      // A handled transient failure must still slow the background loop without changing runOnce's result.
      const retryPending = Number.isSafeInteger(result?.retryableFailures) && result.retryableFailures > 0
      consecutiveFailures = retryPending ? Math.min(Number.MAX_SAFE_INTEGER, consecutiveFailures + 1) : 0
      lastOutcome = retryPending ? 'RETRY_PENDING' : 'SUCCEEDED'
      return result
    }, (error) => {
      consecutiveFailures = Math.min(Number.MAX_SAFE_INTEGER, consecutiveFailures + 1)
      lastOutcome = 'FAILED'
      throw error
    }).finally(() => {
      lastFinishedAt = Date.now()
      inFlight = null
    })
    return inFlight
  }

  function retryDelay() {
    const exponent = Math.min(consecutiveFailures - 1, Math.ceil(Math.log2(maxRetryIntervalMs / intervalMs)))
    const ceiling = consecutiveFailures >= retryBudget ? maxRetryIntervalMs : Math.min(maxRetryIntervalMs, intervalMs * 2 ** exponent)
    let sample = 0.5
    try {
      const value = random()
      if (Number.isFinite(value) && value >= 0 && value <= 1) sample = value
    } catch { /* A diagnostic/test random source cannot terminate the loop. */ }
    return Math.max(10, Math.floor(ceiling / 2 + sample * ceiling / 2))
  }

  async function tick(generation) {
    let delay = intervalMs
    let retryPending = false
    try { await runOnce(); retryPending = lastOutcome === 'RETRY_PENDING' } catch { retryPending = true } finally {
      if (retryPending) {
        delay = retryDelay()
        notifyKnowledgeWorkerObserver(onError, Object.freeze({
          code: consecutiveFailures >= retryBudget ? 'KNOWLEDGE_WORKER_RETRY_BUDGET' : 'KNOWLEDGE_WORKER_RETRY',
          message: 'Knowledge worker pass requires retry',
          consecutiveFailures, retryBudgetExhausted: consecutiveFailures >= retryBudget, retryInMs: delay,
        }))
      }
      // A stopped/restarted generation must not schedule a second timer when its old pass settles.
      if (active && epoch === generation) {
        nextRunAt = Date.now() + delay
        timer = setTimeout(() => { timer = null; nextRunAt = null; void tick(generation) }, delay)
        timer.unref?.()
      }
    }
  }

  return {
    runOnce, getStatus,
    start() {
      if (active) return
      active = true
      epoch += 1
      void tick(epoch)
    },
    async stop() {
      active = false
      epoch += 1
      clearTimeout(timer)
      timer = null
      nextRunAt = null
      // The background path reports failure; direct runOnce callers retain the original rejection.
      await inFlight?.catch(() => {})
    },
  }
}
