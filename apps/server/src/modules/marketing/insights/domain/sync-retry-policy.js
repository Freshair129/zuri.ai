// Marketing Insights (S6) — B4: sync retry policy. Pure: given an error
// classification and the attempt so far, decide RETRY / DEFERRED /
// FINAL_FAILURE. The clock and any provider-supplied delay are parameters,
// never read live.
//
// @spec docs/migrations/service-extraction/INSIGHTS-CONTRACT-RECONCILIATION.md
//   (R-12), contract §5 ("retry once after 5 min, then alert")
// @tested tests/unit/marketing/insights/sync-retry-policy.test.js
//
// Rules (contract §5, read literally): one retry, five minutes later.
// Permanent classes (auth, schema, permission) never retry — a fifth minute
// would not fix a wrong credential or a wrong Business. A provider
// Retry-After longer than five minutes is honoured exactly, recorded as
// DEFERRED, and never shortened back to five. Anything else that is not
// permanent is treated as transient and gets the one retry.

export const RETRY_DELAY_MS = 5 * 60 * 1000

export const ERROR_CLASS = Object.freeze({
  AUTH: 'AUTH',
  SCHEMA: 'SCHEMA',
  PERMISSION: 'PERMISSION',
  TRANSIENT: 'TRANSIENT',
  UNKNOWN: 'UNKNOWN',
})

const PERMANENT_CLASSES = new Set([ERROR_CLASS.AUTH, ERROR_CLASS.SCHEMA, ERROR_CLASS.PERMISSION])

// The reason code an eventual FINAL_FAILURE hands to the alert body builder.
// Kept as a closed map so an unclassified error never invents its own code.
export const RETRY_REASON_TO_ALERT_CODE = Object.freeze({
  [ERROR_CLASS.AUTH]: 'AUTH_ERROR',
  [ERROR_CLASS.SCHEMA]: 'SCHEMA_ERROR',
  [ERROR_CLASS.PERMISSION]: 'PERMISSION_ERROR',
  [ERROR_CLASS.TRANSIENT]: 'TRANSIENT_ERROR',
  [ERROR_CLASS.UNKNOWN]: 'UNKNOWN_ERROR',
})

export const RETRY_ACTIONS = Object.freeze(['RETRY', 'DEFERRED', 'FINAL_FAILURE'])

/**
 * `attempt` counts completed tries so far (1 after the first failure).
 * `retryAfterMs`, if the provider supplied one, is honoured verbatim once it
 * exceeds the five-minute default; a shorter or absent one keeps the default.
 */
export function decideRetry({
  attempt, errorClass, retryAfterMs = null, nowMs,
} = {}) {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('decideRetry requires attempt >= 1')
  if (!Number.isFinite(nowMs)) throw new Error('decideRetry requires nowMs')
  const alertCode = RETRY_REASON_TO_ALERT_CODE[errorClass] ?? RETRY_REASON_TO_ALERT_CODE[ERROR_CLASS.UNKNOWN]

  if (PERMANENT_CLASSES.has(errorClass)) {
    return {
      action: 'FINAL_FAILURE', alertCode, retryAtMs: null, delayMs: null,
    }
  }
  if (attempt >= 2) {
    return {
      action: 'FINAL_FAILURE', alertCode, retryAtMs: null, delayMs: null,
    }
  }
  if (Number.isFinite(retryAfterMs) && retryAfterMs > RETRY_DELAY_MS) {
    return {
      action: 'DEFERRED', alertCode: null, retryAtMs: nowMs + retryAfterMs, delayMs: retryAfterMs,
    }
  }
  return {
    action: 'RETRY', alertCode: null, retryAtMs: nowMs + RETRY_DELAY_MS, delayMs: RETRY_DELAY_MS,
  }
}

/**
 * A final-failure decision triggers exactly one notification. Call this once
 * per decideRetry() result rather than once per attempt: only a
 * FINAL_FAILURE action ever asks for one, so RETRY and DEFERRED are silent.
 */
export function notificationForDecision(decision, { syncRunId, failureKey }) {
  if (decision.action !== 'FINAL_FAILURE') return null
  return { syncRunId, failureKey, reasonCode: decision.alertCode }
}
