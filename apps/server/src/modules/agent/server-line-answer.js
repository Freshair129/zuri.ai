import { createPostgresBusinessKnowledgeReader } from '@/modules/knowledge'
import { answerBusinessQuestion, createDeterministicBusinessModel } from './grounded-business-answer'
import { createLineReadQueryFromEnv, createPhase1BusinessAgentPortsFromEnv } from './phase1-runtime'
import { assembleAgentContext } from './context'
import { resolveAgentAuthorization } from './auth-context'
import { composeContext } from './context-composer'

// @req FR-149, FR-150 — answer an already-admitted durable conversation job;
// @req FR-171 — persist selected evidence and pass the trace observer to the actual provider.
// execution placement and external model permission are distinct decisions.
// @req FR-234 — on the MSP-opt-in path, the MSP packet is split into
// provenance-bearing slices (one per exchange/summary/protected record) and
// run through `context-composer.js`; the model and the MSP injection receipt
// receive ONLY the packet rebuilt from the composer's included slices, and
// the recorded `ContextReceipt` describes exactly that rebuilt packet — never
// the original, un-composed one. Coverage today is partial: the LOCAL_ONLY /
// non-opt-in path's business-evidence model invocation does not run through
// the composer and records no receipt (see the composer module's own note).
// @spec ADR-061, SEC-001, SEC-010 — public scoped knowledge by default; the
// persisted opt-in may compose the trusted MSP thread without a second CRM
// ingest, write action or implicit external model fallback.
// @spec ADR-091 D7, SDD-100 — Context Composer placement and receipt shape.
// @tested tests/unit/server-line-answer.test.js, tests/integration/line-worker-memory.test.js

function failure(code) {
  const error = new Error(code)
  error.code = code
  return error
}

// @req FR-234 — split one MSP thread-context packet into provenance-bearing
// slices the Context Composer can budget and drop independently, instead of
// treating the whole packet as one opaque blob (which can only ever be kept
// or dropped whole, defeating priority-ordered trimming). Each slice's id is
// prefixed by its packet section so `injectedMspPacket` can rebuild the
// packet from exactly the slices the composer included — nothing else.
// Ordered exchanges-first, then protected (verified) facts, then summaries
// last: recent turns and verified facts are kept ahead of older, already-
// condensed summaries when the shared budget runs out, mirroring the MSP
// packet builder's own trim order (buildThreadContextPacket drops summaries
// before recent exchanges).
function mspPacketSlices(packet) {
  const threadId = packet?.thread?.threadId ?? null
  const exchanges = Array.isArray(packet?.memory?.recentExchanges) ? packet.memory.recentExchanges : []
  const protectedRecords = Array.isArray(packet?.memory?.protectedMemory) ? packet.memory.protectedMemory : []
  const summaries = Array.isArray(packet?.memory?.summaries) ? packet.memory.summaries : []
  return [
    ...exchanges.map((exchange, index) => ({ id: `exchange:${exchange?.exchangeId ?? index}`, threadId, text: exchange })),
    ...protectedRecords.map((record, index) => ({ id: `protected:${record?.recordId ?? index}`, threadId, text: record })),
    ...summaries.map((summary, index) => ({ id: `summary:${summary?.summaryId ?? index}`, threadId, text: summary })),
  ]
}

/**
 * Rebuild the packet actually handed to the model and to MSP's injection
 * receipt from the Context Composer's included MSP slices ONLY. Returns
 * `null` when nothing survived composition — "no memory is injected" must
 * mean no packet, not an empty-looking one that still carries policy/identity
 * metadata a reader could mistake for content.
 */
function injectedMspPacket(packet, includedMspSlices) {
  if (!packet) return null
  const byPrefix = (prefix) => includedMspSlices
    .filter((slice) => slice.id.startsWith(prefix))
    .map((slice) => slice.content)
  const recentExchanges = byPrefix('exchange:')
  const protectedMemory = byPrefix('protected:')
  const summaries = byPrefix('summary:')
  if (!recentExchanges.length && !protectedMemory.length && !summaries.length) return null
  return {
    ...packet,
    memory: { ...packet.memory, recentExchanges, summaries, protectedMemory },
    manifest: packet.manifest ? {
      ...packet.manifest,
      effectiveRecentExchangeCount: recentExchanges.length,
      summaryCount: summaries.length,
      protectedRecordCount: protectedMemory.length,
    } : packet.manifest,
  }
}

