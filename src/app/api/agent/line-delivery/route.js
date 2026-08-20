import { z } from 'zod'
import { handle } from '../../_helpers'
import { createPhase1BusinessAgentPortsFromEnv, resolvePhase1RequestScope } from '@/modules/agent'
import { recordLineReply, zReplyReceipt } from '@/modules/crm/reply-record-service'
import { logger as defaultLogger } from '@/lib/observability/logger'
import { resolveCorrelationId } from '@/lib/observability/correlation'

// @req FR-093 — the transport owner reports what it actually sent, and the reply
//   becomes a row. Until this route existed the outbound half of every conversation
//   was delivered to the customer and then lost.
// @spec SDD-051, BR-011 — the reply owner is the edge runtime; this is the seam where
//   it tells us what the customer received. Which matters because the two can differ:
//   when the stack cannot answer, the transport sends its own fallback, and only the
//   sender knows which text went out.
// @spec FR-052, SEC-001, SEC-010 — scope comes from the same binding seam as the
//   webhook; client-selected scope is a non-production compatibility branch only.
// @spec NFR-017, SDD-048 — one correlation id per batch, echoed on every record and
//   onto the audit row, so a reply joins the webhook delivery that produced it.
// @tested tests/integration/line-reply-record.test.js

export const dynamic = 'force-dynamic'

const zBody = z.object({
  bindingId: z.string().uuid().optional(),
  destination: z.string().min(1).optional(),
  tenantId: z.string().min(1).optional(),
  businessId: z.string().optional(),
  deliveries: z.array(zReplyReceipt).max(100).default([]),
})

/**
 * POST a batch of delivery receipts.
 *
 * Batched, and per-receipt failures are captured rather than thrown, for the same
 * reason the webhook does it: a transport that has already sent three replies must be
 * able to report all three. Losing two records because the first was malformed would
 * reintroduce exactly the silent loss this route exists to end.
 */
export function createLineDeliveryPost({
  runtimeFactory = createPhase1BusinessAgentPortsFromEnv,
  recorder = recordLineReply,
  logger = defaultLogger,
  clock = () => Date.now(),
} = {}) {
  return async function lineDeliveryPost(request) {
    const { correlationId, source: correlationSource } = resolveCorrelationId(request.headers)
    const startedAt = clock()

    return handle(async () => {
      const body = zBody.parse(await request.json())

      let scope
      try {
        const runtime = await runtimeFactory()
        scope = await resolvePhase1RequestScope({ runtime, headers: request.headers, body })
      } catch (err) {
        // A batch-level rejection is true of every receipt in it, so it still throws —
        // but never without a record naming the stage that refused it.
        logger.warn('line.delivery.rejected', {
          correlationId,
          correlationSource,
          stage: 'SCOPE',
          errorCode: err?.message,
          received: body.deliveries.length,
          durationMs: clock() - startedAt,
        })
        throw err
      }

      const results = []
      for (const receipt of body.deliveries) {
        const receiptStartedAt = clock()
        try {
          const recorded = await recorder({ tenantId: scope.tenantId, receipt, correlationId })
          logger.info('line.delivery.recorded', {
            correlationId,
            correlationSource,
            tenantId: scope.tenantId,
            businessId: scope.businessId ?? undefined,
            conversationId: recorded.conversationId,
            messageId: recorded.messageId,
            stage: 'RECORD',
            outcome: recorded.created ? 'OK' : 'DUPLICATE',
            durationMs: clock() - receiptStartedAt,
          })
          results.push({
            ok: true,
            correlationId,
            inboundMessageId: receipt.inboundMessageId,
            conversationId: recorded.conversationId,
            messageId: recorded.messageId,
            created: recorded.created,
          })
        } catch (err) {
          logger.error('line.delivery.recorded', {
            correlationId,
            correlationSource,
            tenantId: scope.tenantId,
            stage: 'RECORD',
            outcome: 'FAILED',
            errorCode: err?.message,
            durationMs: clock() - receiptStartedAt,
          })
          results.push({
            ok: false,
            correlationId,
            inboundMessageId: receipt.inboundMessageId,
            stage: 'RECORD',
            error: err?.message || 'reply record failed',
          })
        }
      }

      const recorded = results.filter((result) => result.ok).length
      logger.info('line.delivery.completed', {
        correlationId,
        correlationSource,
        tenantId: scope.tenantId,
        businessId: scope.businessId ?? undefined,
        received: body.deliveries.length,
        handled: recorded,
        failed: results.length - recorded,
        durationMs: clock() - startedAt,
      })

      return { correlationId, received: body.deliveries.length, recorded, results }
    })
  }
}

export const POST = createLineDeliveryPost()
