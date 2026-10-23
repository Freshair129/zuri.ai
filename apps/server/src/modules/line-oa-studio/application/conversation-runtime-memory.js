import { createHash, randomUUID } from 'node:crypto'
import { appendTraceEvent } from '@/modules/agent/execution-trace'
import { resolveAgentAuthorization } from '@/modules/agent/auth-context'
import { assembleAgentContext } from '@/modules/agent/context'
import { conversationRuntimeServesGroundingMode, resolveLineKnowledgeGroundingMode } from '@/modules/agent/line-knowledge-grounding'
import {
  appendLineMemoryAnswer, assertLineEpisodicMemoryJobLive, assertMemoryJobLive, lineMemoryHandle, memoryRoute,
  memoryServerScope, mspPacketSlices,
  prepareLineMemoryContext,
} from '@/modules/agent/server-line-answer'
import { createServerLineThreadMemory } from './server-line-runtime'
import { recordMemoryProjectionReceipt } from './line-memory-projection'
import { assertRuntimeTraceEvent, runtimeOutOfHoursReply } from './line-conversation-jobs'
import {
  coreMemoryKey, isMemoryTurn, loadMemoryReceipt, MEMORY_RECEIPT_KINDS, memoryOperationIds, memoryReceiptKey, memoryTextSha256,
} from './runtime-memory-receipts'

// @req FR-149, FR-171 — Core side of the Conversation Runtime v1 `memory` operation
//   (ADR-106 D2 Memory/Knowledge `read`, `append`, `receipt`). Core stays the only MSP
//   caller: it runs the same three memory phases the legacy Server worker runs
//   (`server-line-answer.js`), under the same job/erasure/policy fences, and keeps a
//   durable per-job receipt for each so a reclaimed runtime replays instead of repeating.
// @spec ADR-106 D2-D4, SDD-110, ADR-061, ADR-070, SEC-001 — the runtime names only the
//   operation and its stable id; tenant, business, account, identity, thread and route
//   all come from the claimed, persisted job and Core's own MSP receipts.
// @req FR-149 — PENDING memory mode (W11): a job Core admitted for an unverified LINE
//   sender (`senderIdentityState: 'UNVERIFIED'`, set by Core's claim check from the
//   job's CHANNEL_IDENTITY_ADMITTED record) runs the same phases with the identity
//   pinned unverified: no private recall, no injection receipt, the inbound message
//   appended with PENDING assurance and no person. The read receipt records the mode,
//   and a replay or append under the other mode is refused.
// @tested tests/integration/conversation-runtime-memory.test.js,
//   tests/integration/conversation-runtime-unverified-memory.test.js

export const MEMORY_OPERATIONS = Object.freeze(['read', 'append', 'receipt'])
export const MEMORY_INJECTION_STATES = Object.freeze(['RESOLVED', 'SUBMITTED', 'COMPLETED', 'FAILED'])
export const MAX_MEMORY_PACKET_BYTES = 32 * 1024
export const MAX_MEMORY_EVIDENCE_BYTES = 32 * 1024
// Evidence plus packet, leaving room under the 60 KiB `memory` result bound for the envelope.
const MAX_MEMORY_RESULT_BYTES = 56 * 1024
const MAX_RUNTIME_SOURCE_SLICES = 64

export { memoryOperationIds }

const error = (code, status = 400) => Object.assign(new Error(code), { code, status })

const runtimeSourcesKey = job => coreMemoryKey(job.id, `runtime-context-sources:${job.executionId}`, 'MEMORY_THREAD_READ')
const runtimeContextBindingKey = job => coreMemoryKey(job.id, `runtime-context-binding:${job.executionId}`, 'MEMORY_THREAD_READ')
const sha256Text = value => createHash('sha256').update(value, 'utf8').digest('hex')
const sourceText = value => typeof value === 'string' ? value : JSON.stringify(value)

function sourceSlicesFromPacket(packet) {
  const memory = packet?.memory ?? {}
  const list = key => Array.isArray(memory[key]) ? memory[key] : []
  const slice = (id, value) => ({ id, text: sourceText(value), source: 'API-011' })
  return [
    ...list('participants').map((item, index) => slice(`participant:${item?.principalId ?? item?.id ?? index}`, item)),
    ...list('protectedMemory').map((item, index) => slice(`protected:${item?.recordId ?? index}`, item)),
    ...[...list('recentExchanges')].reverse().map((item, index) => slice(`exchange:${item?.exchangeId ?? index}`, item)),
    ...list('summaries').map((item, index) => slice(`summary:${item?.summaryId ?? index}`, item)),
    ...list('episodic').map((item, index) => slice(`episodic:${item?.id ?? item?.reference?.memoryId ?? index}`, item)),
  ]
}

