import { z } from 'zod'
import { handle } from '../../_helpers'
import { createPhase1BusinessAgentPortsFromEnv, handleAgentTurn, resolvePhase1RequestScope } from '@/modules/agent'
import { createLineOaEvidenceRecorder } from '@/platform/integrations/providers/line/line-oa-evidence'
import { logger as defaultLogger } from '@/lib/observability/logger'
import { resolveCorrelationId } from '@/lib/observability/correlation'

// @req FR-050 — return event-correlated verified reply text/skipReply state to the sole
// LINE transport owner without receiving or consuming the LINE replyToken here.
// @req FR-093 — the successful result also names the conversation and the inbound
//   message row it created, which is what the transport quotes back on
//   `POST /api/agent/line-delivery` once the customer has actually received a reply.
// @spec BR-011 — zuri-cli is the sole LINE reply owner when stack answering is enabled.

// @req FR-028 — the LINE webhook seam: the zuri-cli LINE bot forwards webhook events
//   here; each text message becomes one end-to-end agent turn (FR-027) at Gate E.
// @req FR-052 — production scope comes only from an active server-owned LINE binding;
//   client-selected tenantId/businessId is rejected before persistence or model work.
// @req FR-097 — the resolved binding's server-owned channel namespace is passed into
//   the identity and authorization seams; the webhook payload cannot select it.
// @req FR-081 — this is the LINE acquisition channel, so it converges on the one
//   normalized ingestion envelope: every event becomes raw evidence through the shared
//   adapter before anything interprets it. There is no second raw-write path.
// @spec ADR-007 §P7, BR-012, SDD-026, SEC-010 — LINE is a channel/shell; the turn runs in Zuri.
// @spec NFR-017, SDD-048 — one correlation id per batch, echoed on every record, on the
//   response, and onto the audit row; every rejection and every failed event says which
//   stage failed. Records carry ids and counts only — never message text or credentials.
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
  logger = defaultLogger,
  clock = () => Date.now(),
} = {}) {
  return async function lineWebhookPost(request) {
  // Resolved before anything can fail, so a rejected batch is correlated too — the
  // requests an operator most needs to trace are the ones that never reached a turn.
  const { correlationId, source: correlationSource } = resolveCorrelationId(request.headers)
  const startedAt = clock()

  return handle(async () => {
    const body = zBody.parse(await request.json())
    const results = []
    let phase1Ports
    let scope
    try {
      phase1Ports = await runtimeFactory()
      scope = await resolvePhase1RequestScope({
        runtime: phase1Ports,
        headers: request.headers,
        body,
      })
    } catch (err) {
      // A batch-level rejection is true of every event in it, so it still throws — but
      // it does not get to leave without a record naming the stage.
      logger.warn('line.webhook.rejected', {
        correlationId,
        correlationSource,
        stage: 'SCOPE',
        errorCode: err?.message,
        received: body.events.length,
        durationMs: clock() - startedAt,
      })
      throw err
    }

    logger.info('line.webhook.received', {
      correlationId,
      correlationSource,
      tenantId: scope.tenantId,
      businessId: scope.businessId ?? undefined,
      received: body.events.length,
    })

    let resolvedModel = phase1Ports?.model
    let modelResolved = !phase1Ports?.resolveModel

    const evidence = await evidenceRecorderFactory({
      tenantId: scope.tenantId,
      businessId: scope.businessId ?? null,
      destination: body.destination,
    })

    for (const ev of body.events) {
      const eventStartedAt = clock()
      const eventId = ev.webhookEventId || ev.message?.id
      const base = {
        correlationId,
        eventId,
        tenantId: scope.tenantId,
        businessId: scope.businessId ?? undefined,
        eventType: ev.type,
        messageType: ev.message?.type,
        connectionId: evidence?.connectionId,
      }
      let evidenceResult = null
      if (evidence) {
        try {
          evidenceResult = await evidence.record({ body, event: ev })
        } catch (err) {
          // Evidence is the replayable record of what LINE actually sent. Processing an
          // event we could not record would do business work with no way to reconstruct
          // its input, so the event stops here — isolated, never failing the batch.
          logger.error('line.webhook.event', {
            ...base,
            stage: 'EVIDENCE',
            outcome: 'FAILED',
            errorCode: err?.message,
            durationMs: clock() - eventStartedAt,
          })
          results.push({
            ok: false,
            correlationId,
            eventId,
            stage: 'EVIDENCE',
            type: ev.type,
            error: err?.message || 'evidence write failed',
          })
          continue
        }
      }

      if (ev.type !== 'message' || ev.message?.type !== 'text') {
        logger.info('line.webhook.event', {
          ...base,
          stage: 'DISPATCH',
          outcome: 'SKIPPED',
          skipped: true,
          evidenceStatus: evidenceResult?.status,
          durationMs: clock() - eventStartedAt,
        })
        results.push({ skipped: true, correlationId, type: ev.type, evidence: evidenceResult })
        continue
      }
      const lineUserId = ev.source?.userId
      const threadId = ev.source?.groupId || ev.source?.roomId || ev.source?.userId
      if (!lineUserId || !threadId) {
        logger.warn('line.webhook.event', {
          ...base,
          stage: 'DISPATCH',
          outcome: 'SKIPPED',
          skipped: true,
          errorCode: 'NO_SOURCE_USER_ID',
          evidenceStatus: evidenceResult?.status,
          durationMs: clock() - eventStartedAt,
        })
        results.push({ skipped: true, correlationId, reason: 'no source userId', evidence: evidenceResult })
        continue
      }
      try {
        if (!modelResolved) {
          resolvedModel = await phase1Ports.resolveModel(scope)
          modelResolved = true
        }
        const turn = await turnHandler({
          tenantId: scope.tenantId,
          businessId: scope.businessId,
          lineUserId,
          displayName: body.displayName,
          threadId,
          text: ev.message.text ?? '',
          externalMessageId: ev.message.id,
          correlationId,
        }, {
          ...(phase1Ports ?? {}),
          model: resolvedModel,
          serverScope: {
            transportVerified: Boolean(phase1Ports),
            bindingId: scope.id ?? scope.bindingId ?? null,
            channelAccountId: scope.channelAccountId ?? scope.code ?? scope.bindingId ?? undefined,
            businessId: scope.businessId ?? null,
          },
        })
        logger.info('line.webhook.event', {
          ...base,
          stage: 'TURN',
          outcome: 'OK',
          principalType: turn.identity.principalType,
          responseKind: turn.response.kind,
          grounded: turn.response.grounded,
          skipReply: turn.response.skipReply === true,
          conversationId: turn.inbound?.conversationId,
          messageId: turn.inbound?.messageId,
          personId: turn.inbound?.personId,
          evidenceStatus: evidenceResult?.status,
          durationMs: clock() - eventStartedAt,
        })
        results.push({
          ok: true,
          correlationId,
          eventId,
          principalType: turn.identity.principalType,
          skipReply: turn.response.skipReply === true,
          response: turn.response,
          evidence: evidenceResult,
          // @req FR-093 — additive, and the only reason they are here: the transport
          // needs something to name when it reports back what it actually sent. Both
          // were already computed and were previously visible only in a log line,
          // which is not a place another process can read from.
          conversationId: turn.inbound?.conversationId ?? null,
          inboundMessageId: turn.inbound?.messageId ?? null,
        })
      } catch (err) {
        logger.error('line.webhook.event', {
          ...base,
          stage: 'TURN',
          outcome: 'FAILED',
          errorCode: err?.message,
          evidenceStatus: evidenceResult?.status,
          durationMs: clock() - eventStartedAt,
        })
        results.push({
          ok: false,
          correlationId,
          // @req FR-093 — the transport matches results to events by `eventId`, and
          // this branch never carried one: a failed result was simply unfindable, and
          // the fallback got sent because an unmatched result and a failed one both
          // read as "not ok". That accident is now load-bearing — without the match
          // the transport cannot pair the ids below with the event it answered.
          eventId,
          stage: 'TURN',
          error: err?.message || 'turn failed',
          evidence: evidenceResult,
          // @req FR-093 — a failed turn is exactly when the transport sends the
          // customer its own fallback, so this is the branch where naming the row
          // matters most. Ingest runs first and usually succeeded; `err.inbound`
          // carries what it wrote. Null when the failure was the ingest itself —
          // then there is genuinely nothing to name, and no id is invented.
          conversationId: err?.inbound?.conversationId ?? null,
          inboundMessageId: err?.inbound?.messageId ?? null,
        })
      }
    }

    const handled = results.filter((r) => r.ok).length
    logger.info('line.webhook.completed', {
      correlationId,
      correlationSource,
      tenantId: scope.tenantId,
      businessId: scope.businessId ?? undefined,
      connectionId: evidence?.connectionId,
      received: body.events.length,
      handled,
      failed: results.filter((r) => r.ok === false).length,
      skippedCount: results.filter((r) => r.skipped).length,
      evidenceRecorded: results.filter((r) => r.evidence).length,
      durationMs: clock() - startedAt,
    })

    return { correlationId, handled, results }
  })
  }
}

export const POST = createLineWebhookPost()
