import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { assembleAgentContext } from './context'
import { executeAgentAction } from './action-gate'
import { zHandleAgentTurnInput } from '@/lib/validation/entities'
import { answerBusinessQuestion } from './grounded-business-answer'

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
// @tested tests/integration/agent-turn.test.js

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
  { memory, knowledge, readTools, writeRegistry, businessKnowledge, model, serverScope } = {},
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
    const context = await assembleAgentContext({
      tenantId, businessId, lineUserId, displayName, threadId, sessionId, instanceId, eventId,
      capability, sensitivity, consent, serverScope,
      memory, knowledge, tools: readTools,
    })

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
      const answer = await answerBusinessQuestion(
        { tenantId, businessId, question: text },
        { knowledge: businessKnowledge, model },
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

    return {
      inbound,
      identity: context.identity,
      knowledge: context.knowledge,
      action: actionResult,
      response,
      policy: context.policy,
      authorizedVaults: context.authorizedVaults,
    }
  } catch (error) {
    if (error && typeof error === 'object' && error.inbound === undefined) error.inbound = inbound
    throw error
  }
}