function validateSourceManifest(payload, job) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).sort().join(',') !== 'executionId,slices,source'
    || payload.source !== 'API-010' || payload.executionId !== job.executionId
    || !Array.isArray(payload.slices) || payload.slices.length > MAX_RUNTIME_SOURCE_SLICES) {
    throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
  }
  const sources = new Map()
  let totalBytes = 0
  for (const item of payload.slices) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).sort().join(',') !== 'byteLength,hash,id'
      || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 128
      || !Number.isInteger(item.byteLength) || item.byteLength < 0 || item.byteLength > MAX_MEMORY_PACKET_BYTES
      || typeof item.hash !== 'string' || !/^[0-9a-f]{64}$/.test(item.hash) || sources.has(item.id)) {
      throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
    }
    totalBytes += item.byteLength
    if (totalBytes > MAX_MEMORY_PACKET_BYTES) throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
    sources.set(item.id, { byteLength: item.byteLength, hash: item.hash, source: 'API-010' })
  }
  return sources
}

async function loadRuntimeSourceManifest(db, job) {
  if (typeof job.executionId !== 'string' || !job.executionId) throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
  const rows = await db.agentTraceEvent.findMany({ where: { tenantId: job.tenantId, businessId: job.businessId,
    turnId: job.id, executionId: job.executionId, kind: 'MEMORY_THREAD_READ', idempotencyKey: runtimeSourcesKey(job) },
  select: { payloadJson: true } })
  if (rows.length !== 1) throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
  let payload
  try { payload = JSON.parse(rows[0].payloadJson) } catch { throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409) }
  return validateSourceManifest(payload, job)
}

function contextBindingPayload(job, receipt, packet) {
  return { source: 'CONTEXT_RECEIPT_BINDING', executionId: job.executionId, receiptId: receipt.receiptId,
    receiptHash: receipt.hash, packetHash: packet === null ? null : createHash('sha256').update(JSON.stringify(packet)).digest('hex'),
    mspRefs: [...receipt.refs.msp] }
}

function validateContextBindingPayload(payload, job) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).sort().join(',') !== 'executionId,mspRefs,packetHash,receiptHash,receiptId,source'
    || payload.source !== 'CONTEXT_RECEIPT_BINDING' || payload.executionId !== job.executionId
    || typeof payload.receiptId !== 'string' || !/^ctxrcpt_[0-9a-f-]{36}$/.test(payload.receiptId)
    || typeof payload.receiptHash !== 'string' || !/^[0-9a-f]{64}$/.test(payload.receiptHash)
    || (payload.packetHash !== null && (typeof payload.packetHash !== 'string' || !/^[0-9a-f]{64}$/.test(payload.packetHash)))
    || !Array.isArray(payload.mspRefs) || payload.mspRefs.length > MAX_RUNTIME_SOURCE_SLICES
    || payload.mspRefs.some(id => typeof id !== 'string' || !id.trim() || id.length > 128)
    || new Set(payload.mspRefs).size !== payload.mspRefs.length
    || (payload.packetHash === null) !== (payload.mspRefs.length === 0)) throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
  return payload
}

async function loadContextBinding(db, job) {
  if (typeof job.executionId !== 'string' || !job.executionId) throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
  const rows = await db.agentTraceEvent.findMany({ where: { tenantId: job.tenantId, businessId: job.businessId,
    turnId: job.id, executionId: job.executionId, kind: 'MEMORY_THREAD_READ', idempotencyKey: runtimeContextBindingKey(job) },
  select: { payloadJson: true } })
  if (rows.length !== 1) throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
  let payload
  try { payload = JSON.parse(rows[0].payloadJson) } catch { throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409) }
  return validateContextBindingPayload(payload, job)
}

async function loadCanonicalContextReceipt(db, job, stored, contextReceiptId, contextReceiptHash) {
  if (contextReceiptId !== stored.contextReceiptId || typeof contextReceiptHash !== 'string'
    || !/^[0-9a-f]{64}$/.test(contextReceiptHash) || typeof job.executionId !== 'string' || !job.executionId) {
    throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
  }
  const rows = await db.agentTraceEvent.findMany({ where: { tenantId: job.tenantId, businessId: job.businessId,
    turnId: job.id, executionId: job.executionId, kind: 'CONTEXT_RECEIPT' }, select: { payloadJson: true } })
  if (rows.length !== 1) throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
  let receipt
  try { receipt = JSON.parse(rows[0].payloadJson) } catch { throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409) }
  try { assertRuntimeTraceEvent({ jobId: job.id, executionId: job.executionId }, { kind: 'CONTEXT_RECEIPT', payload: receipt }) }
  catch { throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409) }
  if (receipt.receiptId !== stored.contextReceiptId || receipt.receiptId !== contextReceiptId
    || receipt.hash !== contextReceiptHash) throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
  return receipt
}

