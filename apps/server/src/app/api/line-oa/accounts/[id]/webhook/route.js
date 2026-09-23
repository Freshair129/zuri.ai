import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { serverLinePorts } from '@/modules/line-oa-studio/application/server-line-runtime'
import { admitCapturedLineEvents, markLineAdmissionIntent } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { verifyServerLineWebhook } from '@/platform/integrations/providers/line/server-line-transport'
import { createLineOaEvidenceRecorder } from '@/platform/integrations/providers/line/line-oa-evidence'
import { resolveCorrelationId } from '@/lib/observability/correlation'
// @req FR-149 — native signed webhook; persist the admission outbox marker before 2xx.
// @spec ADR-061, SEC-001, FR-081
// @tested tests/integration/server-line-webhook.test.js
async function boundedBody(request) {
  const reader = request.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 1024 * 1024) {
        await reader.cancel()
        throw Object.assign(new Error('LINE_BODY_TOO_LARGE'), { status: 413 })
      }
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks, size)
  } finally { reader.releaseLock() }
}
export const dynamic = 'force-dynamic'
export function createServerLineWebhookPost({ db = prisma, ports = serverLinePorts,
  evidenceFactory = createLineOaEvidenceRecorder, admitCaptured = admitCapturedLineEvents,
  markAdmissionIntent = markLineAdmissionIntent } = {}) {
  return async (request, { params }) => {
    const ingressReceivedAt = new Date()
    const { correlationId } = resolveCorrelationId(request.headers)
    try {
      const account = await ports().resolveAccount(params?.id)
      const bytes = await boundedBody(request)
      if (bytes.length > 1024 * 1024) return NextResponse.json({ error: 'LINE_BODY_TOO_LARGE', correlationId }, { status: 413 })
      const body = verifyServerLineWebhook({ rawBody: bytes, signature: request.headers.get('x-line-signature'), account })
      const evidence = await evidenceFactory({ db, tenantId: account.tenantId, businessId: account.businessId, destination: account.destination })
      if (!evidence || evidence.connectionId !== account.connectionId) throw new Error('LINE_EVIDENCE_UNAVAILABLE')
      // The 2xx means this event has a restart-recoverable handoff. A raw evidence
      // row alone is insufficient: persist ADMITTING before acknowledging so the
      // bounded reconciler can recover if this process stops immediately afterwards.
      //
      // Admission runs ~25-30 sequential queries against a remote Postgres and took 7-11 s here,
      // far past what LINE waits for: measured on production 2026-09-09, the first delivery of a
      // new message got no response at all, and LINE redelivered the same webhookEventId four
      // times at 62 s intervals (`isRedelivery: true`). The owner still saw exactly one reply —
      // record and admit are both idempotent — but every genuinely new message was reported to
      // LINE as a failed delivery, and the retries only answered fast because they deduped.
      //
      // Raw capture is followed by a durable ADMITTING outbox marker before 2xx.
      // If either write fails, LINE receives non-2xx and may redeliver. After the
      // marker, this continuation is only a latency hint: the durable reconciler
      // is the recovery path and does not depend on this process staying alive.
      //
      // One event must not discard its neighbours, so a failure here is counted and the loop
      // continues. Classifying admission failures — which are deterministic, which are worth
      // retrying — now belongs to the service that admits them, not to this loop.
      let unresolved = 0
      const captured = []
      for (const event of body.events) {
        try {
          const record = await evidence.record({ body, event })
          captured.push({ event, rawRecordId: record?.rawRecordId ?? null })
        } catch (error) {
          unresolved += 1
          // DIAGNOSTIC ONLY (2026-09-08): no event material, no secrets — status/code/
          // name/message and a short stack excerpt, so a silent capture failure is
          // not invisible to the operator. This path swallowed every error before.
          console.error(JSON.stringify({
            scope: 'line-webhook-event-capture', correlationId,
            status: error?.status ?? null, code: error?.code ?? null,
            name: error?.name ?? null, message: error?.message ?? null,
            stack: (error?.stack ?? '').split('\n').slice(0, 3).join(' | '),
          }))
        }
      }
      if (captured.length) await markAdmissionIntent({ db, entries: captured })
      // Deliberately not awaited — this is the whole point. Its own failures are logged and
      // labelled on the durable outbox row; nothing here can reject into the response path. It runs
      // even when a sibling failed to record, so one unstorable event does not hold up the rest.
      if (captured.length) {
        const admission = admitCaptured({ db, account, entries: captured, correlationId, ingressReceivedAt })
        if (typeof admission?.catch === 'function') admission.catch(() => {})
      }
      // An event we could not store is only recoverable through redelivery, so it alone decides
      // the status code. Its captured siblings are already admitted above, and both record and
      // admit are idempotent, so the redelivery that follows costs a duplicate of nothing.
      if (unresolved) return NextResponse.json({ error: 'LINE_WEBHOOK_NOT_ACCEPTED', correlationId }, { status: 503 })
      // `captured` is a count, never event material.
      return NextResponse.json({ accepted: true, correlationId, captured: captured.length })
    } catch (error) {
      // Do not echo parser/provider errors or event material. Non-2xx asks LINE to redeliver.
      const status = [400,401,403,404,409,413,503].includes(error?.status) ? error.status : 503
      // DIAGNOSTIC ONLY (2026-09-08): see the inner catch above for why this exists.
      console.error(JSON.stringify({
        scope: 'line-webhook-request', correlationId,
        status: error?.status ?? null, code: error?.code ?? null,
        name: error?.name ?? null, message: error?.message ?? null,
        stack: (error?.stack ?? '').split('\n').slice(0, 3).join(' | '),
      }))
      return NextResponse.json({ error: 'LINE_WEBHOOK_NOT_ACCEPTED', correlationId }, { status })
    }
  }
}
export const POST = createServerLineWebhookPost()
