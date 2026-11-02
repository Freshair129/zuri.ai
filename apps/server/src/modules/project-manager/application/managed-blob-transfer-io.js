// @req FR-293 — provider calls have finite per-operation and per-worker bounds.
// @spec ADR-115, SEC-008
// @tested tests/unit/managed-blob-transfer-io.test.js
const timeoutError = () => Object.assign(new Error('Managed blob transfer provider operation timed out'), {
  status: 503, code: 'MANAGED_BLOB_TRANSFER_PROVIDER_TIMEOUT',
})

export async function runManagedBlobTransferProviderCall(operation, {
  timeoutMs = 20_000, deadlineAt = Number.POSITIVE_INFINITY, clock = () => Date.now(),
} = {}) {
  if (typeof operation !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1
    || !(Number.isFinite(deadlineAt) || deadlineAt === Number.POSITIVE_INFINITY)
    || typeof clock !== 'function') {
    throw Object.assign(new Error('Managed blob transfer provider profile unavailable'), {
      status: 503, code: 'MANAGED_BLOB_TRANSFER_PROFILE_UNAVAILABLE',
    })
  }
  const remaining = deadlineAt - clock(), boundedMs = Math.min(timeoutMs, remaining)
  if (boundedMs <= 0) throw timeoutError()
  const controller = new AbortController()
  let timer, timedOut = false
  const work = Promise.resolve().then(() => operation(controller.signal))
  // Keep a late rejection observed after the bounded race has already timed out.
  work.catch(() => {})
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(timeoutError())
    }, boundedMs)
  })
  try {
    return await Promise.race([work, timeout])
  } catch (error) {
    if (timedOut) throw timeoutError()
    throw error
  } finally {
    clearTimeout(timer)
  }
}