function sameJson(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((item, index) => sameJson(item, right[index]))
  }
  if (left && typeof left === 'object' || right && typeof right === 'object') {
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index]
      && sameJson(left[key], right[key]))
  }
  return Object.is(left, right)
}

function expectedThreadPacket(packet, receipt) {
  const sources = sourceSlicesFromPacket(packet)
  const included = receipt.refs.msp
  const includedSet = new Set(included)
  const expectedIds = sources.filter(item => includedSet.has(item.id)).map(item => item.id)
  if (!sameJson(expectedIds, included)) throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
  const byPrefix = prefix => sources.filter(item => includedSet.has(item.id) && item.id.startsWith(prefix)).map(item => {
    const key = item.id.slice(prefix.length)
    const collection = prefix === 'participant:' ? 'participants'
      : prefix === 'protected:' ? 'protectedMemory'
        : prefix === 'exchange:' ? 'recentExchanges'
          : prefix === 'summary:' ? 'summaries' : 'episodic'
    const values = Array.isArray(packet?.memory?.[collection]) ? packet.memory[collection] : []
    return values.find((value, index) => {
      const id = prefix === 'participant:' ? value?.principalId ?? value?.id ?? index
        : prefix === 'protected:' ? value?.recordId ?? index
          : prefix === 'exchange:' ? value?.exchangeId ?? index
            : prefix === 'summary:' ? value?.summaryId ?? index
              : value?.id ?? value?.reference?.memoryId ?? index
      return String(id) === key
    })
  })
  const participants = byPrefix('participant:')
  const protectedMemory = byPrefix('protected:')
  const recentExchanges = byPrefix('exchange:').reverse()
  const summaries = byPrefix('summary:')
  const episodic = byPrefix('episodic:')
  const omittedRanges = [...(packet.manifest?.omittedRanges ?? [])]
  const droppedMsp = receipt.dropped.filter(item => item.source === 'MSP')
  for (const item of droppedMsp) {
    const prefix = ['participant:', 'protected:', 'exchange:', 'summary:', 'episodic:'].find(value => item.id.startsWith(value))
    const id = prefix ? item.id.slice(prefix.length) : item.id
    const field = prefix === 'exchange:' ? 'exchangeId'
      : prefix === 'summary:' ? 'summaryId'
        : prefix === 'protected:' ? 'protectedRecordId'
          : prefix === 'participant:' ? 'participantId' : 'episodicMemoryId'
    omittedRanges.push({ [field]: id, reason: item.reason })
  }
  const truncated = droppedMsp.length > 0
  const expected = { ...packet, knowledge: null,
    memory: { ...packet.memory, participants, recentExchanges, summaries, protectedMemory,
      episodic },
  }
  if (packet.manifest) expected.manifest = {
      ...packet.manifest,
      effectiveRecentExchangeCount: recentExchanges.length,
      summaryCount: summaries.length,
      protectedRecordCount: protectedMemory.length,
      omittedRanges,
      coverageGap: Boolean(packet.manifest.coverageGap) || truncated,
      budget: packet.manifest.budget
        ? { ...packet.manifest.budget, truncated: Boolean(packet.manifest.budget.truncated) || truncated }
        : packet.manifest.budget,
    }
  return expected
}

