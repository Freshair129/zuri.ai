import { createPostgresBusinessKnowledgeReader, createCorpusKnowledgeReader } from '@/modules/knowledge'
import { answerBusinessQuestion, createDeterministicBusinessModel, selectRegisteredQuery } from './grounded-business-answer'
import { createLineReadQueryFromEnv, createPhase1BusinessAgentPortsFromEnv } from './phase1-runtime'
import { assembleAgentContext } from './context'
import { resolveAgentAuthorization } from './auth-context'
import { composeContext } from './context-composer'
import {
  createLineGroundingReader,
  lineKnowledgeGroundingBudgetFromEnv,
  resolveLineKnowledgeGroundingMode,
} from './line-knowledge-grounding'

// @req FR-149, FR-150 — answer an already-admitted durable conversation job;
// @req FR-171 — persist selected evidence and pass the trace observer to the actual provider.
// execution placement and external model permission are distinct decisions.
// @req FR-234 — on the MSP-opt-in path, the MSP packet is split into
// provenance-bearing slices (one per exchange/summary/protected record/
// participant) and run through `context-composer.js`; the model and the MSP
// injection receipt receive ONLY the packet rebuilt from the composer's
// included slices, and the recorded `ContextReceipt` describes exactly that
// rebuilt packet — never the original, un-composed one. Exchanges are
// budgeted newest-first (a contiguous window of the most recent turns is
// kept, oldest dropped) and rebuilt chronologically; `packet.knowledge` has
// no composer-representable shape yet and is stripped rather than leaked
// unbudgeted; the rebuilt manifest folds in the composer's own drops so it
// cannot claim nothing was truncated when the composer trimmed something.
// Coverage today is partial: the LOCAL_ONLY / non-opt-in path's
// business-evidence model invocation does not run through the composer and
// records no receipt (see the composer module's own note).
// @req FR-235 — the account's `knowledgeGrounding` mode (ADR-090 D1) selects
// the reader `answerBusinessQuestion`'s single `knowledge.query` call uses.
// `BUSINESS_KNOWLEDGE` (default) is completely unwrapped — same reader, same
// external trace wrapper as before this requirement, so its trace and answer
// stay byte-identical. `GKS_CORPUS` / `GKS_THEN_BUSINESS_KNOWLEDGE` replace
// `businessKnowledge` with a mode-gated grounding reader
// (`line-knowledge-grounding.js`) that traces every hop it attempts and
// returns evidence only — it never composes and never records a receipt. On
// a memory-opt-in turn this evidence is composed together with the MSP
// packet, in exactly one `composeContext` call here, under one budget
// (FR-234/SDD-100); `businessKnowledge` is then replaced by a reader that
// returns exactly the composer's included knowledge slices, so
// `answerBusinessQuestion` neither re-fetches nor re-traces, and the evidence
// the model receives is exactly what the one recorded `ContextReceipt` lists
// — recorded only when that evidence is non-empty, i.e. only when a model
// will actually be invoked. On a non-memory-opt-in turn the grounding
// reader's evidence flows to `answerBusinessQuestion` directly, uncomposed,
// exactly as before this fix (no MSP packet exists to compose it with, and
// FR-234's own documented coverage is MSP-opt-in only).
// @spec ADR-061, SEC-001, SEC-010 — public scoped knowledge by default; the
// persisted opt-in may compose the trusted MSP thread without a second CRM
// ingest, write action or implicit external model fallback.
// @spec ADR-090 D1-D5, SEC-032, SDD-099 — grounding mode, mode-gated fallback,
// budget, retrievalRefs and Business scoping.
// @spec ADR-091 D7, SDD-100 — Context Composer placement and receipt shape.
// @tested tests/unit/server-line-answer.test.js, tests/integration/line-worker-memory.test.js,
//   tests/unit/line-knowledge-grounding.test.js, tests/integration/line-gks-grounding.test.js

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
//
// Only exchanges declare a `sequence` ('exchanges'): the composer's
// contiguous cutoff is scoped to a named sequence, never to the whole prompt
// (context-composer.js's own doc comment on `mspSlices`), so a single
// oversized participant or protected record is dropped on its own — it must
// never close the budget for the exchanges that follow it in priority order,
// which is exactly the regression a prior version of this fix introduced by
// making the cutoff global.
//
// Order fed to the composer:
//   1. participants — roster metadata `buildThreadContextPacket` never trims;
//      each judged on its own fit, no sequence.
//   2. protected (verified) facts — also never trimmed by MSP's own builder;
//      each judged on its own fit, no sequence.
//   3. recent exchanges, NEWEST FIRST, sequence 'exchanges' — `memory.
//      recentExchanges` is oldest-first in the packet (MSP's convention), but
//      a budget cutoff must drop the OLDEST turns and keep a contiguous
//      window of the most recent ones, never the reverse. Reversed here so
//      "the first exchange that does not fit" is the oldest surviving
//      candidate, and every older one after it is dropped too — no gap in
//      the kept window. The shared `sequence` name is what makes this
//      contiguous cutoff apply only within the exchanges themselves.
//   4. summaries — MSP's own builder trims these before touching exchanges
//      at all (`buildThreadContextPacket` shifts summaries first), so they
//      are ordered last here to mirror that same disposability; each judged
//      on its own fit, no sequence (an oversized summary drops alone).
// `packet.knowledge` (a separate, non-MSP field) is never turned into a slice
// here — see injectedMspPacket's own note on why it is stripped instead.
function mspPacketSlices(packet) {
  const threadId = packet?.thread?.threadId ?? null
  const participants = Array.isArray(packet?.memory?.participants) ? packet.memory.participants : []
  const protectedRecords = Array.isArray(packet?.memory?.protectedMemory) ? packet.memory.protectedMemory : []
  const exchanges = Array.isArray(packet?.memory?.recentExchanges) ? packet.memory.recentExchanges : []
  const summaries = Array.isArray(packet?.memory?.summaries) ? packet.memory.summaries : []
  const exchangeSlices = exchanges.map((exchange, index) =>
    ({ id: `exchange:${exchange?.exchangeId ?? index}`, threadId, sequence: 'exchanges', text: exchange }))
  return [
    ...participants.map((participant, index) => ({ id: `participant:${participant?.principalId ?? participant?.id ?? index}`, threadId, text: participant })),
    ...protectedRecords.map((record, index) => ({ id: `protected:${record?.recordId ?? index}`, threadId, text: record })),
    ...[...exchangeSlices].reverse(),
    ...summaries.map((summary, index) => ({ id: `summary:${summary?.summaryId ?? index}`, threadId, text: summary })),
  ]
}

