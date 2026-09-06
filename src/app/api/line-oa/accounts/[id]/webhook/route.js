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
      for (const event of body.events) {
        await evidence.record({ body, event })
        await admit({ db, account, event, correlationId })
      }
      return NextResponse.json({ accepted: true, correlationId })
    } catch (error) {
      // Do not echo parser/provider errors or event material. Non-2xx asks LINE to redeliver.
      const status = [400,401,403,404,409,413,503].includes(error?.status) ? error.status : 503
      return NextResponse.json({ error: 'LINE_WEBHOOK_NOT_ACCEPTED', correlationId }, { status })
    }
  }
}
export const POST = createServerLineWebhookPost()
