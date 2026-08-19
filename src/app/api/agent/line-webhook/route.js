import { z } from 'zod'
import { handle } from '../../_helpers'
import { createPhase1BusinessAgentPortsFromEnv, handleAgentTurn, resolvePhase1RequestScope } from '@/modules/agent'
import { createLineOaEvidenceRecorder } from '@/platform/integrations/providers/line/line-oa-evidence'

// @req FR-050 — return event-correlated verified reply text/skipReply state to the sole
// LINE transport owner without receiving or consuming the LINE replyToken here.
// @spec BR-011 — zuri-cli is the sole LINE reply owner when stack answering is enabled.

// @req FR-028 — the LINE webhook seam: the zuri-cli LINE bot forwards webhook events
//   here; each text message becomes one end-to-end agent turn (FR-027) at Gate E.
// @req FR-052 — production scope comes only from an active server-owned LINE binding;
//   client-selected tenantId/businessId is rejected before persistence or model work.
// @req FR-081 — this is the LINE acquisition channel, so it converges on the one
//   normalized ingestion envelope: every event becomes raw evidence through the shared
//   adapter before anything interprets it. There is no second raw-write path.
// @spec ADR-007 §P7, BR-012, SDD-026, SEC-010 — LINE is a channel/shell; the turn runs in Zuri.
// @tested tests/integration/agent-webhook-route.test.js
// @tested tests/integration/line-oa-evidence-convergence.test.js

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
 * POST a normalized LINE webhook batch.
 *
 * Every event becomes canonical raw evidence first (FR-081), including the ones the
 * turn will skip. Only text-message events then drive a turn; everything else
 * (follow, join, postback, sticker, …) is acknowledged and skipped so the bot's
 * webhook stays 200 — but it is no longer discarded without a record.
 *
 * A per-event failure is captured, not thrown, so one bad event never drops the rest
 * of the batch; `stage` says whether it failed recording the event or interpreting it.
 * A batch-level failure — unresolved scope, a misconfigured channel — still throws,
 * because it is true of every event in the batch.
 */
export function createLineWebhookPost({
  runtimeFactory = createPhase1BusinessAgentPortsFromEnv,
  turnHandler = handleAgentTurn,
  evidenceRecorderFactory = createLineOaEvidenceRecorder,
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

    // FR-081 convergence. Resolved once per batch, from the scope the binding proved.
    // `null` means this LINE channel has no IntegrationConnection yet, so there is no
    // evidence lane to write to and the batch behaves exactly as it did before.
    const evidence = await evidenceRecorderFactory({
      tenantId: scope.tenantId,
      businessId: scope.businessId ?? null,
      destination: body.destination,
    })

    for (const ev of body.events) {
      // Evidence first, and for EVERY event — including the follow/unfollow/postback
      // and non-text messages the turn skips. Those were previously discarded with no
      // record at all; the envelope is the only place they are now durable.
      let evidenceResult = null
      if (evidence) {
        try {
          evidenceResult = await evidence.record({ body, event: ev })
        } catch (err) {
          // Evidence is the replayable record of what LINE actually sent. Processing an
          // event we could not record would do business work with no way to reconstruct
          // its input, so the event stops here — isolated, never failing the batch.
          results.push({
            ok: false,
            stage: 'EVIDENCE',
            type: ev.type,
            error: err?.message || 'evidence write failed',
          })
          continue
        }
      }

      if (ev.type !== 'message' || ev.message?.type !== 'text') {
        results.push({ skipped: true, type: ev.type, evidence: evidenceResult })
        continue
      }
      const lineUserId = ev.source?.userId
      const threadId = ev.source?.groupId || ev.source?.roomId || ev.source?.userId
      if (!lineUserId || !threadId) {
        results.push({ skipped: true, reason: 'no source userId', evidence: evidenceResult })
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
          evidence: evidenceResult,
        })
      } catch (err) {
        results.push({
          ok: false,
          stage: 'TURN',
          error: err?.message || 'turn failed',
          evidence: evidenceResult,
        })
      }
    }

    return { handled: results.filter((r) => r.ok).length, results }
  })
  }
}

export const POST = createLineWebhookPost()
