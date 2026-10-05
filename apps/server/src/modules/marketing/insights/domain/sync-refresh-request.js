// Marketing Insights (S6) — B4: manual refresh request policy. Pure: no
// scheduler, no queue, no live call. Given a request and the currently open
// runs, decide ACCEPTED / COALESCED, or refuse a conflicting reuse of an
// idempotency key.
//
// @spec docs/migrations/service-extraction/INSIGHTS-CONTRACT-RECONCILIATION.md
//   (R-12 refresh control endpoint), contract §5 ("refresh now" trigger)
// @tested tests/unit/marketing/insights/sync-refresh-request.test.js
//
// A manual refresh never returns report data: it returns only
// { syncRunId, state }. state is ACCEPTED for a new request or the exact
// retry of one already accepted under the same idempotencyKey, and COALESCED
// when an equivalent request (same asset/dataset/window) is already open —
// the caller gets the existing run's id back instead of starting a second
// one. Reusing an idempotencyKey for a different asset, dataset or window is
// a conflict, never a silent overwrite.

import { z } from 'zod'

export const REFRESH_DATASETS = Object.freeze(['DAILY_OBSERVATIONS', 'CONTENT'])
export const REFRESH_STATES = Object.freeze(['ACCEPTED', 'COALESCED'])

export const zRefreshRequest = z.object({
  assetId: z.string().min(1).max(200),
  dataset: z.enum(REFRESH_DATASETS),
  window: z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).strict(),
  idempotencyKey: z.string().min(1).max(128),
}).strict()

export class SyncPolicyError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SyncPolicyError'
    this.code = code
    this.status = code === 'IDEMPOTENCY_KEY_CONFLICT' ? 409 : 400
  }
}

/** The identity of the underlying work, independent of the idempotency key. */
export function refreshRequestSignature({ assetId, dataset, window }) {
  return `${assetId}|${dataset}|${window.from}|${window.to}`
}

/**
 * `pendingRuns` are the runs the caller still considers open (ACCEPTED,
 * RUNNING, RETRY_SCHEDULED or DEFERRED) — a finished run coalesces nothing.
 * Each entry needs `{ syncRunId, idempotencyKey, requestSignature }`.
 */
export function planRefreshRequest({ request, pendingRuns = [], generateSyncRunId } = {}) {
  const parsed = zRefreshRequest.parse(request)
  const signature = refreshRequestSignature(parsed)

  const sameKey = pendingRuns.find((run) => run.idempotencyKey === parsed.idempotencyKey)
  if (sameKey) {
    if (sameKey.requestSignature !== signature) {
      throw new SyncPolicyError('IDEMPOTENCY_KEY_CONFLICT', 'idempotencyKey was already used for a different asset, dataset or window')
    }
    return { state: 'ACCEPTED', syncRunId: sameKey.syncRunId, requestSignature: signature }
  }

  const matchingPending = pendingRuns.find((run) => run.requestSignature === signature)
  if (matchingPending) {
    return { state: 'COALESCED', syncRunId: matchingPending.syncRunId, requestSignature: signature }
  }

  if (typeof generateSyncRunId !== 'function') throw new Error('planRefreshRequest requires generateSyncRunId()')
  return { state: 'ACCEPTED', syncRunId: generateSyncRunId(), requestSignature: signature }
}
