import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { assembleAgentContext } from './context'
import { executeAgentAction } from './action-gate'
import { zHandleAgentTurnInput } from '@/lib/validation/entities'
import { answerBusinessQuestion } from './grounded-business-answer'
import { resolveAgentAuthorization } from './auth-context'

// @req FR-027 — one end-to-end agent turn: the full ADR-007 P7 path composed in one
//   entry — LINE ingest (FR-023) → read context (FR-025) → optional Gate F action
//   (FR-026) → response.
// @spec ADR-007 §P7 — LINE → Identity → (MSP) → GKS → Agent → (Zuri Tool) → LINE
//   response. Memory/knowledge/tool ports are injectable so the same turn runs on the
//   in-memory defaults (tests/demo) or the real MSP/GenesisBlockDB adapters.
// @spec Gate E→F — a denied or step-up-needing action degrades to a graceful response,
//   it never crashes the turn; only programmer errors (unknown action) propagate.
// @req FR-097 — the turn receives the channel namespace only from the trusted server
//   scope and carries it into the canonical ingest/authorization seams.
// @spec ADR-044, ADR-045 D1/D5-D6, BR-020, SEC-018
// @tested tests/integration/agent-turn.test.js, tests/integration/agent-msp-thread-memory.test.js

const GRACEFUL = /^(AGENT_ACTION_DENIED|STEP_UP_REQUIRED)/

/**
 * Handle one inbound LINE message as a full agent turn.
 *
 * @param {Object} input  see zHandleAgentTurnInput (tenantId, lineUserId, text, threadId,
 *   optional businessId/displayName/externalMessageId, and an optional `action`).
 * @param {Object} [ports]
 * @param {import('./memory-port').MemoryPort} [ports.memory]  defaults to in-memory
 * @param {import('./tools').ToolRegistry} [ports.readTools]   defaults to read-only tools
 * @param {object} [ports.writeRegistry]                       defaults to defaultWriteTools()
 * @returns {Promise<{ inbound, identity, knowledge, action, response }>}
 */
