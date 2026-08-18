import { z } from 'zod'
import { handle } from '../../_helpers'
import { createPhase1BusinessAgentPortsFromEnv, handleAgentTurn, resolvePhase1RequestScope } from '@/modules/agent'

// @req FR-050 — return event-correlated verified reply text/skipReply state to the sole
// LINE transport owner without receiving or consuming the LINE replyToken here.
// @spec BR-011 — zuri-cli is the sole LINE reply owner when stack answering is enabled.

// @req FR-028 — the LINE webhook seam: the zuri-cli LINE bot forwards webhook events
//   here; each text message becomes one end-to-end agent turn (FR-027) at Gate E.
// @req FR-052 — production scope comes only from an active server-owned LINE binding;
//   client-selected tenantId/businessId is rejected before persistence or model work.
// @spec ADR-007 §P7, BR-012, SDD-026, SEC-010 — LINE is a channel/shell; the turn runs in Zuri.
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

const zBody = z.object({
  bindingId: z.string().uuid().optional(),
  destination: z.string().min(1).optional(),
  tenantId: z.string().min(1).optional(),
  businessId: z.string().optional(),
  displayName: z.string().optional(),
  events: z.array(zLineEvent).default([]),
})

/**
 * POST a normalized LINE webhook batch. Only text-message events drive a turn;
 * everything else (follow, join, postback, sticker, …) is acknowledged and skipped so
 * the bot's webhook stays 200. A per-event failure is captured, not thrown, so one bad
 * event never drops the rest of the batch.
 */
export function createLineWebhookPost({
  runtimeFactory = createPhase1BusinessAgentPortsFromEnv,
  turnHandler = handleAgentTurn,
} = {}) {
  return async function lineWebhookPost(request) {
  return handle(async () => {
    const body = zBody.parse(await request.json())
    const results = []
    const phase1Ports = await runtimeFactory()
    const scope = await resolvePhase1RequestScope({
      runtime: phase1Ports,
      headers: request.headers,
      body,
    })
    let resolvedModel = phase1Ports?.model
    let modelResolved = !phase1Ports?.resolveModel

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
        if (!modelResolved) {
          resolvedModel = await phase1Ports.resolveModel(scope)
          modelResolved = true
        }
        const eventId = ev.webhookEventId || ev.message.id
        const turn = await turnHandler({
          tenantId: scope.tenantId,
          businessId: scope.businessId,
          lineUserId,
          displayName: body.displayName,
          threadId,
          text: ev.message.text ?? '',
          externalMessageId: ev.message.id,
        }, {
          ...(phase1Ports ?? {}),
          model: resolvedModel,
          serverScope: {
            transportVerified: Boolean(phase1Ports),
            bindingId: scope.id ?? null,
            businessId: scope.businessId ?? null,
          },
        })
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
}

export const POST = createLineWebhookPost()