const MEMORY_AUDIENCES = new Set(['DIRECT', 'GROUP', 'ROOM'])

function memoryRoute(job) {
  const conversation = job?.inbound?.conversation
  const audienceKind = typeof job?.audienceKind === 'string' ? job.audienceKind.toUpperCase() : null
  if (!conversation || !MEMORY_AUDIENCES.has(audienceKind)
    || conversation.channel !== 'LINE'
    || conversation.tenantId !== job.tenantId
    || conversation.businessId !== job.businessId
    || conversation.channelAccountId !== job.channelAccountId
    || typeof conversation.externalThreadId !== 'string'
    || !conversation.externalThreadId.trim()
    || !job.channelAccountId
    || !job.eventId
    || !job.sourceUserId) throw failure('LINE_MEMORY_SCOPE_MISMATCH')
  if (!job.account || (job.account.tenantId !== job.tenantId || job.account.businessId !== job.businessId)
    || (job.account.bindingCode || job.account.id) !== job.channelAccountId) {
    throw failure('LINE_MEMORY_SCOPE_MISMATCH')
  }
  return {
    threadKind: audienceKind,
    audienceKind,
    channelType: 'LINE',
    channelAccountId: job.channelAccountId,
    externalRoomRef: conversation.externalThreadId,
    tenantId: job.tenantId,
    businessId: job.businessId,
  }
}

function memoryServerScope(job, route) {
  return {
    transportVerified: true,
    channelAccountId: route.channelAccountId,
    bindingId: route.channelAccountId,
    audienceKind: route.audienceKind,
    agentId: 'zuri-line-agent',
    mspAuthorization: { read: true, writePrivate: false, writeShared: false },
    // These identifiers are copied from the claimed, persisted job only. They
    // are never accepted from the LINE message or model request.
    tenantId: job.tenantId,
    businessId: job.businessId,
  }
}

function memoryAudience(value) {
  return typeof value === 'string' ? value.toUpperCase() : null
}

/** MSP may return an opaque thread, but its bound identity must still match the
 * route that came from the claimed LINE job before any append/model call. */
function assertMemoryContextRoute(context, route, { requirePacket = false } = {}) {
  const thread = context?.thread
  const scope = context?.authContext?.scope
  if (!thread?.threadId || thread.businessId !== route.businessId
    || memoryAudience(thread.audienceKind) !== route.audienceKind
    || scope?.tenantId !== route.tenantId || scope.businessId !== route.businessId) {
    throw failure('LINE_MEMORY_SCOPE_MISMATCH')
  }
  if (!requirePacket) return
  const packet = context?.threadMemory
  const packetThread = packet?.thread
  const packetIdentity = packet?.identity
  if (!packet || !packetThread?.threadId || packetThread.threadId !== thread.threadId
    || packetThread.businessId !== route.businessId
    || memoryAudience(packetThread.audienceKind) !== route.audienceKind
    || !packetIdentity?.principalId || packetIdentity.principalId !== context.identity?.principalId) {
    throw failure('LINE_MEMORY_SCOPE_MISMATCH')
  }
}

const emptyMemoryKnowledge = async () => ({ found: false, relations: [] })

async function assertMemoryJobLive(job, memoryStateReader) {
  if (job?.errorCode === 'PDPA_ERASURE') throw failure('LINE_MEMORY_JOB_ERASED')
  if (typeof memoryStateReader !== 'function') return
  const current = await memoryStateReader(job.id)
  if (!current || current.memorySyncOptIn !== true || current.status !== 'CLAIMED'
    || current.version !== job.version || current.errorCode === 'PDPA_ERASURE') {
    throw failure('LINE_MEMORY_JOB_FENCED')
  }
  const account = current.account
  if (account && (account.serverEnabled !== true || account.transportMode !== 'CLOUD'
    || account.status !== 'CONNECTED' || account.transportEpoch !== current.transportEpoch)) {
    throw failure('LINE_MEMORY_JOB_FENCED')
  }
}