export async function handleAgentTurn(
  input,
  { memory, knowledge, readTools, writeRegistry, businessKnowledge, model, serverScope, threadMemory, threadRoute } = {},
) {
  const {
    tenantId, businessId, lineUserId, displayName, text, threadId, externalMessageId, action,
    sessionId, instanceId, eventId, capability, sensitivity, consent, correlationId,
  } =
    zHandleAgentTurnInput.parse(input)

  // 1. Ingest the inbound message (persists + resolves identity through the one seam).
  const inbound = await ingestLineMessage({
    tenantId,
    businessId,
    lineUserId,
    channelAccountId: serverScope?.channelAccountId,
    displayName,
    threadId,
    text,
    externalMessageId,
    correlationId,
  })

  // @req FR-093 — everything below can fail, and when it does the transport still
  // sends the customer its own fallback text. Recording that reply needs the row
  // ingest just wrote, so the row travels with the error instead of being lost with
  // the stack frame. Attached, never overwritten: an inner layer that already knows
  // better keeps its own answer.
  try {
    // 2. Assemble the read-only context (identity + memory + knowledge + read tools).
    let context = await assembleAgentContext({
      tenantId, businessId, lineUserId, displayName, threadId, sessionId, instanceId, eventId,
      capability, sensitivity, consent, serverScope, threadMemory, threadRoute,
      deferThreadRecall: Boolean(threadMemory),
      memory, knowledge, tools: readTools,
    })

    let memoryInbound = null
    if (threadMemory) {
      const route = {
        ...threadRoute,
        tenantId,
        businessId,
      }
      const sourceEventId = externalMessageId
        ? `${route.channelAccountId}:${externalMessageId}`
        : eventId ?? inbound.messageId
      memoryInbound = await threadMemory.appendInbound({
        route,
        speaker: {
          // resolveLinePrincipal has already minted/resolved this internal
          // Person reference; the raw LINE handle never becomes a memory key.
          speakerId: context.identity.principalId,
          speakerKind: 'HUMAN',
          personId: context.identity.verified ? context.identity.principalId : null,
          identityAssurance: context.identity.verified ? 'VERIFIED' : 'PENDING',
        },
        text,
        sourceEventId,
        messageId: inbound.messageId,
        policyRevision: context.policy.version,
      })
      // The first pass establishes the trusted actor and thread route. Read the
      // context again only after the current inbound message is durably appended,
      // so the model receives the current exchange in the same packet.
      context = await assembleAgentContext({
        tenantId, businessId, lineUserId, displayName, threadId, sessionId, instanceId, eventId,
        capability, sensitivity, consent, serverScope, threadMemory, threadRoute,
        currentExchangeId: memoryInbound.message.exchangeId,
        memory, knowledge, tools: readTools,
      })
    }

    // 3. Optional Gate F action; a denial / step-up requirement is a graceful outcome.
    let actionResult = null
    let response
    if (action && !context.policy.privateMemoryAllowed) {
      actionResult = null
      response = { kind: 'ACTION_DENIED', action: action.name, reason: `POLICY_DENIED:${context.policy.reason}` }
    } else if (action) {
      try {
        actionResult = await executeAgentAction(
          { tenantId, lineUserId, actionName: action.name, target: action.target, payload: action.payload, stepUpToken: action.stepUpToken },
          { registry: writeRegistry },
        )
        response = { kind: 'ACTION_DONE', action: action.name, principalType: context.identity.principalType }
      } catch (err) {
        const msg = String(err?.message ?? err)
        if (!GRACEFUL.test(msg)) throw err // unknown action / real fault propagates
        response = {
          kind: msg.startsWith('STEP_UP_REQUIRED') ? 'STEP_UP_REQUIRED' : 'ACTION_DENIED',
          action: action.name,
          reason: msg,
        }
      }
    } else if (businessId && businessKnowledge && model && inbound.created.message === false) {
      response = { kind: 'DUPLICATE', skipReply: true }
    } else if (businessId && businessKnowledge && model) {
      const invocationModel = memoryInbound && typeof threadMemory.withInjectionReceipt === 'function'
        ? threadMemory.withInjectionReceipt({ model, contextPacket: context.threadMemory,
          threadId: memoryInbound.thread.threadId, exchangeId: memoryInbound.message.exchangeId,
          authorization: { authContext: context.authContext }, requesterId: context.identity.principalId })
        : model
      const answer = await answerBusinessQuestion(
        { tenantId, businessId, question: text },
        { knowledge: businessKnowledge, model: invocationModel, contextPacket: context.threadMemory },
      )
      response = {
        kind: 'ANSWER',
        text: answer.text,
        grounded: answer.grounded,
        evidenceCount: answer.evidence.records.length,
        sourceRefs: [...new Set(answer.evidence.records.map((record) => record.source_ref))],
        asOf: answer.evidence.asOf,
        provider: answer.provider,
        verification: answer.verification,
      }
    } else {
      // Read-only answer path (no LLM in the lab): a structured answer grounded in the KG.
      response = {
        kind: 'ANSWER',
        principalType: context.identity.principalType,
        grounded: context.knowledge.found,
        relationCount: context.knowledge.relations.length,
      }
    }

    if (memoryInbound && response.text && !response.skipReply) {
      const currentAuthorization = await resolveAgentAuthorization({
        tenantId, businessId, lineUserId, capability, sensitivity, consent,
        serverScope: { ...serverScope, audienceKind: threadRoute?.audienceKind },
      })
      if (context.policy.privateMemoryAllowed && (!currentAuthorization.policy.privateMemoryAllowed || !currentAuthorization.policy.mspAuthorization.read)) {
        response = { kind: 'ANSWER', text: 'สิทธิ์การเข้าถึงเปลี่ยนแปลงแล้ว กรุณายืนยันสิทธิ์ก่อนถามข้อมูลส่วนตัวอีกครั้งค่ะ', grounded: false }
      }
      await threadMemory.appendMessage({
        threadId: memoryInbound.thread.threadId,
        sessionId: memoryInbound.session.sessionId,
        exchangeId: memoryInbound.message.exchangeId,
        replyToMessageId: memoryInbound.message.messageId,
        sourceEventId: `${memoryInbound.message.messageId}:assistant`,
        speakerId: 'zuri-line-agent', speakerKind: 'AGENT', identityAssurance: 'VERIFIED',
        requesterId: context.identity.principalId, authorization: currentAuthorization,
        direction: 'OUTBOUND', text: response.text, deliveryState: 'QUEUED',
        policyRevision: currentAuthorization.policy.version,
      })
    }

    return {
      inbound,
      identity: context.identity,
      knowledge: context.knowledge,
      action: actionResult,
      response,
      policy: context.policy,
      authorizedVaults: context.authorizedVaults,
      thread: context.thread,
      threadMemory: context.threadMemory,
      memoryExchange: memoryInbound ? { threadId: memoryInbound.thread.threadId,
        sessionId: memoryInbound.session.sessionId, exchangeId: memoryInbound.message.exchangeId,
        inboundMessageId: memoryInbound.message.messageId } : null,
    }
  } catch (error) {
    if (error && typeof error === 'object' && error.inbound === undefined) error.inbound = inbound
    throw error
  }
}
