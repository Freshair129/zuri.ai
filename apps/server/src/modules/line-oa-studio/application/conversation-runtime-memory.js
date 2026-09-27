import { appendTraceEvent } from '@/modules/agent/execution-trace'
import { resolveAgentAuthorization } from '@/modules/agent/auth-context'
import { assembleAgentContext } from '@/modules/agent/context'
import { resolveLineKnowledgeGroundingMode } from '@/modules/agent/line-knowledge-grounding'
import {
  appendLineMemoryAnswer, assertMemoryJobLive, composeLineMemoryPacket, lineMemoryHandle,
  memoryRoute, memoryServerScope, prepareLineMemoryContext,
} from '@/modules/agent/server-line-answer'
import { createServerLineThreadMemory } from './server-line-runtime'
import {
  isMemoryTurn, MEMORY_RECEIPT_KINDS, memoryOperationIds, memoryReceiptKey, memoryTextSha256,
} from './runtime-memory-receipts'

// @req FR-149, FR-171 — Core side of the Conversation Runtime v1 `memory` operation
//   (ADR-106 D2 Memory/Knowledge `read`, `append`, `receipt`). Core stays the only MSP
//   caller: it runs the same three memory phases the legacy Server worker runs
//   (`server-line-answer.js`), under the same job/erasure/policy fences, and keeps a
//   durable per-job receipt for each so a reclaimed runtime replays instead of repeating.
// @spec ADR-106 D2-D4, SDD-110, ADR-061, ADR-070, SEC-001 — the runtime names only the
//   operation and its stable id; tenant, business, account, identity, thread and route
//   all come from the claimed, persisted job and Core's own MSP receipts.
// @tested tests/integration/conversation-runtime-memory.test.js

export const MEMORY_OPERATIONS = Object.freeze(['read', 'append', 'receipt'])
export const MEMORY_INJECTION_STATES = Object.freeze(['RESOLVED', 'SUBMITTED', 'COMPLETED', 'FAILED'])
export const MAX_MEMORY_PACKET_BYTES = 32 * 1024

export { memoryOperationIds }

const error = (code, status = 400) => Object.assign(new Error(code), { code, status })

// Failures that already carry a stable, non-sensitive code keep it; anything else
// from the MSP adapter (tool text, transport detail) becomes one generic code, the
// way the legacy worker folds every memory failure into LINE_ANSWER_UNAVAILABLE.
const TYPED_MEMORY_FAILURES = new Set([
  'MSP_TRANSPORT_MISCONFIGURED', 'MSP_TRANSPORT_UNAVAILABLE', 'MSP_THREAD_SERVICE_KEY_REQUIRED',
  'MSP_THREAD_MEMORY_TRANSPORT_REQUIRED', 'MSP_INJECTION_RECEIPT_UNKNOWN',
  'LINE_MEMORY_JOB_ERASED', 'LINE_MEMORY_JOB_FENCED', 'LINE_MEMORY_SCOPE_MISMATCH',
  'LINE_MEMORY_AUDIENCE_DENIED', 'LINE_MEMORY_POLICY_REVOKED', 'LINE_MEMORY_CONTEXT_UNAVAILABLE',
  'LINE_MEMORY_APPEND_UNAVAILABLE',
])
const FENCE_FAILURES = new Set(['LINE_MEMORY_JOB_ERASED', 'LINE_MEMORY_JOB_FENCED', 'LINE_MEMORY_SCOPE_MISMATCH',
  'LINE_MEMORY_AUDIENCE_DENIED', 'LINE_MEMORY_POLICY_REVOKED'])

function typedMemoryFailure(cause) {
  const code = cause?.code ?? cause?.message
  if (typeof cause?.status === 'number' && cause.status < 500 && typeof cause?.code === 'string') return cause
  if (!TYPED_MEMORY_FAILURES.has(code)) return error('LINE_MEMORY_UNAVAILABLE', 503)
  return error(code, FENCE_FAILURES.has(code) ? 409 : 503)
}