const MSP_SLICE_PREFIXES = Object.freeze(['participant:', 'protected:', 'exchange:', 'summary:'])

function sliceIdSuffix(id, prefix) {
  return id.slice(prefix.length)
}

/**
 * Rebuild the packet actually handed to the model and to MSP's injection
 * receipt from the Context Composer's included MSP slices ONLY — nothing
 * this packet originally carried is passed through untouched. Returns `null`
 * when nothing survived composition — "no memory is injected" must mean no
 * packet, not an empty-looking one that still carries policy/identity
 * metadata a reader could mistake for content.
 *
 * `droppedMspSlices` — this same call's own drops (BUDGET_TRIMMED,
 * THREAD_SCOPE_MISMATCH, AUDIENCE_SCOPE_DENIED, SUPERSEDED_BY_RECORD) — are
 * folded into the rebuilt manifest's `omittedRanges`/`budget.truncated`/
 * `coverageGap`, so a packet the composer trimmed cannot claim nothing was
 * truncated, which is what MSP's own manifest fields would otherwise say.
 */
function injectedMspPacket(packet, includedMspSlices, droppedMspSlices = []) {
  if (!packet) return null
  const byPrefix = (prefix) => includedMspSlices
    .filter((slice) => slice.id.startsWith(prefix))
    .map((slice) => slice.content)
  const participants = byPrefix('participant:')
  const protectedMemory = byPrefix('protected:')
  // Composed newest-first for the budget (see mspPacketSlices); rebuilt
  // chronologically (oldest-first) to match MSP's own packet convention.
  const recentExchanges = byPrefix('exchange:').reverse()
  const summaries = byPrefix('summary:')
  if (!participants.length && !protectedMemory.length && !recentExchanges.length && !summaries.length) return null

  const omittedRanges = [...(packet.manifest?.omittedRanges ?? [])]
  for (const entry of droppedMspSlices) {
    const prefix = MSP_SLICE_PREFIXES.find((candidate) => entry.id.startsWith(candidate))
    if (prefix === 'exchange:') omittedRanges.push({ exchangeId: sliceIdSuffix(entry.id, prefix), reason: entry.reason })
    else if (prefix === 'summary:') omittedRanges.push({ summaryId: sliceIdSuffix(entry.id, prefix), reason: entry.reason })
    else if (prefix === 'protected:') omittedRanges.push({ protectedRecordId: sliceIdSuffix(entry.id, prefix), reason: entry.reason })
    else if (prefix === 'participant:') omittedRanges.push({ participantId: sliceIdSuffix(entry.id, prefix), reason: entry.reason })
  }
  const truncated = droppedMspSlices.length > 0

  return {
    ...packet,
    // @req FR-234 — `packet.knowledge` is the agent's own graph-relation
    // lookup (queryKnowledge: a principal's relations, not a GKS corpus
    // citation), with no per-item shape this composer can budget or receipt
    // yet. Rather than invent citation semantics it does not have, it is
    // stripped entirely: every content-bearing field the model receives must
    // either go through the composer or be removed (see the review this
    // fixes), and this field has no composer-representable shape today.
    knowledge: null,
    memory: { participants, recentExchanges, summaries, protectedMemory },
    manifest: packet.manifest ? {
      ...packet.manifest,
      effectiveRecentExchangeCount: recentExchanges.length,
      summaryCount: summaries.length,
      protectedRecordCount: protectedMemory.length,
      omittedRanges,
      coverageGap: Boolean(packet.manifest.coverageGap) || truncated,
      budget: packet.manifest.budget
        ? { ...packet.manifest.budget, truncated: Boolean(packet.manifest.budget.truncated) || truncated }
        : packet.manifest.budget,
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

      // @req FR-235 — a missing/unrecognised mode always resolves to
      // BUSINESS_KNOWLEDGE (fail closed to today's behaviour, never to a
      // corpus read). `job.account`'s scope was already asserted to match
      // `tenantId`/`businessId` above, or is absent — this reads no other
      // field from it, and the corpus reader is built from the job's own
      // verified scope, never from the account row's identity.
      const groundingMode = resolveLineKnowledgeGroundingMode(job.account?.knowledgeGrounding)
      if (groundingMode !== 'BUSINESS_KNOWLEDGE') {
        const corpusReader = createCorpusKnowledgeReader({
          tenantId, businessId,
          ...lineKnowledgeGroundingBudgetFromEnv(env),
        })
        businessKnowledge = createLineGroundingReader({
          mode: groundingMode, corpusReader, businessKnowledgeReader: businessKnowledge, trace,
          budgetMs: lineKnowledgeGroundingBudgetFromEnv(env).budgetMs,
        })
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
        const authorizedForMemory = memoryContext.threadMemory.policyDecision === 'ALLOW'
        // @req FR-235 — for a corpus-grounding mode, pre-fetch this turn's
        // knowledge evidence ONCE, here, before composing. This is the exact
        // same `knowledge.query` call `answerBusinessQuestion` would otherwise
        // make internally — `selectRegisteredQuery` is a pure function of
        // `question` alone, so deriving its input out here and handing
        // `answerBusinessQuestion` a reader that simply returns what was
        // already fetched changes nothing about which evidence is selected,
        // only when. The grounding reader's own per-hop EVIDENCE_SELECTED
        // tracing (line-knowledge-grounding.js) fires on this call exactly as
        // it does on the non-memory-opt-in path — nothing here traces a hop.
        let knowledgeSliceInputs = []
        const knowledgeRecordById = new Map()
        if (groundingMode !== 'BUSINESS_KNOWLEDGE') {
          const registeredQuery = selectRegisteredQuery(question)
          const groundingEvidence = await businessKnowledge.query({ tenantId, businessId, ...registeredQuery })
          const groundingRecords = Array.isArray(groundingEvidence?.records) ? groundingEvidence.records : []
          knowledgeSliceInputs = groundingRecords.map((record, index) => {
            const id = `knowledge:${index}`
            knowledgeRecordById.set(id, record)
            // No `sequence`: corpus hits are ranked results, not an ordered
            // conversation. Tagging them into a named sequence would let one
            // oversized hit close the budget for every lower-ranked hit after
            // it — exactly the starvation the composer's own doc comment
            // warns a shared sequence can cause, and exactly why these stay
            // untagged (each judged, and dropped, on its own fit).
            return { id, citationId: record.citationId ?? null, text: typeof record.text === 'string' ? record.text : JSON.stringify(record) }
          })
        }
        // @req FR-234, FR-235 — compose the MSP packet and (for a corpus-
        // grounding mode) this turn's knowledge evidence in ONE call, under
        // ONE prompt-wide budget — never two compositions and never two
        // ContextReceipts for one model invocation (FR-234/SDD-100). CRM/ERP
        // facts (FR-231) remain a separate, later phase; `records` stays empty.
        //
        // `authorized` here governs this shared composition's own contract; it
        // is deliberately NOT reused for the knowledge slices when a
        // grounding mode is active, because `authorizedForMemory` answers a
        // different question (may this turn see PRIVATE, personal MSP thread
        // memory) than knowledge access does (the Business's own published
        // corpus is authorized upstream, by ADR-072, independent of MSP
        // audience policy) — composeContext's single `authorized` flag denies
        // the WHOLE packet, so reusing the MSP-specific denial here would
        // silently drop a valid product answer in, say, a GROUP chat the
        // audience policy denies private memory to. The MSP-specific denial
        // is still applied exactly as before: `mspSlices` is `[]` whenever
        // `authorizedForMemory` is false, same as pre-FR-235. For
        // BUSINESS_KNOWLEDGE mode (no knowledge slices ever composed here),
        // `authorized: authorizedForMemory` is unchanged, so this call
        // composes and its receipt records byte-identically to before FR-235.
        const composed = composeContext({
          authorized: groundingMode === 'BUSINESS_KNOWLEDGE' ? authorizedForMemory : true,
          scope: { threadId: memoryContext.thread.threadId },
          audienceKind: route.audienceKind,
          mspSlices: authorizedForMemory ? mspPacketSlices(memoryContext.threadMemory) : [],
          knowledgeEvidence: knowledgeSliceInputs,
        })
        // The packet handed to the model and to MSP's injection receipt is
        // rebuilt from ONLY the slices the composer included — never the
        // original packet — so the receipt this turn records can never
        // describe less than what the model actually saw.
        injectedPacket = injectedMspPacket(memoryContext.threadMemory,
          composed.slices.filter((slice) => slice.source === 'MSP'),
          composed.dropped.filter((entry) => entry.source === 'MSP'))
        trace?.recordThreadMemory?.({
          contextPacket: injectedPacket,
          thread: memoryContext.thread,
          exchangeId: memoryInbound.message.exchangeId,
          inboundMessageId: memoryInbound.message.messageId,
        })
        if (groundingMode === 'BUSINESS_KNOWLEDGE') {
          // Unchanged: this mode never composes knowledge evidence, so its
          // (MSP-only) receipt is recorded exactly as it was before FR-235.
          contextReceipt = composed.receipt
          if (typeof trace?.recordContextReceipt === 'function') await trace.recordContextReceipt(contextReceipt)
        } else {
          // @req FR-235 — rebuild the evidence answerBusinessQuestion will see
          // from ONLY the composer's included KNOWLEDGE slices, so a recorded
          // receipt can never list a citation the model did not receive, and
          // an omitted one can never describe evidence the model did receive.
          const includedKnowledge = composed.slices.filter((slice) => slice.source === 'KNOWLEDGE')
          const finalKnowledgeRecords = includedKnowledge.map((slice) => knowledgeRecordById.get(slice.id)).filter(Boolean)
          // `answerBusinessQuestion`'s own `knowledge.query` call now returns
          // exactly this — already selected, already composed — evidence; it
          // fetches and traces nothing a second time.
          businessKnowledge = { query: async () => ({ records: finalKnowledgeRecords }) }
          // @req FR-234/SDD-100 — exactly one ContextReceipt per model
          // invocation, and never one when no model will be called.
          // `answerBusinessQuestion` decides that call solely from
          // `evidence.records.length`, which is exactly `finalKnowledgeRecords`
          // here — so this is not a guess about what it will decide, it is
          // the same decision, made once.
          if (finalKnowledgeRecords.length > 0) {
            contextReceipt = composed.receipt
            if (typeof trace?.recordContextReceipt === 'function') await trace.recordContextReceipt(contextReceipt)
          }
        }
      }
      // @req FR-235 — a grounding-mode reader (GKS_CORPUS /
      // GKS_THEN_BUSINESS_KNOWLEDGE) already traces every hop it attempts
      // internally (line-knowledge-grounding.js), tagged with the source that
      // hop actually used; wrapping it here too would double-trace the same
      // turn under the wrong, hard-coded 'BUSINESS_QUERY' source. Only the
      // untouched BUSINESS_KNOWLEDGE path keeps this external wrapper, so its
      // trace stays exactly what it was before this requirement.
      const tracedKnowledge = trace && groundingMode === 'BUSINESS_KNOWLEDGE' ? { query: async input => {
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
