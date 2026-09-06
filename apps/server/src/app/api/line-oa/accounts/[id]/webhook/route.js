import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { serverLinePorts } from '@/modules/line-oa-studio/application/server-line-runtime'
import { admitLineConversation } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { verifyServerLineWebhook } from '@/platform/integrations/providers/line/server-line-transport'
import { createLineOaEvidenceRecorder } from '@/platform/integrations/providers/line/line-oa-evidence'
import { resolveCorrelationId } from '@/lib/observability/correlation'
// @req FR-149 — native signed webhook; acknowledge only durable admission.
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
// Statuses that mean "this event will fail the same way next time".
const DETERMINISTIC = [400, 403, 404, 409, 413]
export function createServerLineWebhookPost({ db = prisma, ports = serverLinePorts,
  evidenceFactory = createLineOaEvidenceRecorder, admit = admitLineConversation } = {}) {
  return async (request, { params }) => {
    const { correlationId } = resolveCorrelationId(request.headers)
    try {
      const account = await ports().resolveAccount(params?.id)
      const bytes = await boundedBody(request)
      if (bytes.length > 1024 * 1024) return NextResponse.json({ error: 'LINE_BODY_TOO_LARGE', correlationId }, { status: 413 })
      const body = verifyServerLineWebhook({ rawBody: bytes, signature: request.headers.get('x-line-signature'), account })
      const evidence = await evidenceFactory({ db, tenantId: account.tenantId, businessId: account.businessId, destination: account.destination })
      if (!evidence || evidence.connectionId !== account.connectionId) throw new Error('LINE_EVIDENCE_UNAVAILABLE')
      // One event must not discard its neighbours. A deterministic rejection
      // (4xx — an identity conflict on one user, an over-long text) fails
      // identically on every redelivery, so aborting the batch means every
      // later event in it is never admitted at all: other customers' messages
      // are lost while the endpoint merely looks unhealthy. Skip those and keep
      // going. An ambiguous failure still returns non-2xx after the whole batch
      // is attempted, because redelivery is the only way to recover it — and
      // both `record` and `admit` are idempotent on redelivery, the property
      // the partial-batch replay test already pins.
      let unresolved = 0
      let skipped = 0
      for (const event of body.events) {
        try {
          await evidence.record({ body, event })
          await admit({ db, account, event, correlationId })
        } catch (error) {
          if (DETERMINISTIC.includes(error?.status)) skipped += 1
          else unresolved += 1
        }
      }
      if (unresolved) return NextResponse.json({ error: 'LINE_WEBHOOK_NOT_ACCEPTED', correlationId }, { status: 503 })
      // `skipped` is a count, never event material — the one signal an operator
      // gets that admitted events are fewer than delivered ones.
      return NextResponse.json({ accepted: true, correlationId, ...(skipped ? { skipped } : {}) })
    } catch (error) {
      // Do not echo parser/provider errors or event material. Non-2xx asks LINE to redeliver.
      const status = [400,401,403,404,409,413,503].includes(error?.status) ? error.status : 503
      return NextResponse.json({ error: 'LINE_WEBHOOK_NOT_ACCEPTED', correlationId }, { status })
    }
  }
}
export const POST = createServerLineWebhookPost()
