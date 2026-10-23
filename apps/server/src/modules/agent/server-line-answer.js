import { createCorpusKnowledgeReader } from '@/modules/knowledge'
import { answerBusinessQuestion, selectRegisteredQuery } from './grounded-business-answer'
import { createPhase1BusinessAgentPortsFromEnv } from './phase1-runtime'
import { assembleAgentContext } from './context'
import { resolveAgentAuthorization } from './auth-context'
import { composeContext } from './context-composer'
import { boundLineText } from './line-answer-policy'
import {
  createLineGroundingReader,
  lineKnowledgeGroundingBudgetFromEnv,
  resolveLineKnowledgeGroundingMode,
} from './line-knowledge-grounding'
import { runLineGroundingShadowCompare } from './line-grounding-shadow-compare'
import { resolveLineMemoryProject } from '@/modules/line-oa-studio/application/line-memory-scope'
import { assertMainDevLocalOllamaJob } from './main-dev-local-ollama'

// @req FR-149, FR-150 — answer an already-admitted durable conversation job;
// @req FR-171 — persist selected evidence and pass the trace observer to the actual provider.
// execution placement and external model permission are distinct decisions.
// @req FR-234, FR-235 — every model attempt receives only the evidence and MSP
// slices selected under one composer budget. A content-free receipt is recorded
// immediately before the provider entry; empty/fully-trimmed evidence calls no model.
// @req FR-079, FR-080 — the main-dev Ollama turn requires a trusted OA and the
// pinned TEST ONLY reader; corpus grounding and shadow remain denied. MSP memory
// stays default-off and is available only through its explicit profile opt-in,
// while the existing identity, policy, consent, audience, and bounded-flow gates apply.
// @spec ADR-061, SEC-001, SEC-010 — public scoped knowledge by default; the
// persisted opt-in may compose the trusted MSP thread without a second CRM
// ingest, write action or implicit external model fallback.
// @spec ADR-090 D1-D5, SEC-032, SDD-099 — grounding mode, mode-gated fallback,
// budget, retrievalRefs and Business scoping.
// @spec ADR-091 D7, SDD-100 — Context Composer placement and receipt shape.
// @req FR-277 — a shadow-compare generation is started (never awaited) right
// after `answerText` is final; see line-grounding-shadow-compare.js for the
// full design constraints (never customer-visible, never blocks dispatch,
// disabled by default, never throws).
// @tested tests/unit/server-line-answer.test.js, tests/integration/line-worker-memory.test.js,
//   tests/unit/line-knowledge-grounding.test.js, tests/integration/line-gks-grounding.test.js,
//   tests/unit/line-grounding-shadow-compare.test.js, tests/unit/main-dev-local-ollama-runtime.test.js

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
export function mspPacketSlices(packet, episodicEntries = []) {
  const threadId = packet?.thread?.threadId ?? null
  const participants = Array.isArray(packet?.memory?.participants) ? packet.memory.participants : []
  const protectedRecords = Array.isArray(packet?.memory?.protectedMemory) ? packet.memory.protectedMemory : []
  const exchanges = Array.isArray(packet?.memory?.recentExchanges) ? packet.memory.recentExchanges : []
  const summaries = Array.isArray(packet?.memory?.summaries) ? packet.memory.summaries : []
  const exchangeSlices = exchanges.map((exchange, index) =>
    ({ id: `exchange:${exchange?.exchangeId ?? index}`, threadId, sequence: 'exchanges', text: exchange }))
  const episodicSlices = episodicEntries.map((entry, index) => ({
    id: `episodic:${entry?.id ?? entry?.reference?.memoryId ?? index}`,
    scope: 'CROSS_THREAD',
    text: entry,
  }))
  return [
    ...participants.map((participant, index) => ({ id: `participant:${participant?.principalId ?? participant?.id ?? index}`, threadId, text: participant })),
    ...protectedRecords.map((record, index) => ({ id: `protected:${record?.recordId ?? index}`, threadId, text: record })),
    ...[...exchangeSlices].reverse(),
    ...summaries.map((summary, index) => ({ id: `summary:${summary?.summaryId ?? index}`, threadId, text: summary })),
    ...episodicSlices,
  ]
}