async function validateInjectionPacket(db, job, stored, receipt, packet) {
  if (packet === null) {
    if (receipt.refs.msp.length !== 0) throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
  } else if (!packet || typeof packet !== 'object' || Array.isArray(packet) || packet.policyDecision !== 'ALLOW'
    || Buffer.byteLength(JSON.stringify(packet), 'utf8') > MAX_MEMORY_PACKET_BYTES || receipt.refs.msp.length === 0) {
    throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
  }
  const api010 = await loadRuntimeSourceManifest(db, job)
  const api011Packet = typeof stored?.contextPacketJson === 'string' ? JSON.parse(stored.contextPacketJson) : null
  const api011 = sourceSlicesFromPacket(api011Packet)
  const sources = new Map(api010)
  for (const item of api011) {
    if (sources.has(item.id)) throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
    const byteLength = Buffer.byteLength(item.text, 'utf8')
    if (byteLength > MAX_MEMORY_PACKET_BYTES) throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
    sources.set(item.id, { byteLength, hash: sha256Text(item.text), source: 'API-011' })
  }
  const mspDropped = receipt.dropped.filter(item => item.source === 'MSP').map(item => item.id)
  const allReferenced = [...receipt.refs.msp, ...mspDropped]
  if (new Set(allReferenced).size !== allReferenced.length || allReferenced.length !== sources.size
    || [...sources.keys()].some(id => !allReferenced.includes(id))) {
    throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
  }

  if (packet === null) return

  if (Object.keys(packet).sort().join(',') === 'policyDecision,sourceSegments,text') {
    if (typeof packet.text !== 'string' || !Array.isArray(packet.sourceSegments)
      || packet.sourceSegments.length !== receipt.refs.msp.length
      || !sameJson(packet.sourceSegments.map(item => item?.id), receipt.refs.msp)) {
      throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
    }
    const bytes = Buffer.from(packet.text, 'utf8')
    let cursor = 0
    for (let index = 0; index < packet.sourceSegments.length; index += 1) {
      const segment = packet.sourceSegments[index]
      if (!segment || typeof segment !== 'object' || Array.isArray(segment)
        || Object.keys(segment).sort().join(',') !== 'byteLength,id,startByte'
        || !Number.isInteger(segment.startByte) || !Number.isInteger(segment.byteLength)
        || segment.startByte !== cursor || segment.byteLength < 0) throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
      const end = segment.startByte + segment.byteLength
      const source = sources.get(segment.id)
      if (!source || end > bytes.byteLength) throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
      const span = bytes.subarray(segment.startByte, end)
      const spanText = span.toString('utf8')
      if (span.byteLength !== source.byteLength || sha256Text(spanText) !== source.hash
        || !Buffer.from(spanText, 'utf8').equals(span)) throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
      cursor = end
      if (index < packet.sourceSegments.length - 1) {
        if (bytes[cursor] !== 0x0a) throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
        cursor += 1
      }
    }
    if (cursor !== bytes.byteLength) throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
    return
  }

  if (!api011Packet) throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
  const expectedPacket = JSON.parse(JSON.stringify(expectedThreadPacket(api011Packet, receipt)))
  if (!sameJson(packet, expectedPacket)) {
    throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
  }
}

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
        // Legacy never grants a private write to the LINE agent (memoryServerScope).
        writePrivate: false,
      },
    },
  }
}

/**
 * @req FR-149 — when Core drops low-ranked evidence so a runtime answer fits its
 * bounds (`prepare`: fitPreparedTurn; `memory read`: the evidence and result
 * bounds), the drop is traced: which phase, how many records there were and how
 * many were kept. Counts only, never a record, a citation or any text. Best
 * effort: a diagnostic trace never fails the turn it describes.
 */
export async function traceEvidenceTrimmed(db, job, { phase, recordsBefore, recordsKept, now = () => new Date() }) {
  if (!Number.isInteger(recordsBefore) || !Number.isInteger(recordsKept) || recordsKept >= recordsBefore) return false
  try {
    await appendTraceEvent(db, { scope: { tenantId: job.tenantId, businessId: job.businessId },
      turnId: job.id, executionId: job.executionId ?? null, kind: 'EVIDENCE_TRIMMED',
      idempotencyKey: `${job.id}:core:evidence-trimmed:${phase}:${job.executionId ?? 'none'}:${recordsBefore}:${recordsKept}`,
      payload: { phase, recordsBefore, recordsKept, recordsDropped: recordsBefore - recordsKept },
      occurredAt: new Date(now().getTime()) })
    return true
  } catch { return false }
}

