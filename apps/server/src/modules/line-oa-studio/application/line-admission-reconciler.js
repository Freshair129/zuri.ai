import prisma from '@/lib/db'
import { LINE_OA_PROVIDER } from '@/platform/integrations/providers/line/line-oa-webhook'
import { admitLineConversation } from './line-conversation-jobs'

// @req FR-149 — the webhook route (app/api/line-oa/accounts/[id]/webhook/route.js)
//   acknowledges LINE as soon as an event is captured as `RawExternalRecord`
//   evidence, then runs `admitCapturedLineEvents` afterwards, in-process and
//   NOT awaited by the response. If the process dies between the ack and that
//   admission finishing — a deploy is the likely case, since Docker's default
//   `stop_grace_period` is 10s while a retried admission can run ~40s
//   (`ADMISSION_RETRY_DELAYS_MS` = 4s + 12s, plus attempts) — the event is
//   captured forever but never admitted, and nothing else retries it. This
//   module is that retry: a polled sweep of rows another fleet's work labels
//   `ADMITTING` before the first admission attempt, so a row stuck there past
//   a stale threshold is evidence of exactly this crash, not of work in flight.
// @spec ADR-061, SEC-001 — a device never sends; admission still owns the
//   queue and the CRM write, and this reconciler changes neither rule — it
//   only calls the same `admitLineConversation` the live path calls.
// @tested tests/integration/line-admission-reconciler.test.js
//
// VOCABULARY — do not add a sixth value.
// `RawExternalRecord.processingStatus` is RECEIVED → ADMITTING → ADMITTED |
// SKIPPED | FAILED. Only `ADMITTING` rows are candidates here; every other
// status means either "not attempted yet" (RECEIVED — still owned by the
// in-process path, not abandoned) or "already resolved" (ADMITTED/SKIPPED/
// FAILED — never re-admitted by this sweep).
//
// WHY THE RECONCILED EVENT CAN ONLY PUSH, NEVER REPLY
// ----------------------------------------------------
// `normalizeLineWebhookEvent` (line-oa-webhook.js) calls `redactTransientFields`,
// which strips `replyToken` before the event is ever persisted as evidence. So
// a row read back from `RawExternalRecord.payloadJson` never carries one — this
// module also defensively deletes any `replyToken` key on the event it hands to
// `admit`, and a test asserts the key is absent, because that absence is the
// property the rest of this comment depends on. With no token,
// `sealLineReplyToken(event.replyToken, …)` inside `admitLineConversation`
// returns `null`, the job is created with `sealedReplyToken = null` and
// `replyExpiresAt = null`, and `runLineConversationWorker` computes
// `method = sealedReplyToken && replyExpiresAt > at ? 'REPLY' : allowDelayedPush
// ? 'PUSH' : null` — so a reconciled job goes out as PUSH when the account
// allows delayed push, and otherwise terminates as `FAILED /
// REPLY_EXPIRED_PUSH_DISABLED`. That terminal outcome is deliberate and
// correct, not a gap this module should paper over: a visible failure beats
// silence, and a separate Studio surface being built by another worker right
// now counts exactly these rows. Do not add a fallback message, do not force
// PUSH, and do not reach for a reply token — even a token that had survived
// persistence would be dead by the time this runs: LINE's reply token lives on
// the order of a minute, and `staleAfterMs` (60s, see below) guarantees this
// sweep never even looks at a row younger than that.
//
// WHY DOUBLE-ADMISSION CANNOT HAPPEN
// -----------------------------------
// This sweep is not the guarantee against admitting the same event twice —
// the database is. `LineConversationJob` has `@@unique([accountId, eventId])`
// and a unique `inboundMessageId`, and `admitLineConversation` looks up both
// before creating a job: an existing row makes it return `{ created: false,
// jobId: existing.id }` instead of inserting again. So if the in-process retry
// ladder in `admitCapturedLineEvents` finishes concurrently with this sweep
// admitting the same row, the worst case is a labelling race — the row's
// `processingStatus` ends up whichever of the two writes lands last — never a
// second job. That is a cosmetic inconsistency on an evidence label, not a
// data race on the queue.
//
// WHY 60s, AND WHY A POISON ROW IS NOT RETRIED FOREVER
// -------------------------------------------------------
// `staleAfterMs` defaults to 60_000 because the in-process retry ladder in
// `admitCapturedLineEvents` is 4s + 12s between attempts, plus the attempts
// themselves — worst case close to 40s. A shorter threshold would let this
// sweep race a still-running, healthy admission and duplicate its work (safe,
// per above, but wasteful and confusing in the trace). A row this sweep
// attempts and fails is labelled `FAILED` immediately, not retried on the next
// tick: this runs roughly once a second, so an unbounded retry would mean the
// same handful of poisoned rows get re-selected every tick forever and starve
// the queue behind them from ever being looked at.