const MSP_SLICE_PREFIXES = Object.freeze(['participant:', 'protected:', 'exchange:', 'summary:', 'episodic:'])

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
  const episodic = byPrefix('episodic:')
  if (!participants.length && !protectedMemory.length && !recentExchanges.length && !summaries.length && !episodic.length) return null

  const omittedRanges = [...(packet.manifest?.omittedRanges ?? [])]
  for (const entry of droppedMspSlices) {
    const prefix = MSP_SLICE_PREFIXES.find((candidate) => entry.id.startsWith(candidate))
    if (prefix === 'exchange:') omittedRanges.push({ exchangeId: sliceIdSuffix(entry.id, prefix), reason: entry.reason })
    else if (prefix === 'summary:') omittedRanges.push({ summaryId: sliceIdSuffix(entry.id, prefix), reason: entry.reason })
    else if (prefix === 'protected:') omittedRanges.push({ protectedRecordId: sliceIdSuffix(entry.id, prefix), reason: entry.reason })
    else if (prefix === 'participant:') omittedRanges.push({ participantId: sliceIdSuffix(entry.id, prefix), reason: entry.reason })
    else if (prefix === 'episodic:') omittedRanges.push({ episodicMemoryId: sliceIdSuffix(entry.id, prefix), reason: entry.reason })
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
    memory: { participants, recentExchanges, summaries, protectedMemory, episodic },
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

export function memoryRoute(job) {
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

export function memoryServerScope(job, route) {
  return {
    transportVerified: true,
    channelAccountId: route.channelAccountId,
    bindingId: route.channelAccountId,
    audienceKind: route.audienceKind,
    agentId: 'zuri-line-agent',
    mspAuthorization: { read: true, writePrivate: false, writeShared: false },
    episodicMemoryOptIn: job.episodicMemoryOptIn === true,
    ...(job.episodicMemoryOptIn === true ? {
      workspaceId: job.episodicWorkspaceId ?? null,
      projectId: job.episodicProjectId ?? null,
    } : {}),
    // @req FR-149 — Core's PENDING memory mode: a Conversation Runtime job that Core
    // admitted for an unverified sender (`CHANNEL_IDENTITY_ADMITTED`) is marked by
    // Core's own claim check, never by the runtime. The legacy worker's job rows carry
    // no such mark, so its scope is unchanged.
    ...(job.senderIdentityState === 'UNVERIFIED' ? { identityState: 'UNVERIFIED' } : {}),
    // These identifiers are copied from the claimed, persisted job only. They
    // are never accepted from the LINE message or model request.
    tenantId: job.tenantId,
    businessId: job.businessId,
  }
}

async function resolveLiveLineEpisodicAuthorization({ job, memoryStateReader, authorizationResolver,
  scopeResolver, env, identityState } = {}) {
  if (env.ZURI_MSP_EPISODIC_MEMORY_ENABLED !== 'true' || job?.episodicMemoryOptIn !== true
    || job?.memorySyncOptIn !== true || job?.audienceKind !== 'DIRECT' || job?.errorCode === 'PDPA_ERASURE'
    || identityState === 'UNVERIFIED' || (identityState !== undefined && identityState !== 'VERIFIED')
    || !job?.id || !job?.episodicWorkspaceId || !job?.episodicProjectId
    || typeof memoryStateReader !== 'function') return null

  let current
  try { current = await memoryStateReader(job.id) } catch { return null }
  const account = current?.account
  if (!current || current.status !== 'CLAIMED' || current.version !== job.version
    || current.errorCode === 'PDPA_ERASURE' || current.memorySyncOptIn !== true
    || current.episodicMemoryOptIn !== true || current.audienceKind !== 'DIRECT'
    || current.episodicWorkspaceId !== job.episodicWorkspaceId
    || current.episodicProjectId !== job.episodicProjectId
    || current.tenantId !== job.tenantId || current.businessId !== job.businessId
    || current.channelAccountId !== job.channelAccountId || current.transportEpoch !== job.transportEpoch
    || !account || account.id !== job.account?.id || account.tenantId !== job.tenantId
    || account.businessId !== job.businessId || account.memoryProjectId !== job.episodicProjectId
    || account.serverEnabled !== true || account.transportMode !== 'CLOUD'
    || account.status !== 'CONNECTED' || account.transportEpoch !== current.transportEpoch) return null

  const liveJob = { ...job, ...current, account: { ...job.account, ...account } }
  const scope = await scopeResolver({ tenantId: liveJob.tenantId, businessId: liveJob.businessId,
    projectId: account.memoryProjectId })
  if (!scope || scope.projectId !== liveJob.episodicProjectId || scope.workspaceId !== liveJob.episodicWorkspaceId) return null
  const route = memoryRoute(liveJob)
  const authorization = await authorizationResolver({ tenantId: liveJob.tenantId, businessId: liveJob.businessId,
    lineUserId: liveJob.sourceUserId, threadId: route.externalRoomRef, eventId: liveJob.eventId,
    serverScope: memoryServerScope(liveJob, route) })
  if (authorization?.policy?.episodicMemoryAllowed !== true
    || authorization?.authContext?.policy?.decision !== 'ALLOW'
    || authorization?.authContext?.actor?.identityVerified !== true
    || authorization?.authContext?.scope?.tenantId !== liveJob.tenantId
    || authorization?.authContext?.scope?.businessId !== liveJob.businessId
    || authorization?.authContext?.scope?.workspaceId !== scope.workspaceId
    || authorization?.authContext?.scope?.projectId !== scope.projectId) return null
  return { job: liveJob, route, scope, authorization }
}

export async function assertLineEpisodicMemoryJobLive(options = {}) {
  const live = await resolveLiveLineEpisodicAuthorization({
    ...options, authorizationResolver: options.authorizationResolver ?? resolveAgentAuthorization,
    scopeResolver: options.scopeResolver ?? resolveLineMemoryProject, env: options.env ?? process.env,
  })
  if (!live) throw failure('LINE_EPISODIC_MEMORY_JOB_FENCED')
  return live
}

export async function readAuthorizedLineEpisodicMemory({ job, memoryPort, memoryStateReader,
  authorizationResolver = resolveAgentAuthorization, scopeResolver = resolveLineMemoryProject,
  env = process.env, identityState } = {}) {
  const live = await resolveLiveLineEpisodicAuthorization({ job, memoryStateReader,
    authorizationResolver, scopeResolver, env, identityState })
  if (!live) return { allowed: false, entries: [] }
  const selectedPort = typeof memoryPort === 'function' ? await memoryPort() : memoryPort
  if (typeof selectedPort?.recallAuthorized !== 'function') throw failure('LINE_EPISODIC_MEMORY_NOT_CONFIGURED')
  const recalled = await selectedPort.recallAuthorized(live.authorization)
  return { allowed: true, entries: Array.isArray(recalled?.entries) ? recalled.entries : [] }
}

function memoryAudience(value) {
  return typeof value === 'string' ? value.toUpperCase() : null
}

/** MSP may return an opaque thread, but its bound identity must still match the
 * route that came from the claimed LINE job before any append/model call. */
export function assertMemoryContextRoute(context, route, { requirePacket = false } = {}) {
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

export async function assertMemoryJobLive(job, memoryStateReader, env = process.env) {
  if (job?.errorCode === 'PDPA_ERASURE') throw failure('LINE_MEMORY_JOB_ERASED')
  if (job?.memorySyncOptIn !== true || env.ZURI_MSP_THREAD_MEMORY_ENABLED !== 'true') {
    throw failure('LINE_MEMORY_JOB_FENCED')
  }
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
  if (job.episodicMemoryOptIn === true && (!job.episodicWorkspaceId || !job.episodicProjectId
    || account?.memoryProjectId !== job.episodicProjectId)) {
    throw failure('LINE_MEMORY_SCOPE_MISMATCH')
  }
}

// @req FR-149 — the three memory-opt-in phases below are the ONE implementation of
// a memory turn's MSP side. The legacy worker's `createServerLineAnswer` runs them
// in-process around its own model call; the Conversation Runtime Core façade
// (`conversation-runtime-memory.js`) runs the same functions behind its v1
// `memory` operation, so both cohorts make the same MSP calls in the same order
// under the same fences (ADR-106 D2 Memory/Knowledge).

/**
 * Pre-model half: fence the claimed job, resolve the thread, project the admitted
 * inbound message into it once, then recall the thread context for this exchange.
 * The job is re-checked before every MSP boundary (`assertMemoryJobLive`).
 */
export async function prepareLineMemoryContext({ job, route, question, threadMemory,
  episodicMemory = null, projectionReceiptWriter = null, contextAssembler = assembleAgentContext,
  memoryStateReader, env = process.env } = {}) {
  const tenantId = job.tenantId
  const businessId = job.businessId
  await assertMemoryJobLive(job, memoryStateReader, env)
  const serverScope = memoryServerScope(job, route)
  const contextInput = {
    tenantId, businessId, lineUserId: job.sourceUserId,
    threadId: route.externalRoomRef, eventId: job.eventId,
    serverScope, threadMemory, threadRoute: route,
    deferThreadRecall: true, knowledge: emptyMemoryKnowledge,
  }
  const firstContext = await contextAssembler(contextInput)
  if (!firstContext?.thread?.threadId || !firstContext.identity?.principalId) {
    throw failure('LINE_MEMORY_CONTEXT_UNAVAILABLE')
  }
  assertMemoryContextRoute(firstContext, route)
  await assertMemoryJobLive(job, memoryStateReader, env)
  const memoryInbound = await threadMemory.appendMessage({
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
  if (typeof projectionReceiptWriter === 'function') await projectionReceiptWriter({ job,
    principalId: firstContext.identity.principalId, direction: 'INBOUND', crmMessageId: job.inbound.id,
    threadId: firstContext.thread.threadId, sessionId: memoryInbound.session.sessionId,
    messageId: memoryInbound.message.messageId, exchangeId: memoryInbound.message.exchangeId })
  await assertMemoryJobLive(job, memoryStateReader, env)
  const memoryContext = await contextAssembler({ ...contextInput,
    ...(job.episodicMemoryOptIn === true && episodicMemory ? { memory: episodicMemory } : {}),
    deferThreadRecall: false, currentExchangeId: memoryInbound.message.exchangeId })
  if (!memoryContext?.threadMemory) throw failure('LINE_MEMORY_CONTEXT_UNAVAILABLE')
  assertMemoryContextRoute(memoryContext, route, { requirePacket: true })
  if (route.audienceKind !== 'DIRECT' && memoryContext.threadMemory.policyDecision === 'ALLOW') {
    throw failure('LINE_MEMORY_AUDIENCE_DENIED')
  }
  await assertMemoryJobLive(job, memoryStateReader, env)
  const authorizedForMemory = memoryContext.threadMemory.policyDecision === 'ALLOW'
  return { memoryContext, memoryInbound, authorizedForMemory }
}

/**
 * Compose the recalled MSP packet (and, for a corpus-grounding mode, this turn's
 * knowledge slices) in ONE `composeContext` call and rebuild the packet the model
 * and MSP's injection receipt receive from the composer's included slices only.
 * See the FR-234/FR-235 notes inside `createServerLineAnswer` for why.
 */
export function composeLineEpisodicPacket({ entries = [], route, knowledgeSliceInputs = [] } = {}) {
  const composed = composeContext({ authorized: true, scope: {}, audienceKind: route?.audienceKind,
    mspSlices: mspPacketSlices(null, entries), knowledgeEvidence: knowledgeSliceInputs })
  const episodic = composed.slices.filter(slice => slice.source === 'MSP' && slice.scope === 'CROSS_THREAD')
  const injectedPacket = episodic.length ? {
    policyDecision: 'ALLOW', memory: { episodic: episodic.map(slice => slice.content) },
    manifest: { episodicMemoryCount: episodic.length, coverageGap: composed.dropped.length > 0,
      budget: { ...composed.receipt.budget, truncated: composed.dropped.length > 0 } },
  } : null
  return { composed, injectedPacket }
}

export function composeLineMemoryPacket({ memoryContext, route, authorizedForMemory,
  episodicEntries = [], episodicAuthorized = false, groundingMode = 'BUSINESS_KNOWLEDGE', knowledgeSliceInputs = [] } = {}) {
  const mspSlices = [
    ...(authorizedForMemory ? mspPacketSlices(memoryContext.threadMemory) : []),
    ...(episodicAuthorized ? mspPacketSlices(null, episodicEntries) : []),
  ]
  const composed = composeContext({
    authorized: true,
    scope: { threadId: memoryContext.thread.threadId },
    audienceKind: route.audienceKind,
    mspSlices,
    knowledgeEvidence: knowledgeSliceInputs,
  })
  const injectedPacket = injectedMspPacket(memoryContext.threadMemory,
    composed.slices.filter((slice) => slice.source === 'MSP'),
    composed.dropped.filter((entry) => entry.source === 'MSP'))
  return { composed, injectedPacket }
}

/**
 * @req FR-235 — a corpus-grounding turn's knowledge records as Context Composer
 * slices (`knowledge:<index>`, no `sequence`), plus the lookup that rebuilds the
 * composer-included records. Shared by the legacy worker and Core's memory `read`.
 */
export function lineKnowledgeSliceInputs(records) {
  const knowledgeRecordById = new Map()
  const knowledgeSliceInputs = (Array.isArray(records) ? records : []).map((record, index) => {
    const id = `knowledge:${index}`
    knowledgeRecordById.set(id, record)
    // No `sequence`: corpus hits are ranked results, not an ordered
    // conversation. Tagging them into a named sequence would let one
    // oversized hit close the budget for every lower-ranked hit after
    // it — exactly the starvation the composer's own doc comment
    // warns a shared sequence can cause, and exactly why these stay
    // untagged (each judged, and dropped, on its own fit).
    return { id, citationId: record.citationId ?? null, text: JSON.stringify(record) }
  })
  return { knowledgeSliceInputs, knowledgeRecordById }
}

/** @req FR-235 — the knowledge records the composer included, in its own order. */
export function composedKnowledgeRecords(composed, knowledgeRecordById) {
  return composed.slices.filter((slice) => slice.source === 'KNOWLEDGE')
    .map((slice) => knowledgeRecordById.get(slice.id)).filter(Boolean)
}

/** The durable identifiers the post-model half needs from the pre-model half. */
export function lineMemoryHandle(memoryContext, memoryInbound) {
  return {
    threadId: memoryContext.thread.threadId,
    principalId: memoryContext.identity.principalId,
    privateMemoryAllowed: Boolean(memoryContext.policy?.privateMemoryAllowed),
    sessionId: memoryInbound.session?.sessionId ?? null,
    exchangeId: memoryInbound.message.exchangeId,
    inboundMessageId: memoryInbound.message.messageId,
  }
}

/**
 * Post-model half: re-fence the job, re-resolve the current authorization, refuse
 * a revoked private-memory policy, then queue the agent's reply into the same
 * exchange. Nothing is appended unless every check passes.
 */
export async function appendLineMemoryAnswer({ job, route, threadMemory, memory, answerText,
  authorizationResolver = resolveAgentAuthorization, projectionReceiptWriter = null,
  memoryStateReader, env = process.env } = {}) {
  const tenantId = job.tenantId
  const businessId = job.businessId
  await assertMemoryJobLive(job, memoryStateReader, env)
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
  if (memory.privateMemoryAllowed
    && (!currentAuthorization?.policy?.privateMemoryAllowed
      || currentAuthorization.policy?.mspAuthorization?.read !== true)) {
    throw failure('LINE_MEMORY_POLICY_REVOKED')
  }
  await assertMemoryJobLive(job, memoryStateReader, env)
  const memoryAgent = await threadMemory.appendMessage({
    threadId: memory.threadId,
    sessionId: memory.sessionId ?? null,
    exchangeId: memory.exchangeId,
    replyToMessageId: memory.inboundMessageId,
    sourceEventId: `${memory.inboundMessageId}:assistant`,
    speakerId: 'zuri-line-agent', speakerKind: 'AGENT', identityAssurance: 'VERIFIED',
    requesterId: memory.principalId,
    authorization: currentAuthorization,
    direction: 'OUTBOUND', text: answerText, deliveryState: 'QUEUED',
    policyRevision: currentAuthorization?.policy?.version ?? 'default',
  })
  if (!memoryAgent?.message?.messageId || !memoryAgent?.session?.sessionId
    || memoryAgent.message.exchangeId !== memory.exchangeId) {
    throw failure('LINE_MEMORY_APPEND_UNAVAILABLE')
  }
  if (typeof projectionReceiptWriter === 'function') await projectionReceiptWriter({ job,
    principalId: memory.principalId, direction: 'OUTBOUND', threadId: memory.threadId,
    sessionId: memoryAgent.session.sessionId, messageId: memoryAgent.message.messageId,
    exchangeId: memoryAgent.message.exchangeId })
  return memoryAgent
}

/** Input is the worker's claimed job, including the CRM `inbound` relation. */
export function createServerLineAnswer({
  env = process.env,
  queryFn,
  runtimeFactory = createPhase1BusinessAgentPortsFromEnv,
  threadMemory = null,
  contextAssembler = assembleAgentContext,
  authorizationResolver = resolveAgentAuthorization,
  scopeResolver = resolveLineMemoryProject,
  projectionReceiptWriter = null,
  ...runtimeDependencies
} = {}) {
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
    let mainDevLocalOllamaProfile = null
    try {
      mainDevLocalOllamaProfile = assertMainDevLocalOllamaJob({ env, job })
    } catch {
      throw failure('LINE_ANSWER_UNAVAILABLE')
    }
    const mainDevLocalOllama = Boolean(mainDevLocalOllamaProfile)
    const memoryAllowed = !mainDevLocalOllama || mainDevLocalOllamaProfile.memoryEnabled === true
    const memoryOptIn = memoryAllowed && job.memorySyncOptIn === true && env.ZURI_MSP_THREAD_MEMORY_ENABLED === 'true'
    const episodicMemoryOptIn = memoryAllowed && job.episodicMemoryOptIn === true && env.ZURI_MSP_EPISODIC_MEMORY_ENABLED === 'true'
    const route = memoryOptIn ? memoryRoute(job) : null
    let selectedThreadMemory = memoryOptIn ? threadMemory : null
    let selectedEpisodicMemory = null
    let runtimePorts = null
    let businessKnowledge
    let model
    try {
      if (memoryOptIn && !selectedThreadMemory) {
        runtimePorts = await runtimeFactory(env,
          { ...runtimeDependencies, queryFn, bindingRequired: false })
        selectedThreadMemory = runtimePorts?.threadMemory
        selectedEpisodicMemory = runtimePorts?.episodicMemory ?? null
        if (!selectedThreadMemory) throw failure('LINE_MEMORY_NOT_CONFIGURED')
      }
      if (memoryOptIn && typeof selectedThreadMemory.withInjectionReceipt !== 'function') {
        throw failure('LINE_MEMORY_INJECTION_RECEIPT_UNAVAILABLE')
      }
      // @req FR-265 — there was a branch here on `job.modelAccess`. Its
      // `LOCAL_ONLY` side did not call a local model: it built
      // `createDeterministicBusinessModel()`, a canned answerer, and replied to
      // the customer with it. ADR-100 D3 retires the policy and with it the
      // branch, so every answered turn resolves a real provider under the
      // Business's own key (FR-266) — or fails closed and says so.
      // Direct native ingress has already authenticated account scope; opting out
      // of the legacy Edge binding does not weaken the provider/Vault gates.
      {
        runtimePorts = runtimePorts ?? await runtimeFactory(env, { ...runtimeDependencies, queryFn, bindingRequired: false })
        const ports = runtimePorts
        if (!ports?.businessKnowledge || typeof ports.resolveModel !== 'function') {
          throw failure('LINE_BUSINESS_AGENT_NOT_CONFIGURED')
        }
        businessKnowledge = ports.businessKnowledge
        model = await ports.resolveModel({
          tenantId,
          businessId,
          ...(mainDevLocalOllama ? { accountId: job.accountId } : {}),
        })
        if (memoryOptIn && !selectedThreadMemory) selectedThreadMemory = ports.threadMemory
        if (episodicMemoryOptIn) selectedEpisodicMemory = ports.episodicMemory ?? null
      }

      let episodicMemoryEntries = []
      let episodicAuthorized = false
      if (episodicMemoryOptIn) {
        const recalled = await readAuthorizedLineEpisodicMemory({ job, memoryPort: selectedEpisodicMemory,
          memoryStateReader, authorizationResolver, scopeResolver, env })
        episodicAuthorized = recalled.allowed
        episodicMemoryEntries = recalled.entries
      }

      // @req FR-235 — a missing/unrecognised mode always resolves to
      // BUSINESS_KNOWLEDGE (fail closed to today's behaviour, never to a
      // corpus read). `job.account`'s scope was already asserted to match
      // `tenantId`/`businessId` above, or is absent — this reads no other
      // field from it, and the corpus reader is built from the job's own
      // verified scope, never from the account row's identity.
      const groundingMode = mainDevLocalOllama
        ? 'BUSINESS_KNOWLEDGE'
        : resolveLineKnowledgeGroundingMode(job.account?.knowledgeGrounding)
      // @req FR-277 — kept unwrapped, before the mode-gated wrap below, so a
      // shadow-compare generation (fired later, only for an account with
      // `knowledgeGroundingShadow: true`) can build the PAIRED mode's own
      // reader from the same plain business-knowledge reader the primary path
      // resolved — never the grounding wrapper, which is already bound to
      // `groundingMode`, not its pair.
      const rawBusinessKnowledgeReader = businessKnowledge
      if (!mainDevLocalOllama && groundingMode !== 'BUSINESS_KNOWLEDGE') {
        const corpusReader = createCorpusKnowledgeReader({
          tenantId, businessId,
          ...lineKnowledgeGroundingBudgetFromEnv(env),
        })
        businessKnowledge = createLineGroundingReader({
          mode: groundingMode, corpusReader, businessKnowledgeReader: businessKnowledge, trace,
          budgetMs: lineKnowledgeGroundingBudgetFromEnv(env).budgetMs,
        })
      }

      // Fetch once and compose every cohort, including public Business evidence.
      // Private memory authority gates only MSP slices, never public knowledge.
      const tracedKnowledge = trace && groundingMode === 'BUSINESS_KNOWLEDGE' ? { query: async input => {
        const evidence = await businessKnowledge.query(input)
        await trace.recordEvidence(input, evidence)
        return evidence
      } } : businessKnowledge
      let memoryContext = null
      let memoryInbound = null
      let preparedMemory = null
      let composed
      let injectedPacket = null
      if (memoryOptIn) {
        preparedMemory = await prepareLineMemoryContext({ job, route, question,
          threadMemory: selectedThreadMemory,
          projectionReceiptWriter, contextAssembler, memoryStateReader, env })
        memoryContext = preparedMemory.memoryContext
        memoryInbound = preparedMemory.memoryInbound
      }
      // Keep the runtime and legacy memory turn's external read order aligned:
      // Core completes the authorized MSP read before it queries public GKS
      // evidence. This also avoids a corpus read when MSP fails closed.
      const groundingEvidence = await tracedKnowledge.query({ tenantId, businessId, ...selectRegisteredQuery(question) })
      const { knowledgeSliceInputs, knowledgeRecordById } = lineKnowledgeSliceInputs(groundingEvidence?.records)
      if (memoryOptIn) {
        const memoryPacket = composeLineMemoryPacket({ memoryContext, route,
          authorizedForMemory: preparedMemory.authorizedForMemory,
          episodicEntries: episodicMemoryEntries, episodicAuthorized,
          groundingMode, knowledgeSliceInputs })
        composed = memoryPacket.composed
        injectedPacket = memoryPacket.injectedPacket
        trace?.recordThreadMemory?.({ contextPacket: injectedPacket, thread: memoryContext.thread,
          exchangeId: memoryInbound.message.exchangeId, inboundMessageId: memoryInbound.message.messageId })
      } else {
        const packet = composeLineEpisodicPacket({ entries: episodicAuthorized ? episodicMemoryEntries : [],
          route: episodicAuthorized ? memoryRoute(job) : null, knowledgeSliceInputs })
        composed = packet.composed
        injectedPacket = packet.injectedPacket
      }
      const contextReceipt = composed.receipt
      const boundedKnowledge = { query: async () => ({
        // Only composed, budgeted evidence reaches the model. Corpus retrieval
        // references and mode metadata remain in the GKS trace, outside the prompt.
        records: composedKnowledgeRecords(composed, knowledgeRecordById),
      }) }
      let receiptRecorded = false
      const recordContextReceiptBeforeModel = async () => {
        if (receiptRecorded || typeof trace?.recordContextReceipt !== 'function') return
        await trace.recordContextReceipt(contextReceipt)
        receiptRecorded = true
      }
      // `injectedPacket` — never `memoryContext.threadMemory` — is what MSP's
      // injection receipt hashes and what the model actually receives below;
      // a packet the composer denied or fully trimmed is `null` here, so
      // `withInjectionReceipt` correctly skips wrapping (no injection to
      // attest) and the model gets no memory content at all.
      const episodicIncluded = Array.isArray(injectedPacket?.memory?.episodic) && injectedPacket.memory.episodic.length > 0
      let invocationModel = recordContextReceiptBeforeModel || episodicIncluded
        ? { ...model, generate: async input => {
          if (recordContextReceiptBeforeModel) await recordContextReceiptBeforeModel()
          if (episodicIncluded) await assertLineEpisodicMemoryJobLive({ job, memoryStateReader,
            authorizationResolver, scopeResolver, env })
          return model.generate(input)
        } }
        : model
      invocationModel = memoryOptIn && typeof selectedThreadMemory.withInjectionReceipt === 'function'
        ? selectedThreadMemory.withInjectionReceipt({ model: invocationModel, contextPacket: injectedPacket,
          threadId: memoryContext.thread.threadId, exchangeId: memoryInbound.message.exchangeId,
          authorization: { authContext: memoryContext.authContext }, requesterId: memoryContext.identity.principalId,
          contextReceiptId: contextReceipt?.receiptId ?? null })
        : invocationModel
      if (memoryOptIn && (!invocationModel || typeof invocationModel.generate !== 'function')) {
        throw failure('LINE_MEMORY_INJECTION_RECEIPT_UNAVAILABLE')
      }
      if (memoryOptIn) await assertMemoryJobLive(job, memoryStateReader, env)
      const result = await answerBusinessQuestion({ tenantId, businessId, question }, {
        knowledge: boundedKnowledge, model: invocationModel, trace, contextReceipt,
        contextPacket: memoryOptIn || episodicAuthorized ? injectedPacket : null,
      })
      // Grounding may choose a deterministic fallback after a provider failure;
      // a failed journal write must never be mistaken for that safe fallback.
      trace?.assertHealthy()
      if (typeof result?.text !== 'string' || !result.text.trim()) throw failure('LINE_ANSWER_EMPTY')
      if (mainDevLocalOllama && (
        result.provider?.status === 'fallback'
        || result.provider?.status === 'rejected-output'
        || (result.provider?.status !== 'not-called'
          && (result.provider?.provider !== 'ollama' || result.provider?.status !== 'ok'))
      )) {
        throw failure('MAIN_DEV_LOCAL_OLLAMA_OUTPUT_REJECTED')
      }
      // LINE's text message limit is 5000 UTF-16 code units. Never leave a split
      // surrogate at the boundary when an evidence value contains emoji.
      const answerText = boundLineText(result.text)
      // @req FR-277 — shadow-compare (ADR-090 Phase 3, TASK-ZAI-095). Started,
      // never awaited: the customer-facing answer above is already final, and
      // the worker's own reply/push dispatch happens in the caller after this
      // function returns — awaiting here would add the paired mode's own
      // generation latency (and a second model call) to every turn on a
      // shadow-enabled account, exactly what this harness must not do. A
      // rejection can only come from a bug in this call's own argument
      // construction (the function itself never rejects); `.catch` is a
      // second line of defence, not the primary safety mechanism.
      if (!mainDevLocalOllama && job.account?.knowledgeGroundingShadow === true) {
        void runLineGroundingShadowCompare({
          job, primaryMode: groundingMode, primaryAnswerText: answerText,
          tenantId, businessId, question, model,
          businessKnowledgeReader: rawBusinessKnowledgeReader, env,
        }).catch(() => {})
      }
      if (memoryOptIn) {
        await appendLineMemoryAnswer({ job, route, threadMemory: selectedThreadMemory,
          memory: lineMemoryHandle(memoryContext, memoryInbound), answerText,
          authorizationResolver, projectionReceiptWriter, memoryStateReader, env })
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