export function createConversationRuntimeMemory({ db, env, now = () => new Date(), ownedClaim, modelResolver, groundingQuery,
  threadMemoryFactory = null, contextAssembler = assembleAgentContext,
  authorizationResolver = resolveAgentAuthorization, episodicMemoryStateReader = null } = {}) {
  if (typeof ownedClaim !== 'function') throw new Error('CONVERSATION_RUNTIME_MEMORY_CLAIM_REQUIRED')
  if (typeof modelResolver !== 'function') throw new Error('CONVERSATION_RUNTIME_MEMORY_MODEL_REQUIRED')
  if (typeof groundingQuery !== 'function') throw new Error('CONVERSATION_RUNTIME_MEMORY_GROUNDING_REQUIRED')

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
      account: { select: { serverEnabled: true, transportMode: true, status: true, transportEpoch: true,
        memoryProjectId: true } } },
  })

  const loadReceipt = (job, name) => loadMemoryReceipt(db, job, name)
  // The route the persisted job names, fingerprinted into the read receipt: a
  // receipt is only ever used for the route it was read for.
  const routeKey = route => createHash('sha256').update(JSON.stringify([route.tenantId, route.businessId,
    route.channelAccountId, route.externalRoomRef, route.audienceKind])).digest('hex')

  const pendingMode = job => job.senderIdentityState === 'UNVERIFIED'

  // @req FR-149 — PENDING mode binds every principal the turn resolves to the one
  // Core's admission record names (#600 review): a sender who links to another
  // Person mid-turn must not have that Person named as the speaker or requester of
  // a PENDING append. The same guard refuses, before any MSP append, a context or
  // authorization that claims a verified identity or private memory.
  const pendingPrincipal = job => {
    if (typeof job.senderPrincipalId !== 'string' || !job.senderPrincipalId) throw error('LINE_MEMORY_SCOPE_MISMATCH', 409)
    return job.senderPrincipalId
  }
  const assemblerFor = job => !pendingMode(job) ? contextAssembler : async input => {
    const context = await contextAssembler(input)
    if (context?.identity?.principalId !== pendingPrincipal(job) || context.identity.verified !== false
      || context.policy?.privateMemoryAllowed === true) throw error('LINE_MEMORY_SCOPE_MISMATCH', 409)
    return context
  }
  const authorizationFor = job => !pendingMode(job) ? authorizationResolver : async input => {
    const current = await authorizationResolver(input)
    if (current?.authContext?.actor?.principalId !== pendingPrincipal(job) || current.policy?.privateMemoryAllowed === true) {
      throw error('LINE_MEMORY_SCOPE_MISMATCH', 409)
    }
    return current
  }

  async function storedRead(job, route) {
    const stored = await loadReceipt(job, 'read')
    if (stored && stored.routeKey !== routeKey(route)) throw error('LINE_MEMORY_SCOPE_MISMATCH', 409)
    // A receipt is used only under the mode it was read in.
    if (stored && (stored.identityAssurance === 'PENDING') !== pendingMode(job)) throw error('LINE_MEMORY_SCOPE_MISMATCH', 409)
    return stored
  }

  /** Core's own authorization for this job's LINE subject, never a stored or runtime value. */
  async function currentAuthorization(job, route) {
    const current = await authorizationFor(job)({ tenantId: job.tenantId, businessId: job.businessId,
      lineUserId: job.sourceUserId, threadId: route.externalRoomRef, eventId: job.eventId,
      serverScope: memoryServerScope(job, route) })
    if (current?.authContext?.scope?.tenantId !== job.tenantId || current.authContext.scope.businessId !== job.businessId
      || typeof current.authContext.actor?.principalId !== 'string') throw error('LINE_MEMORY_SCOPE_MISMATCH', 409)
    return current
  }

  function samePrincipal(current, stored) {
    if (current.authContext.actor.principalId !== stored.principalId) throw error('LINE_MEMORY_SCOPE_MISMATCH', 409)
  }

  async function saveReceipt(job, name, payload) {
    await appendTraceEvent(db, { scope: { tenantId: job.tenantId, businessId: job.businessId },
      turnId: job.id, executionId: job.executionId ?? null, kind: MEMORY_RECEIPT_KINDS[name],
      idempotencyKey: memoryReceiptKey(job.id, name), payload, occurredAt: new Date(now().getTime()) })
  }

  async function traceNote(job, kind, key, payload) {
    await appendTraceEvent(db, { scope: { tenantId: job.tenantId, businessId: job.businessId },
      turnId: job.id, executionId: job.executionId ?? null, kind,
      idempotencyKey: coreMemoryKey(job.id, key, kind), payload, occurredAt: new Date(now().getTime()) })
  }

  /**
   * A memory operation exists only for an opted-in, non-command turn in a
   * grounding mode Core serves. The route — thread kind, audience, room and
   * channel — is `memoryRoute(job)`, from the persisted job alone: a DIRECT chat's
   * own thread, or the one MSP thread of the group or room the job was admitted for.
   */
  function memoryTurn(job) {
    if (job.memorySyncOptIn !== true) throw error('MEMORY_NOT_ENABLED', 409)
    if (!isMemoryTurn(job)) throw error('MEMORY_NOT_APPLICABLE', 409)
    if (env.ZURI_MSP_THREAD_MEMORY_ENABLED !== 'true') throw error('MEMORY_NOT_ENABLED', 409)
    // @req FR-244 — an out-of-hours turn never touches memory, as on the Server path
    // (#600 review, MEDIUM): every memory operation is refused for it.
    if (runtimeOutOfHoursReply(job) !== null) throw error('MEMORY_NOT_APPLICABLE', 409)
    if (!conversationRuntimeServesGroundingMode(job.account?.knowledgeGrounding)) {
      throw error('RUNTIME_GROUNDING_MODE_NOT_SUPPORTED', 409)
    }
    return memoryRoute(job)
  }

  async function assertPolicyStillAllows(job, route, stored, authorization = null) {
    const current = authorization ?? await currentAuthorization(job, route)
    samePrincipal(current, stored)
    if (!current?.policy?.privateMemoryAllowed || current.policy?.mspAuthorization?.read !== true) {
      throw error('LINE_MEMORY_POLICY_REVOKED', 409)
    }
    return current
  }

  function readResult(receipt) {
    return { status: 'COMPLETED', operationId: receipt.operationId, result: {
      contextPacket: receipt.contextPacketJson ? JSON.parse(receipt.contextPacketJson) : null,
      // @req FR-235 — a corpus-mode turn's evidence is the composer-included
      // knowledge, which replaces what `prepare` handed out (it reads none for it).
      ...(typeof receipt.evidenceJson === 'string' ? { evidence: JSON.parse(receipt.evidenceJson) } : {}),
      receipt: { contextReceiptId: receipt.contextReceiptId ?? null, policyDecision: receipt.policyDecision } } }
  }

  function appendResult(receipt, duplicate) {
    return { status: 'COMPLETED', operationId: receipt.operationId,
      result: { receipt: { textSha256: receipt.textSha256, duplicate } } }
  }

  async function read(ref, { deadlineAt } = {}) {
    const startedAt = now().getTime()
    const { job } = await ownedClaim(ref)
    const route = memoryTurn(job)
    const operationId = memoryOperationIds(job.id).read
    const stored = await storedRead(job, route)
    if (stored) {
      // A reclaimed runtime replays the context this job already read, so MSP is
      // not asked twice and the injection receipt keeps one packet identity. The
      // job fence and, for private context, the current policy are rechecked first:
      // an erasure, revocation or withdrawal since the first read wins.
      await assertMemoryJobLive(job, memoryStateReader, env)
      if (stored.privateMemoryAllowed) await assertPolicyStillAllows(job, route, stored)
      return readResult(stored)
    }
    const port = threadMemory()
    const { memoryContext, memoryInbound, authorizedForMemory } = await prepareLineMemoryContext({ job, route,
      question: job.inbound.body, threadMemory: port,
      projectionReceiptWriter: input => recordMemoryProjectionReceipt(db, input),
      contextAssembler: assemblerFor(job), memoryStateReader, env })
    // @req FR-235 — under a corpus mode, the legacy worker reads this turn's
    // knowledge here, after the MSP phases, and composes it with the thread in ONE
    // call under ONE budget. The read is Core's `prepare` read, with W2's budget
    // clamp counting the time this operation has already spent.
    const groundingMode = resolveLineKnowledgeGroundingMode(job.account?.knowledgeGrounding)
    let knowledgeRecords = null
    let recordsBefore = 0
    if (groundingMode !== 'BUSINESS_KNOWLEDGE') {
      const evidence = await groundingQuery(job, { deadlineAt, startedAt })
      const records = Array.isArray(evidence?.records) ? evidence.records : []
      recordsBefore = records.length
      knowledgeRecords = records.slice(0, 64)
    }
    // Core returns the authorized API-011 packet and bounded evidence. Runtime
    // composes them once, with API-010 slices, immediately before the provider;
    // that one receipt therefore names exactly the bytes the model receives.
    // The graph-relation `knowledge` field has no composer citation contract and
    // is intentionally removed just as the Server path does.
    const sourcePacket = authorizedForMemory && memoryContext.threadMemory?.policyDecision === 'ALLOW'
      ? { ...memoryContext.threadMemory, knowledge: null } : null
    const injectedPacket = sourcePacket && mspPacketSlices(sourcePacket).length > 0 ? sourcePacket : null
    const packetBytes = injectedPacket ? Buffer.byteLength(JSON.stringify(injectedPacket), 'utf8') : 0
    const fits = records => {
      const bytes = Buffer.byteLength(JSON.stringify({ records }), 'utf8')
      return bytes <= MAX_MEMORY_EVIDENCE_BYTES && bytes + packetBytes <= MAX_MEMORY_RESULT_BYTES
    }
    while (knowledgeRecords && knowledgeRecords.length && !fits(knowledgeRecords)) knowledgeRecords.pop()
    const evidenceJson = knowledgeRecords ? JSON.stringify({ records: knowledgeRecords }) : null
    // The receipt identity is reserved with the durable read so a reclaim reuses
    // the same ContextReceipt id. It is not a ContextReceipt event: the Runtime
    // writes the one canonical receipt only immediately before a provider attempt.
    const contextPacketJson = injectedPacket ? JSON.stringify(injectedPacket) : null
    if (contextPacketJson && Buffer.byteLength(contextPacketJson, 'utf8') > MAX_MEMORY_PACKET_BYTES) {
      throw error('MEMORY_CONTEXT_TOO_LARGE', 413)
    }
    const handle = lineMemoryHandle(memoryContext, memoryInbound)
    // PENDING mode fails closed: whatever MSP or the authorization answered, a
    // pinned-unverified turn never carries private memory or a context packet.
    if (pendingMode(job) && (handle.privateMemoryAllowed || authorizedForMemory || contextPacketJson
      || memoryContext.identity?.verified !== false)) throw error('LINE_MEMORY_SCOPE_MISMATCH', 409)
    const receipt = { operationId, routeKey: routeKey(route), ...handle,
      policyDecision: memoryContext.threadMemory.policyDecision,
      contextReceiptId: `ctxrcpt_${randomUUID()}`, contextPacketJson,
      ...(evidenceJson ? { evidenceJson } : {}),
      ...(pendingMode(job) ? { identityAssurance: 'PENDING' } : {}) }
    await assertMemoryJobLive(job, memoryStateReader, env)
    await saveReceipt(job, 'read', receipt)
    if (knowledgeRecords) {
      await traceEvidenceTrimmed(db, job, { phase: 'memory-read', recordsBefore,
        recordsKept: knowledgeRecords.length, now })
    }
    return readResult(receipt)
  }

  async function append(ref, text) {
    const { job } = await ownedClaim(ref)
    const route = memoryTurn(job)
    const stored = await storedRead(job, route)
    if (!stored) throw error('MEMORY_READ_REQUIRED', 409)
    const textSha256 = memoryTextSha256(text)
    const prior = await loadReceipt(job, 'append')
    if (prior) {
      if (prior.textSha256 !== textSha256) throw error('MEMORY_APPEND_CONFLICT', 409)
      return appendResult(prior, true)
    }
    samePrincipal(await currentAuthorization(job, route), stored)
    const port = threadMemory()
    port.bindTrustedRoute(stored.threadId, route)
    // A crash after MSP accepted this append but before the receipt below is
    // saved repeats the call on reclaim with the same source event id, which MSP
    // deduplicates exactly as it does for a restarted legacy worker.
    const agent = await appendLineMemoryAnswer({ job, route, threadMemory: port, memory: stored,
      answerText: text, authorizationResolver: authorizationFor(job),
      projectionReceiptWriter: input => recordMemoryProjectionReceipt(db, input), memoryStateReader, env })
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

  async function bindContextReceipt(ref, { receipt, contextBinding } = {}) {
    const { job, identityState } = await ownedClaim(ref)
    if (typeof job.executionId !== 'string' || !job.executionId) throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
    try { assertRuntimeTraceEvent({ jobId: job.id, executionId: job.executionId }, { kind: 'CONTEXT_RECEIPT', payload: receipt }) }
    catch { throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409) }
    if (!contextBinding || typeof contextBinding !== 'object' || Array.isArray(contextBinding)
      || Object.keys(contextBinding).sort().join(',') !== 'contextPacket,contextReceiptHash,contextReceiptId'
      || contextBinding.contextReceiptId !== receipt.receiptId || contextBinding.contextReceiptHash !== receipt.hash
      || (contextBinding.contextPacket !== null && (!contextBinding.contextPacket || typeof contextBinding.contextPacket !== 'object'
        || Array.isArray(contextBinding.contextPacket) || Buffer.byteLength(JSON.stringify(contextBinding.contextPacket), 'utf8') > MAX_MEMORY_PACKET_BYTES))) {
      throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
    }
    const api010 = await loadRuntimeSourceManifest(db, job)
    const route = job.memorySyncOptIn === true ? memoryRoute(job) : null
    const stored = route ? await storedRead(job, route) : null
    if (stored?.contextReceiptId && receipt.receiptId !== stored.contextReceiptId) {
      throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
    }
    await validateInjectionPacket(db, job, stored, receipt, contextBinding.contextPacket)
    if (api010.size > 0) {
      try {
        await assertLineEpisodicMemoryJobLive({ job, identityState, env,
          memoryStateReader: episodicMemoryStateReader ?? memoryStateReader, authorizationResolver })
      } catch { throw error('LINE_MEMORY_POLICY_REVOKED', 409) }
    }
    const payload = contextBindingPayload(job, receipt, contextBinding.contextPacket)
    await appendTraceEvent(db, { scope: { tenantId: job.tenantId, businessId: job.businessId }, turnId: job.id,
      executionId: job.executionId, kind: 'MEMORY_THREAD_READ', idempotencyKey: runtimeContextBindingKey(job), payload,
      occurredAt: new Date(now().getTime()) })
    return payload
  }

  async function injection(ref, { state, contextReceiptId, contextReceiptHash, contextPacket } = {}) {
    // RESOLVED is recorded before the model starts, so it carries every fence the
    // legacy worker applies before its model call. The later states describe a
    // call that has already happened: like the legacy wrapper they are recorded
    // for the claimed job regardless of a lease or identity change mid-call, but
    // never for another execution and never after erasure.
    const { job } = await ownedClaim(ref, state === 'RESOLVED' ? {} : { checkLease: false, checkIdentity: false })
    const route = memoryTurn(job)
    if (state === 'RESOLVED') await assertMemoryJobLive(job, memoryStateReader, env)
    else if (job.errorCode === 'PDPA_ERASURE') throw error('LINE_MEMORY_JOB_ERASED', 409)
    const stored = await storedRead(job, route)
    if (!stored?.contextPacketJson) throw error('MEMORY_INJECTION_NOT_APPLICABLE', 409)
    // The MSP boundary only accepts an injection after Runtime has durably
    // recorded this execution's exact SDD-100 receipt. Old state-only callers
    // fail closed: a Core read receipt alone cannot bind a provider packet.
    const receipt = await loadCanonicalContextReceipt(db, job, stored, contextReceiptId, contextReceiptHash)
    await validateInjectionPacket(db, job, stored, receipt, contextPacket)
    const binding = await loadContextBinding(db, job)
    const packetHash = createHash('sha256').update(JSON.stringify(contextPacket)).digest('hex')
    if (binding.receiptId !== contextReceiptId || binding.receiptHash !== contextReceiptHash
      || binding.packetHash !== packetHash || !sameJson(binding.mspRefs, receipt.refs.msp)) {
      throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
    }
    const hasBinding = true
    const injectionPacket = contextPacket
    if (hasBinding) {
      const priorRows = await db.agentTraceEvent.findMany({ where: { tenantId: job.tenantId, businessId: job.businessId,
        turnId: job.id, kind: 'MEMORY_INJECTION_RECORDED' }, select: { payloadJson: true } })
      for (const row of priorRows) {
        let prior
        try { prior = JSON.parse(row.payloadJson) } catch { throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409) }
        // Old state-only receipts remain readable. Once a turn has used a bound
        // receipt, every later MSP state must name the identical receipt and packet.
        if (prior.contextReceiptId !== undefined && (prior.contextReceiptId !== contextReceiptId
          || prior.contextReceiptHash !== contextReceiptHash || prior.packetHash !== packetHash)) {
          throw error('MEMORY_CONTEXT_RECEIPT_MISMATCH', 409)
        }
      }
    }
    // The principal and the grant come from Core's own authorization for this job,
    // with no private write; the model reference from the claim-bound credential.
    let current = await currentAuthorization(job, route)
    if (state === 'RESOLVED' && stored.privateMemoryAllowed) {
      current = await assertPolicyStillAllows(job, route, stored, current)
    } else {
      samePrincipal(current, stored)
    }
    const model = await modelResolver(job)
    const port = threadMemory()
    port.bindTrustedRoute(stored.threadId, route)
    const recorder = port.injectionReceipt({ model, contextPacket: injectionPacket,
      threadId: stored.threadId, exchangeId: stored.exchangeId,
      authorization: { authContext: durableAuthContext(current.authContext) },
      requesterId: current.authContext.actor.principalId, contextReceiptId: hasBinding ? contextReceiptId : stored.contextReceiptId ?? null })
    const outcome = await recorder.recordWithRetry(state)
    if (!outcome.ok) throw error('MSP_INJECTION_RECEIPT_UNKNOWN', 503)
    const operationId = memoryOperationIds(job.id).injection
    await traceNote(job, 'MEMORY_INJECTION_RECORDED', `${operationId}:${state}`, { operationId, state,
      ...(hasBinding ? { contextReceiptId, contextReceiptHash, packetHash } : {}) })
    return { status: 'COMPLETED', operationId, result: { receipt: { state } } }
  }

  async function operate(ref, request, { deadlineAt } = {}) {
    const ids = memoryOperationIds(ref.jobId)
    try {
      if (request.operation === 'read') {
        if (request.operationId !== ids.read) throw error('MEMORY_OPERATION_ID_INVALID')
        return await read(ref, { deadlineAt })
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

  return Object.freeze({ operate, bindContextReceipt })
}