const DEFAULT_STALE_AFTER_MS = 60_000
const DEFAULT_TAKE = 5

/**
 * Label a `RawExternalRecord` row. Mirrors `markRawRecord` in
 * `line-conversation-jobs.js` (not exported, so re-implemented here rather than
 * reached into): the evidence row is already durable, so losing its label must
 * never lose an admission that already succeeded. Labelling must never throw.
 */
async function markRow(db, id, processingStatus, processingError = null) {
  try {
    await db.rawExternalRecord.update({
      where: { id },
      data: { processingStatus, processingError: processingError ? String(processingError).slice(0, 500) : null },
    })
  } catch { /* label only */ }
}

/**
 * Poll for LINE admissions that were marked `ADMITTING` and never finished —
 * the signature of a process that died mid-admission — and retry each one
 * exactly once per sweep.
 *
 * @param {object} [opts]
 * @param {object} [opts.db] Prisma client (or a transaction handle in tests).
 * @param {Date} [opts.now] clock, injectable for tests.
 * @param {number} [opts.staleAfterMs] floor age (ms) before a row is a candidate.
 * @param {number} [opts.take] max rows per sweep — never scan unboundedly.
 * @param {Function} [opts.admit] injected for tests; defaults to the real `admitLineConversation`.
 * @param {object} [opts.env] passed through to `admit`.
 * @returns {Promise<{scanned:number, admitted:number, skipped:number, failed:number}>}
 */
export async function reconcileAbandonedLineAdmissions({
  db = prisma,
  now = new Date(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  take = DEFAULT_TAKE,
  admit = admitLineConversation,
  env = process.env,
} = {}) {
  const outcome = { scanned: 0, admitted: 0, skipped: 0, failed: 0 }

  // The idle path — no abandoned admissions — is the overwhelmingly common
  // case at a ~1s cadence, so it must cost exactly one indexed query and
  // nothing else. Do not add any read or write before this line.
  const rows = await db.rawExternalRecord.findMany({
    where: {
      provider: LINE_OA_PROVIDER,
      processingStatus: 'ADMITTING',
      receivedAt: { lte: new Date(now.getTime() - staleAfterMs) },
    },
    orderBy: { receivedAt: 'asc' },
    take,
  })
  if (!rows.length) return outcome

  for (const record of rows) {
    outcome.scanned += 1
    // Each row gets its own try/catch: one poisonous row (bad JSON, a
    // surprising throw from `admit`) must never block its neighbours in the
    // same pass — the whole reason this is a bounded sweep over many rows
    // rather than a single all-or-nothing operation.
    try {
      let parsed
      try {
        parsed = JSON.parse(record.payloadJson)
      } catch (parseError) {
        await markRow(db, record.id, 'FAILED', `LINE_RECONCILE_PAYLOAD_INVALID: ${parseError?.message}`)
        outcome.failed += 1
        continue
      }
      const event = parsed?.event
      if (!event || typeof event !== 'object') {
        await markRow(db, record.id, 'FAILED', 'LINE_RECONCILE_EVENT_MISSING')
        outcome.failed += 1
        continue
      }

      // Exact inverse of the check the webhook route makes
      // (`evidence.connectionId !== account.connectionId`): the evidence row
      // names the connection it was captured under, and `integrationConnectionId`
      // is `@unique`, so this needs no secret mount to resolve the account.
      const account = await db.lineOaAccount.findUnique({ where: { integrationConnectionId: record.connectionId } })
      if (!account) {
        await markRow(db, record.id, 'FAILED', 'LINE_RECONCILE_ACCOUNT_NOT_FOUND')
        outcome.failed += 1
        continue
      }

      // See the module comment: replyToken never survives persistence, but the
      // deletion here is deliberate and defensive rather than assumed — the
      // property the rest of this module's push-only reasoning depends on.
      const { replyToken: _replyToken, ...safeEvent } = event

      // Stable and attributable to the reconciliation itself, not a fresh
      // random id per tick — a re-run over the same row (a retried tick after
      // its own failure) should read as the same causal reconciliation attempt.
      const correlationId = `reconcile:${record.id}`

      const result = await admit({
        db, account, event: safeEvent, correlationId, now,
        ingressReceivedAt: record.receivedAt, env,
      })
      // Mirrors `admitCapturedLineEvents`'s own admitted/skipped split exactly.
      const skipped = Boolean(result?.skipped) && !result?.jobId
      await markRow(db, record.id, skipped ? 'SKIPPED' : 'ADMITTED')
      outcome[skipped ? 'skipped' : 'admitted'] += 1
    } catch (error) {
      await markRow(db, record.id, 'FAILED', error?.code || error?.message)
      outcome.failed += 1
    }
  }

  return outcome
}