/** Input is the worker's claimed job, including the CRM `inbound` relation. */
export function createServerLineAnswer({
  env = process.env,
  knowledge,
  queryFn,
  runtimeFactory = createPhase1BusinessAgentPortsFromEnv,
  threadMemory = null,
  contextAssembler = assembleAgentContext,
  authorizationResolver = resolveAgentAuthorization,
  ...runtimeDependencies
} = {}) {
  let localKnowledge = knowledge
  return async function answer(job, { trace, memoryStateReader } = {}) {
    const tenantId = job?.tenantId
    const businessId = job?.businessId
    const question = job?.inbound?.body
    if (![tenantId, businessId, question].every((value) => typeof value === 'string' && value.trim())) {
      throw failure('LINE_ANSWER_INPUT_INVALID')
    }
    if (job.account && (job.account.tenantId !== tenantId || job.account.businessId !== businessId)) {
      throw failure('LINE_ANSWER_SCOPE_MISMATCH')
    }
    const modelAccess = job.modelAccess ?? 'LOCAL_ONLY'
    if (!['LOCAL_ONLY', 'EXTERNAL_MODEL_ALLOWED'].includes(modelAccess)) throw failure('LINE_MODEL_ACCESS_INVALID')
    const memoryOptIn = job.memorySyncOptIn === true
    const route = memoryOptIn ? memoryRoute(job) : null
    let selectedThreadMemory = memoryOptIn ? threadMemory : null
    let runtimePorts = null
    let businessKnowledge
    let model
    try {
      if (memoryOptIn && !selectedThreadMemory) {
        runtimePorts = await runtimeFactory({ ...env, ZURI_MSP_THREAD_MEMORY_ENABLED: 'true' },
          { ...runtimeDependencies, queryFn, bindingRequired: false })
        selectedThreadMemory = runtimePorts?.threadMemory
        if (!selectedThreadMemory) throw failure('LINE_MEMORY_NOT_CONFIGURED')
      }
      if (memoryOptIn && typeof selectedThreadMemory.withInjectionReceipt !== 'function') {
        throw failure('LINE_MEMORY_INJECTION_RECEIPT_UNAVAILABLE')
      }
      if (modelAccess === 'LOCAL_ONLY') {
        if (!localKnowledge) {
          const execute = queryFn ?? createLineReadQueryFromEnv(env, { serverOwned: true })
          if (!execute) throw failure('LINE_BUSINESS_KNOWLEDGE_NOT_CONFIGURED')
          localKnowledge = createPostgresBusinessKnowledgeReader({ queryFn: execute })
        }
        businessKnowledge = localKnowledge
        model = createDeterministicBusinessModel()
      } else {
        // Direct native ingress has already authenticated account scope. Opting
        // out of Edge binding does not weaken the production provider/Vault gates.
        const ports = runtimePorts ?? await runtimeFactory(env, { ...runtimeDependencies, queryFn, bindingRequired: false })
        if (!ports?.businessKnowledge || typeof ports.resolveModel !== 'function') {
          throw failure('LINE_BUSINESS_AGENT_NOT_CONFIGURED')
        }
        businessKnowledge = ports.businessKnowledge
        model = await ports.resolveModel({ tenantId, businessId })
        if (memoryOptIn && !selectedThreadMemory) selectedThreadMemory = ports.threadMemory
      }

      let memoryContext = null
      let memoryInbound = null
      let contextReceipt = null
      let injectedPacket = null
      if (memoryOptIn) {
        await assertMemoryJobLive(job, memoryStateReader)
        const serverScope = memoryServerScope(job, route)
        const contextInput = {
          tenantId, businessId, lineUserId: job.sourceUserId,
          threadId: route.externalRoomRef, eventId: job.eventId,
          serverScope, threadMemory: selectedThreadMemory, threadRoute: route,
          deferThreadRecall: true, knowledge: emptyMemoryKnowledge,
        }
        const firstContext = await contextAssembler(contextInput)
        if (!firstContext?.thread?.threadId || !firstContext.identity?.principalId) {
          throw failure('LINE_MEMORY_CONTEXT_UNAVAILABLE')
        }
        assertMemoryContextRoute(firstContext, route)
        await assertMemoryJobLive(job, memoryStateReader)
        memoryInbound = await selectedThreadMemory.appendMessage({
          threadId: firstContext.thread.threadId,
          speakerId: firstContext.identity.principalId,
          speakerKind: 'HUMAN',
          personId: firstContext.identity.verified ? firstContext.identity.principalId : null,
          identityAssurance: firstContext.identity.verified ? 'VERIFIED' : 'PENDING',
          direction: 'INBOUND',
          text: question,
          messageId: job.inbound.id,
          sourceEventId: `${route.channelAccountId}:${job.eventId}`,
          policyRevision: firstContext.policy?.version ?? 'default',
          requesterId: firstContext.identity.principalId,
          authorization: { authContext: firstContext.authContext },
        })
        if (!memoryInbound?.message?.exchangeId || !memoryInbound.message.messageId
          || !memoryInbound.session?.sessionId) {
          throw failure('LINE_MEMORY_APPEND_UNAVAILABLE')
        }
        await assertMemoryJobLive(job, memoryStateReader)
        memoryContext = await contextAssembler({ ...contextInput,
          deferThreadRecall: false, currentExchangeId: memoryInbound.message.exchangeId })
        if (!memoryContext?.threadMemory) throw failure('LINE_MEMORY_CONTEXT_UNAVAILABLE')
        assertMemoryContextRoute(memoryContext, route, { requirePacket: true })
        if (route.audienceKind !== 'DIRECT' && memoryContext.threadMemory.policyDecision === 'ALLOW') {
          throw failure('LINE_MEMORY_AUDIENCE_DENIED')
        }
        // @req FR-234 — compose the MSP packet through the Context Composer
        // BEFORE it reaches the model: split into provenance-bearing slices,
        // thread-scoped and budgeted by priority. GKS evidence and CRM/ERP
        // facts are not wired into this turn yet (FR-235, FR-231 are separate
        // phases), so both are empty here; the composer's own "no evidence and
        // no facts" rule is therefore never the reason a memory-opt-in turn
        // skips its model call today — that stays governed by
        // `answerBusinessQuestion`'s existing business-evidence gate.
        const authorizedForMemory = memoryContext.threadMemory.policyDecision === 'ALLOW'
        const composed = composeContext({
          authorized: authorizedForMemory,
          scope: { threadId: memoryContext.thread.threadId },
          audienceKind: route.audienceKind,
          mspSlices: authorizedForMemory ? mspPacketSlices(memoryContext.threadMemory) : [],
        })
        contextReceipt = composed.receipt
        // The packet handed to the model and to MSP's injection receipt is
        // rebuilt from ONLY the slices the composer included — never the
        // original packet — so the receipt this turn records can never
        // describe less than what the model actually saw.
        injectedPacket = injectedMspPacket(memoryContext.threadMemory,
          composed.slices.filter((slice) => slice.source === 'MSP'))
        trace?.recordThreadMemory?.({
          contextPacket: injectedPacket,
          thread: memoryContext.thread,
          exchangeId: memoryInbound.message.exchangeId,
          inboundMessageId: memoryInbound.message.messageId,
        })
        if (typeof trace?.recordContextReceipt === 'function') await trace.recordContextReceipt(contextReceipt)
      }
      const tracedKnowledge = trace ? { query: async input => {
        const evidence = await businessKnowledge.query(input)
        await trace.recordEvidence(input, evidence)
        return evidence
      } } : businessKnowledge
      // `injectedPacket` — never `memoryContext.threadMemory` — is what MSP's
      // injection receipt hashes and what the model actually receives below;
      // a packet the composer denied or fully trimmed is `null` here, so
      // `withInjectionReceipt` correctly skips wrapping (no injection to
      // attest) and the model gets no memory content at all.
      const invocationModel = memoryOptIn && typeof selectedThreadMemory.withInjectionReceipt === 'function'
        ? selectedThreadMemory.withInjectionReceipt({ model, contextPacket: injectedPacket,
          threadId: memoryContext.thread.threadId, exchangeId: memoryInbound.message.exchangeId,
          authorization: { authContext: memoryContext.authContext }, requesterId: memoryContext.identity.principalId,
          contextReceiptId: contextReceipt?.receiptId ?? null })
        : model
      if (memoryOptIn && (!invocationModel || typeof invocationModel.generate !== 'function')) {
        throw failure('LINE_MEMORY_INJECTION_RECEIPT_UNAVAILABLE')
      }
      if (memoryOptIn) await assertMemoryJobLive(job, memoryStateReader)
      const result = await answerBusinessQuestion({ tenantId, businessId, question }, {
        knowledge: tracedKnowledge, model: invocationModel, trace,
        contextPacket: memoryOptIn ? injectedPacket : null,
      })
      // Grounding may choose a deterministic fallback after a provider failure;
      // a failed journal write must never be mistaken for that safe fallback.
      trace?.assertHealthy()
      if (typeof result?.text !== 'string' || !result.text.trim()) throw failure('LINE_ANSWER_EMPTY')
      // LINE's text message limit is 5000 UTF-16 code units. Never leave a split
      // surrogate at the boundary when an evidence value contains emoji.
      const answerText = result.text.slice(0, 5000).replace(/[\uD800-\uDBFF]$/, '')
      if (memoryOptIn) {
        await assertMemoryJobLive(job, memoryStateReader)
        const currentAuthorization = await authorizationResolver({
          tenantId, businessId, lineUserId: job.sourceUserId, threadId: route.externalRoomRef,
          eventId: job.eventId, serverScope: memoryServerScope(job, route),
        })
        if (currentAuthorization?.authContext?.scope?.tenantId !== tenantId
          || currentAuthorization.authContext.scope.businessId !== businessId) {
          throw failure('LINE_MEMORY_SCOPE_MISMATCH')
        }
        if (route.audienceKind !== 'DIRECT' && currentAuthorization.policy?.privateMemoryAllowed === true) {
          throw failure('LINE_MEMORY_AUDIENCE_DENIED')
        }
        if (memoryContext.policy?.privateMemoryAllowed
          && (!currentAuthorization?.policy?.privateMemoryAllowed
            || currentAuthorization.policy?.mspAuthorization?.read !== true)) {
          throw failure('LINE_MEMORY_POLICY_REVOKED')
        }
        await assertMemoryJobLive(job, memoryStateReader)
        const memoryAgent = await selectedThreadMemory.appendMessage({
          threadId: memoryContext.thread.threadId,
          sessionId: memoryInbound.session?.sessionId ?? null,
          exchangeId: memoryInbound.message.exchangeId,
          replyToMessageId: memoryInbound.message.messageId,
          sourceEventId: `${memoryInbound.message.messageId}:assistant`,
          speakerId: 'zuri-line-agent', speakerKind: 'AGENT', identityAssurance: 'VERIFIED',
          requesterId: memoryContext.identity.principalId,
          authorization: currentAuthorization,
          direction: 'OUTBOUND', text: answerText, deliveryState: 'QUEUED',
          policyRevision: currentAuthorization?.policy?.version ?? 'default',
        })
        if (!memoryAgent?.message?.messageId || !memoryAgent?.session?.sessionId
          || memoryAgent.message.exchangeId !== memoryInbound.message.exchangeId) {
          throw failure('LINE_MEMORY_APPEND_UNAVAILABLE')
        }
      }
      return answerText
    } catch (error) {
      // Reader/provider failures may contain SQL, payload or credentials; the job
      // stores only this stable code, never the original message or cause.
      if (['EXECUTION_TRACE_PAYLOAD_TOO_LARGE', 'EXECUTION_TRACE_SECRET_FIELD', 'EXECUTION_TRACE_UNAVAILABLE'].includes(error?.code)) throw failure(error.code)
      // The MSP injection wrapper has already invoked the model when this receipt
      // is unknown. Retrying the claimed job could duplicate an external model
      // call, so preserve the durable UNKNOWN outcome for the worker boundary.
      if (error?.code === 'MSP_INJECTION_RECEIPT_UNKNOWN') throw failure(error.code)
      throw failure('LINE_ANSWER_UNAVAILABLE')
    }
  }
}
