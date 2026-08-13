import { z } from 'zod'
import { handle } from '../../_helpers'
import { assertPhase1TransportAuthorization, createPhase1BusinessAgentPortsFromEnv, handleAgentTurn } from '@/modules/agent'

// @req FR-050 — return event-correlated verified reply text/skipReply state to the sole
// LINE transport owner without receiving or consuming the LINE replyToken here.
// @req FR-051 — enabled production requests resolve scope from a server-owned binding.
// @spec BR-011 — zuri-cli is the sole LINE reply owner when stack answering is enabled.
// @spec SDD-026, BR-012, SEC-010 — caller-selected Tenant/Business scope is rejected.

// @req FR-028 — the LINE webhook seam: the zuri-cli LINE bot forwards webhook events
//   here; each text message becomes one end-to-end agent turn (FR-027) at Gate E.
// @spec ADR-007 §P7 — LINE is a channel/shell; the turn runs in Zuri. The legacy-disabled
//   route accepts resolved scope for compatibility, while the enabled production route
//   derives scope only from its configured binding (SDD-026).
// @tested tests/integration/agent-webhook-route.test.js

export const dynamic = 'force-dynamic'

const zLineEvent = z.object({
  webhookEventId: z.string().optional(),
  type: z.string(),
  source: z.object({ userId: z.string().optional(), groupId: z.string().optional(), roomId: z.string().optional() }).optional(),
  message: z.object({ id: z.string().optional(), type: z.string().optional(), text: z.string().optional() }).optional(),
  replyToken: z.string().optional(),
  timestamp: z.number().optional(),
})

const zLegacyBody = z.object({
  tenantId: z.string().min(1),
  businessId: z.string().optional(),
  displayName: z.string().optional(),
  events: z.array(zLineEvent).default([]),
})

const zBoundBody = z.object({
  bindingId: z.string().min(1),
  destination: z.string().min(1),
  displayName: z.string().optional(),
  events: z.array(zLineEvent).default([]),
}).strict()

/**
 * POST a normalized LINE webhook batch. Only text-message events drive a turn;
 * everything else (follow, join, postback, sticker, …) is acknowledged and skipped so
 * the bot's webhook stays 200. A per-event failure is captured, not thrown, so one bad
 * event never drops the rest of the batch.
 */
export async function POST(request) {
  return handle(async () => {
    assertPhase1TransportAuthorization(request.headers)
    const productionBound = process.env.ZURI_LINE_BUSINESS_AGENT_ENABLED === 'true'
    const body = (productionBound ? zBoundBody : zLegacyBody).parse(await request.json())
    const results = []
    const phase1Ports = productionBound ? createPhase1BusinessAgentPortsFromEnv() : null
    const scope = productionBound
      ? await phase1Ports.binding.resolve({ bindingId: body.bindingId, destination: body.destination })
      : { tenantId: body.tenantId, businessId: body.businessId }

    for (const ev of body.events) {
      if (ev.type !== 'message' || ev.message?.type !== 'text') {
        results.push({ skipped: true, type: ev.type })
        continue
      }
      const lineUserId = ev.source?.userId
      const threadId = ev.source?.groupId || ev.source?.roomId || ev.source?.userId
      if (!lineUserId || !threadId) {
        results.push({ skipped: true, reason: 'no source userId' })
        continue
      }
      try {
        const eventId = ev.webhookEventId || ev.message.id
        const turn = await handleAgentTurn({
          tenantId: scope.tenantId,
          businessId: scope.businessId,
          lineUserId,
          displayName: body.displayName,
          threadId,
          text: ev.message.text ?? '',
          externalMessageId: ev.message.id,
        }, phase1Ports ?? undefined)
        results.push({
          ok: true,
          eventId,
          principalType: turn.identity.principalType,
          skipReply: turn.response.skipReply === true,
          response: turn.response,
        })
      } catch (err) {
        results.push({ ok: false, error: err?.message || 'turn failed' })
      }
    }

    return { handled: results.filter((r) => r.ok).length, results }
  })
}