/** Only what `claimsFor` and the injection receipt read; never roles, permissions or transport detail. */
function durableAuthContext(authContext) {
  return {
    actor: { principalId: authContext?.actor?.principalId ?? null },
    scope: { tenantId: authContext?.scope?.tenantId ?? null, businessId: authContext?.scope?.businessId ?? null },
    policy: {
      decision: authContext?.policy?.decision ?? 'DENY',
      version: authContext?.policy?.version ?? 'default',
      privateMemoryAllowed: authContext?.policy?.privateMemoryAllowed === true,
      mspAuthorization: {
        read: authContext?.policy?.mspAuthorization?.read === true,
        writePrivate: authContext?.policy?.mspAuthorization?.writePrivate === true,
      },
    },
  }
}

export function createConversationRuntimeMemory({ db, env, now = () => new Date(), ownedClaim,
  threadMemoryFactory = null, contextAssembler = assembleAgentContext,
  authorizationResolver = resolveAgentAuthorization } = {}) {
  if (typeof ownedClaim !== 'function') throw new Error('CONVERSATION_RUNTIME_MEMORY_CLAIM_REQUIRED')

  // The legacy worker falls back to building the port from the Phase 1 runtime
  // when the deployment port is absent, and that constructor throws for a missing
  // transport, a missing service key or a misconfigured secret file. Every one of
  // those ends the legacy turn as FAILED; here each is a typed 503 instead.
  function threadMemory() {
    if (threadMemoryFactory) {
      const injected = threadMemoryFactory(env)
      if (!injected) throw error('MSP_THREAD_MEMORY_TRANSPORT_REQUIRED', 503)
      return injected
    }
    if (typeof env.ZURI_MSP_THREAD_SERVICE_KEY !== 'string' || env.ZURI_MSP_THREAD_SERVICE_KEY.length < 32) {
      throw error('MSP_THREAD_SERVICE_KEY_REQUIRED', 503)
    }
    const port = createServerLineThreadMemory(env, { strict: true })
    if (!port) throw error('MSP_THREAD_MEMORY_TRANSPORT_REQUIRED', 503)
    return port
  }

  const memoryStateReader = id => db.lineConversationJob.findUnique({
    where: { id },
    select: { memorySyncOptIn: true, status: true, version: true, errorCode: true, transportEpoch: true,
      account: { select: { serverEnabled: true, transportMode: true, status: true, transportEpoch: true } } },
  })

  async function loadReceipt(job, name) {
    const row = await db.agentTraceEvent.findFirst({ where: { tenantId: job.tenantId, businessId: job.businessId,
      idempotencyKey: memoryReceiptKey(job.id, name) } })
    if (!row) return null
    const payload = JSON.parse(row.payloadJson)
    // An erased turn's trace is a tombstone; nothing in it may be replayed.
    if (payload?.redacted === true) throw error('LINE_MEMORY_JOB_ERASED', 409)
    return payload
  }

  async function saveReceipt(job, name, payload) {
    await appendTraceEvent(db, { scope: { tenantId: job.tenantId, businessId: job.businessId },
      turnId: job.id, executionId: job.executionId ?? null, kind: MEMORY_RECEIPT_KINDS[name],
      idempotencyKey: memoryReceiptKey(job.id, name), payload, occurredAt: new Date(now().getTime()) })
  }

  async function traceNote(job, kind, key, payload) {
    await appendTraceEvent(db, { scope: { tenantId: job.tenantId, businessId: job.businessId },
      turnId: job.id, executionId: job.executionId ?? null, kind,
      idempotencyKey: `${job.id}:runtime:${key}:${kind}`, payload, occurredAt: new Date(now().getTime()) })
  }

  /** A memory operation exists only for an opted-in, non-command, business-knowledge turn. */
  function memoryTurn(job) {
    if (job.memorySyncOptIn !== true) throw error('MEMORY_NOT_ENABLED', 409)
    if (!isMemoryTurn(job)) throw error('MEMORY_NOT_APPLICABLE', 409)
    if (resolveLineKnowledgeGroundingMode(job.account?.knowledgeGrounding) !== 'BUSINESS_KNOWLEDGE') {
      throw error('RUNTIME_GROUNDING_MODE_NOT_SUPPORTED', 409)
    }
    return memoryRoute(job)
  }

  async function assertPolicyStillAllows(job, route) {
    const current = await authorizationResolver({ tenantId: job.tenantId, businessId: job.businessId,
      lineUserId: job.sourceUserId, threadId: route.externalRoomRef, eventId: job.eventId,
      serverScope: memoryServerScope(job, route) })
    if (current?.authContext?.scope?.tenantId !== job.tenantId || current.authContext.scope.businessId !== job.businessId) {
      throw error('LINE_MEMORY_SCOPE_MISMATCH', 409)
    }
    if (!current?.policy?.privateMemoryAllowed || current.policy?.mspAuthorization?.read !== true) {
      throw error('LINE_MEMORY_POLICY_REVOKED', 409)
    }
  }

  function readResult(receipt) {
    return { status: 'COMPLETED', operationId: receipt.operationId, result: {
      contextPacket: receipt.contextPacketJson ? JSON.parse(receipt.contextPacketJson) : null,
      receipt: { contextReceiptId: receipt.contextReceiptId ?? null, policyDecision: receipt.policyDecision } } }
  }

  function appendResult(receipt, duplicate) {
    return { status: 'COMPLETED', operationId: receipt.operationId,
      result: { receipt: { textSha256: receipt.textSha256, duplicate } } }
  }

  async function read(ref) {
    const { job } = await ownedClaim(ref)
    const route = memoryTurn(job)
    const operationId = memoryOperationIds(job.id).read
    const stored = await loadReceipt(job, 'read')
    if (stored) {
      // A reclaimed runtime replays the context this job already read, so MSP is
      // not asked twice and the injection receipt keeps one packet identity. The
      // job fence and, for private context, the current policy are rechecked first:
      // an erasure, revocation or withdrawal since the first read wins.
      await assertMemoryJobLive(job, memoryStateReader)
      if (stored.privateMemoryAllowed) await assertPolicyStillAllows(job, route)
      return readResult(stored)
    }
    const port = threadMemory()
    const { memoryContext, memoryInbound, authorizedForMemory } = await prepareLineMemoryContext({ job, route,
      question: job.inbound.body, threadMemory: port, contextAssembler, memoryStateReader })
    const { composed, injectedPacket } = composeLineMemoryPacket({ memoryContext, route, authorizedForMemory })
    // Trace payloads are stored as canonical JSON. The packet is kept as the exact
    // string the legacy path would hand the model, so the prompt and the MSP
    // injection receipt's packet hash are byte-identical on every replay.
    const contextPacketJson = injectedPacket ? JSON.stringify(injectedPacket) : null
    if (contextPacketJson && Buffer.byteLength(contextPacketJson, 'utf8') > MAX_MEMORY_PACKET_BYTES) {
      throw error('MEMORY_CONTEXT_TOO_LARGE', 413)
    }
    const receipt = { operationId, ...lineMemoryHandle(memoryContext, memoryInbound),
      policyDecision: memoryContext.threadMemory.policyDecision,
      authContext: durableAuthContext(memoryContext.authContext),
      contextReceiptId: composed.receipt?.receiptId ?? null, contextPacketJson }
    await assertMemoryJobLive(job, memoryStateReader)
    await saveReceipt(job, 'read', receipt)
    // The legacy worker records the composer's ContextReceipt (references, hash,
    // budget; never content) for every BUSINESS_KNOWLEDGE memory turn.
    if (composed.receipt?.receiptId) await traceNote(job, 'CONTEXT_RECEIPT', operationId, composed.receipt)
    return readResult(receipt)
  }

  async function append(ref, text) {
    const { job } = await ownedClaim(ref)
    const route = memoryTurn(job)
    const stored = await loadReceipt(job, 'read')
    if (!stored) throw error('MEMORY_READ_REQUIRED', 409)
    const textSha256 = memoryTextSha256(text)
    const prior = await loadReceipt(job, 'append')
    if (prior) {
      if (prior.textSha256 !== textSha256) throw error('MEMORY_APPEND_CONFLICT', 409)
      return appendResult(prior, true)
    }
    const port = threadMemory()
    port.bindTrustedRoute(stored.threadId, route)
    // A crash after MSP accepted this append but before the receipt below is
    // saved repeats the call on reclaim with the same source event id, which MSP
    // deduplicates exactly as it does for a restarted legacy worker.
    const agent = await appendLineMemoryAnswer({ job, route, threadMemory: port, memory: stored,
      answerText: text, authorizationResolver, memoryStateReader })
    const receipt = { operationId: memoryOperationIds(job.id).append, threadId: stored.threadId,
      exchangeId: stored.exchangeId, messageId: agent.message.messageId, sessionId: agent.session.sessionId, textSha256 }
    await saveReceipt(job, 'append', receipt)
    return appendResult(receipt, false)
  }

  async function lookup(ref, name) {
    const { job } = await ownedClaim(ref)
    memoryTurn(job)
    const stored = await loadReceipt(job, name)
    const operationId = memoryOperationIds(job.id)[name]
    if (!stored) return { status: 'NOT_FOUND', operationId }
    return name === 'read'
      ? { status: 'COMPLETED', operationId, result: { receipt: { contextReceiptId: stored.contextReceiptId ?? null, policyDecision: stored.policyDecision } } }
      : appendResult(stored, true)
  }

  async function injection(ref, { state, model }) {
    // RESOLVED is recorded before the model starts, so it carries every fence the
    // legacy worker applies before its model call. The later states describe a
    // call that has already happened: like the legacy wrapper they are recorded
    // for the claimed job regardless of a lease or identity change mid-call, but
    // never for another execution and never after erasure.
    const { job } = await ownedClaim(ref, state === 'RESOLVED' ? {} : { checkLease: false, checkIdentity: false })
    const route = memoryTurn(job)
    if (state === 'RESOLVED') await assertMemoryJobLive(job, memoryStateReader)
    else if (job.errorCode === 'PDPA_ERASURE') throw error('LINE_MEMORY_JOB_ERASED', 409)
    const stored = await loadReceipt(job, 'read')
    if (!stored?.contextPacketJson) throw error('MEMORY_INJECTION_NOT_APPLICABLE', 409)
    const port = threadMemory()
    port.bindTrustedRoute(stored.threadId, route)
    const recorder = port.injectionReceipt({ model, contextPacket: JSON.parse(stored.contextPacketJson),
      threadId: stored.threadId, exchangeId: stored.exchangeId, authorization: { authContext: stored.authContext },
      requesterId: stored.principalId, contextReceiptId: stored.contextReceiptId ?? null })
    const outcome = await recorder.recordWithRetry(state)
    if (!outcome.ok) throw error('MSP_INJECTION_RECEIPT_UNKNOWN', 503)
    const operationId = memoryOperationIds(job.id).injection
    await traceNote(job, 'MEMORY_INJECTION_RECORDED', `${operationId}:${state}`, { operationId, state })
    return { status: 'COMPLETED', operationId, result: { receipt: { state } } }
  }

  async function operate(ref, request) {
    const ids = memoryOperationIds(ref.jobId)
    try {
      if (request.operation === 'read') {
        if (request.operationId !== ids.read) throw error('MEMORY_OPERATION_ID_INVALID')
        return await read(ref)
      }
      if (request.operation === 'append') {
        if (request.operationId !== ids.append) throw error('MEMORY_OPERATION_ID_INVALID')
        return await append(ref, request.input.text)
      }
      if (request.operationId === ids.injection) {
        if (!request.input.state) throw error('MEMORY_RECEIPT_INPUT_INVALID')
        return await injection(ref, request.input)
      }
      if (request.input.state !== undefined) throw error('MEMORY_RECEIPT_INPUT_INVALID')
      if (request.operationId === ids.read) return await lookup(ref, 'read')
      if (request.operationId === ids.append) return await lookup(ref, 'append')
      throw error('MEMORY_OPERATION_ID_INVALID')
    } catch (cause) {
      // Claim, contract and receipt failures are already typed by Core; only the
      // MSP-facing phases need folding into stable codes.
      if (typeof cause?.status === 'number' && typeof cause?.code === 'string' && /^[A-Z0-9_:-]{1,80}$/.test(cause.code)
        && !String(cause.code).startsWith('MSP_') && !String(cause.code).startsWith('LINE_MEMORY_')) throw cause
      throw typedMemoryFailure(cause)
    }
  }

  return Object.freeze({ operate })
}
