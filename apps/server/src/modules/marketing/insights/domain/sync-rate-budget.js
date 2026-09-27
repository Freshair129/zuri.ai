// Marketing Insights (S6) — B4: shared call-rate budget. Pure: given a log of
// past call timestamps and a number of planned calls, decide how many may run
// now and when the remainder may run. No timer, no queue, no live call.
//
// @spec docs/migrations/service-extraction/INSIGHTS-CONTRACT-RECONCILIATION.md
//   (R-17), contract §5 ("do not exceed 200 calls/hour/app")
// @tested tests/unit/marketing/insights/sync-rate-budget.test.js
//
// The cap is shared across every worker that reads through this budget: pass
// the same callLog to every planner in the same app, not one log per worker.
// The caller is the one who appends the calls it actually makes; this
// function only plans, it never records.

export const CALLS_PER_HOUR_CAP = 200
const HOUR_MS = 60 * 60 * 1000

/**
 * `callLog` is a list of epoch-ms timestamps for calls already made in the
 * trailing hour (older entries are ignored, not required to be pre-filtered).
 * `plannedCalls` is how many more this caller wants to make right now.
 */
export function planCallBudget({ callLog = [], plannedCalls, nowMs } = {}) {
  if (!Number.isInteger(plannedCalls) || plannedCalls < 0) throw new Error('planCallBudget requires plannedCalls >= 0')
  if (!Number.isFinite(nowMs)) throw new Error('planCallBudget requires nowMs')
  const windowStart = nowMs - HOUR_MS
  const inWindow = callLog.filter((ts) => Number.isFinite(ts) && ts > windowStart && ts <= nowMs).sort((a, b) => a - b)
  const remaining = Math.max(0, CALLS_PER_HOUR_CAP - inWindow.length)
  const allowed = Math.min(plannedCalls, remaining)
  const deferredCalls = plannedCalls - allowed
  // With no relevant history, the calls allowed now still occupy the coming
  // hour, so the earliest a deferred call may run is one hour from now.
  const oldestRelevantMs = inWindow.length > 0 ? inWindow[0] : nowMs
  const deferredUntilMs = deferredCalls > 0 ? oldestRelevantMs + HOUR_MS : null
  return { allowed, deferredCalls, deferredUntilMs }
}
