import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import prisma from '@/lib/db'
import { resolveBusinessModelCredential } from '@/modules/integration/application/model-provider-credential-service'
import { selectRegisteredQuery } from '@/modules/agent/grounded-business-answer'
import {
  conversationRuntimeServesGroundingMode, createLineGroundingReader,
  lineKnowledgeGroundingBudgetFromEnv, resolveLineKnowledgeGroundingMode,
} from '@/modules/agent/line-knowledge-grounding'
import { createLineExecutionTrace } from '@/modules/agent/line-execution-trace'
import { createCorpusKnowledgeReader } from '@/modules/knowledge/corpus-knowledge-reader'
import {
  parseLineProjectWorkCommand, searchLineProjectWork, proposeLineWork, confirmLineWork, isLineWorkDomainError,
  lineProjectWorkSyntaxReply, lineWorkConfirmText, lineWorkErrorReply, lineWorkProposalText, lineWorkReadText,
  LINE_WORK_DUPLICATE_TEXT,
} from '@/modules/agent/line-project-work-tools'
import { lineCatalogCommandReply, lineCatalogViewer } from '@/modules/agent/line-catalog-command'
import { parseLineCatalogCommand } from '@/modules/inventory'
import { appendTraceEvent, sha256 } from '@/modules/agent/execution-trace'
import { serverLinePorts } from './server-line-runtime'
import { createConversationRuntimeMemory, MEMORY_INJECTION_STATES, MEMORY_OPERATIONS, MAX_MEMORY_PACKET_BYTES } from './conversation-runtime-memory'
import {
  appendRuntimeConversationTrace, claimRuntimeConversationJob, completeRuntimeConversationJob,
  failRuntimeConversationJob, renewRuntimeConversationJob, runtimeAudienceBound, runtimeConversationStatus, assertRuntimeTraceEvent,
  runtimeOperationStatus, sendRuntimeConversationJob, runtimeOutOfHoursReply, LINE_TEXT_MAX_CHARS, runtimeSenderAuthority,
} from './line-conversation-jobs'

// @req FR-149, FR-171 — authenticated core ownership boundary for the independent runtime.
// @req FR-235 — Core `prepare` selects a runtime turn's evidence with the same
//   grounding-mode reader the Server answer path uses; the runtime receives evidence only.
// @spec ADR-106 D2-D4, SDD-110 — server-derived authority, strict bounded v1 operations.
// @spec ADR-090 D1-D3, SEC-032 — mode-gated, time-budgeted GKS read with one traced hop each.
// @req FR-210 — the `#sku` catalogue command in the runtime cohort: Core runs it
//   (scope from the claimed job, the person from the verified channel identity,
//   Inventory authority from the resolved viewer) and hands the runtime its reply
//   as a CATALOG_COMMAND turn, exactly the reply the Server worker sends. No model
//   credential or Work tool is handed out for such a turn.
// @req FR-149 — the `memory` operation carries memory-sync opt-in turns (ADR-106 D2
//   Memory/Knowledge read/append/receipt); Core remains the only MSP caller.
// @req FR-149 — a job admitted for an unverified LINE sender (owner ruling
//   2026-09-27) gets exactly what the legacy Server path gives that sender, from
//   Core's admission-time record (`runtimeSenderAuthority`), never from the runtime:
//   `resolve` names no person, every Work call is refused with the legacy handler's
//   own reply before any Work reader or writer, and a `#sku` message is an ordinary
//   question. A memory-sync turn runs in Core's PENDING memory mode (W11): no private
//   recall, the question and reply appended to the MSP thread with PENDING assurance
//   and no person, as the legacy worker does. A verified job is unchanged.
// @tested tests/integration/conversation-runtime-vertical-slice.test.js,
//   tests/integration/conversation-runtime-grounding.test.js,
//   tests/integration/conversation-runtime-grounding-parity.test.js,
//   tests/integration/conversation-runtime-out-of-hours.test.js,
//   tests/integration/conversation-runtime-group-room.test.js,
//   tests/integration/conversation-runtime-catalog-command.test.js,
//   tests/integration/conversation-runtime-memory.test.js,
//   tests/integration/conversation-runtime-unverified.test.js
const VERSION = 'conversation-runtime.v1'
const MAX_BODY_BYTES = 64 * 1024
const MAX_RESPONSE_BYTES = 64 * 1024
const identifier = z.string().trim().min(1).max(128)
const claimSchema = z.object({
  jobId: identifier, executionId: identifier, claimantId: identifier,
  version: z.number().int().positive(), tenantId: identifier, businessId: identifier, accountId: identifier,
}).strict()
const envelopeSchema = z.object({
  contractVersion: z.literal(VERSION), operation: z.enum(['claim', 'renew', 'resolve', 'prepare', 'work-tool', 'credential', 'complete', 'fail', 'send', 'trace', 'status', 'memory']),
  correlationId: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  idempotencyKey: z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/),
  deadlineAt: z.string().datetime({ offset: true }), payload: z.record(z.unknown()).refine(value => Object.keys(value).length <= 32),
}).strict()
const fields = Object.freeze({ claim: ['claimantId'], renew: ['claim'], resolve: ['claim'], prepare: ['claim', 'authorityVersion'],
  'work-tool': ['claim', 'operation', 'operationId', 'input'], credential: ['claim'],
  complete: ['claim', 'text', 'operationId'], fail: ['claim', 'code', 'outcome'], send: ['claim', 'operationId'],
  trace: ['claim', 'kind', 'payload'], status: ['claim', 'operationId'],
  memory: ['claim', 'operation', 'operationId', 'input'] })
const memoryInputSchemas = Object.freeze({
  read: z.object({}).strict(),
  append: z.object({ text: z.string().max(5000).refine(value => value.trim().length > 0) }).strict(),
  // The model reference is Core's own, from the claim-bound credential.
  receipt: z.object({ state: z.enum(MEMORY_INJECTION_STATES).optional() }).strict(),
})
// The legacy handler's fixed reply when a Work command is refused (handleLineProjectWorkCommand).
const WORK_AUDIENCE_REFUSAL_TEXT = 'ไม่สามารถดำเนินการคำสั่งงานนี้ได้ กรุณาตรวจสอบรูปแบบคำสั่ง การเชื่อมตัวตน และสิทธิ์ของคุณ'
const error = (code, status = 400) => Object.assign(new Error(code), { code, status })
const present = (value, max = 128) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
// @req FR-026, FR-149 — Work replies keep the legacy Server bound: the Server worker
// parses its answer through `zCompletion.shape.text` (trimmed, at most 5,000
// characters) and fails the job, with no reply, when a Work text is longer.
const WORK_TEXT_MAX = 5000
// A Work refusal is a typed, final outcome with the legacy reply text; the codes
// are the `errorCode` values handleLineProjectWorkCommand returns.
const WORK_REJECTION_CODES = Object.freeze(['WORK_CONFIRMATION_EXPIRED', 'WORK_VERSION_CONFLICT', 'WORK_ACTION_UNAVAILABLE'])
// Key-order-independent JSON, for comparing a runtime request with the derived command.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
function workSyntaxReply(question) {
  const reply = lineProjectWorkSyntaxReply(question)
  return reply ? { code: reply.errorCode ?? 'WORK_COMMAND_USAGE', text: reply.text } : null
}

function boundedJsonWithin(value, maxBytes) {
  const pending = [{ value, depth: 0 }]
  const seen = new WeakSet()
  while (pending.length) {
    const current = pending.pop()
    if (current.depth > 64) return false
    if (current.value === null || typeof current.value === 'string' || typeof current.value === 'boolean') continue
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) return false
      continue
    }
    if (!current.value || typeof current.value !== 'object') return false
    if (seen.has(current.value)) return false
    seen.add(current.value)
    for (const child of Object.values(current.value)) pending.push({ value: child, depth: current.depth + 1 })
  }
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' && Buffer.byteLength(serialized, 'utf8') <= maxBytes
  } catch { return false }
}

async function readBoundedJson(request) {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw error('CONTRACT_REQUEST_TOO_LARGE', 413)
  const reader = request.body?.getReader()
  if (!reader) throw error('CONTRACT_JSON_REQUIRED')
  const chunks = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel()
        throw error('CONTRACT_REQUEST_TOO_LARGE', 413)
      }
      chunks.push(Buffer.from(value))
    }
  } finally { reader.releaseLock() }
  try { return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')) }
  catch { throw error('CONTRACT_JSON_INVALID') }
}

function exactPayload(payload, operation) {
  const allowed = fields[operation]
  if (!allowed || Object.keys(payload).some(key => !allowed.includes(key))
    || allowed.some(key => !Object.hasOwn(payload, key))) throw error('CONTRACT_PAYLOAD_INVALID')
  if (operation === 'claim') {
    if (!present(payload.claimantId)) throw error('CLAIMANT_ID_INVALID')
    return
  }
  const claim = claimSchema.safeParse(payload.claim)
  if (!claim.success) throw error('CLAIM_REFERENCE_INVALID')
  payload.claim = claim.data
  if (['send', 'status'].includes(operation) && !present(payload.operationId, 200)) throw error('OPERATION_ID_INVALID')
  if (operation === 'prepare' && (!Number.isInteger(payload.authorityVersion) || payload.authorityVersion < 1)) throw error('AUTHORITY_VERSION_INVALID')
  if (operation === 'complete' && (!present(payload.text, 5000) || !present(payload.operationId, 200))) throw error('COMPLETION_INVALID')
  if (operation === 'fail' && (!present(payload.code, 80) || !['FAILED', 'UNKNOWN'].includes(payload.outcome))) throw error('FAILURE_INVALID')
  if (operation === 'work-tool') {
    if (!['read', 'propose', 'confirm-execute', 'status'].includes(payload.operation)
      || !present(payload.operationId, 200) || !payload.input || typeof payload.input !== 'object' || Array.isArray(payload.input)
      || !boundedJsonWithin(payload.input, 16 * 1024)) throw error('WORK_TOOL_REQUEST_INVALID')
    const inputSchema = payload.operation === 'read'
      ? z.object({ kind: z.enum(['projects', 'work']).optional(), query: z.string().max(120).optional() }).strict()
      : payload.operation === 'propose'
        ? z.object({ action: z.enum(['create_work', 'update_work']), targetId: z.string().uuid(), args: z.record(z.unknown()) }).strict()
        : payload.operation === 'confirm-execute'
          ? z.object({ proposalId: z.string().uuid() }).strict()
          : z.object({ proposalId: z.string().uuid().optional() }).strict()
    const parsedInput = inputSchema.safeParse(payload.input)
    if (!parsedInput.success) throw error('WORK_TOOL_INPUT_INVALID')
    payload.input = parsedInput.data
  }
  if (operation === 'memory') {
    if (!MEMORY_OPERATIONS.includes(payload.operation) || !present(payload.operationId, 200)
      || !/^[A-Za-z0-9._:-]+$/.test(payload.operationId)
      || !payload.input || typeof payload.input !== 'object' || Array.isArray(payload.input)
      || !boundedJsonWithin(payload.input, 16 * 1024)) throw error('MEMORY_REQUEST_INVALID')
    const parsedInput = memoryInputSchemas[payload.operation].safeParse(payload.input)
    if (!parsedInput.success) throw error('MEMORY_INPUT_INVALID')
    payload.input = parsedInput.data
  }
  if (operation === 'trace' && (!present(payload.kind, 80) || !payload.payload || typeof payload.payload !== 'object'
    || Array.isArray(payload.payload) || !boundedJsonWithin(payload.payload, 8 * 1024))) throw error('TRACE_PAYLOAD_INVALID')
}

function safeResponse(data) {
  const value = { contractVersion: VERSION, ok: true, data }
  const body = JSON.stringify(value)
  if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) throw error('CONTRACT_RESPONSE_TOO_LARGE', 500)
  return body
}

// Admission allows LINE_TEXT_MAX_CHARS of any text, and a question that escapes heavily in JSON (control
// characters take six bytes each) plus full evidence can outgrow the response cap. The legacy path answers
// such a turn, so `prepare` must too: it drops the lowest-ranked evidence records until the answer fits and
// never touches the question, which admission already bounded.
function fitPreparedTurn(result) {
  const records = result?.evidence?.records
  if (!Array.isArray(records)) return result
  const kept = [...records]
  const bytes = () => Buffer.byteLength(JSON.stringify({ contractVersion: VERSION, ok: true,
    data: { ...result, evidence: { ...result.evidence, records: kept } } }), 'utf8')
  while (kept.length && bytes() > MAX_RESPONSE_BYTES) kept.pop()
  return kept.length === records.length ? result : { ...result, evidence: { ...result.evidence, records: kept } }
}

function validateResult(operation, data) {
  const invalid = () => { throw error('CONTRACT_RESPONSE_INVALID', 500) }
  if (!boundedJsonWithin(data, MAX_RESPONSE_BYTES)) invalid()
  const exact = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value)
    && !Object.keys(value).some(key => !allowed.includes(key))
  if (operation === 'claim') {
    if (data === null) return
    const schema = z.object({ ...claimSchema.shape, leaseExpiresAt: z.string().datetime({ offset: true }),
      deadlineAt: z.string().datetime({ offset: true }), correlationId: identifier,
      phase: z.enum(['EXECUTION', 'DELIVERY']) }).strict()
    if (!schema.safeParse(data).success) invalid()
    return
  }
  if (operation === 'prepare') {
    // FR-244 / FR-210 — an OUT_OF_HOURS or CATALOG_COMMAND turn carries Core's fixed
    // reply and nothing to execute; a CATALOG_COMMAND turn's question is a `#sku` command.
    if (data?.turnKind !== undefined && (!['OUT_OF_HOURS', 'CATALOG_COMMAND'].includes(data.turnKind) || !present(data.replyText, 5000)
      || data.workCommand != null || data.workReply != null || data.evidence?.records?.length || data.slices?.length
      || (data.turnKind === 'CATALOG_COMMAND' && !parseLineCatalogCommand(data.question)))) invalid()
    if (data?.turnKind === undefined && data?.replyText !== undefined) invalid()
    if (!exact(data, ['question', 'evidence', 'slices', 'authorized', 'audienceKind', 'threadId', 'maxBudgetChars', 'workCommand', 'workReply',
      'turnKind', 'replyText', 'memorySync'])
      || (data.memorySync !== undefined && (data.memorySync !== true || data.workCommand != null || data.workReply != null
        || data.turnKind !== undefined))
      || !present(data.question, LINE_TEXT_MAX_CHARS) || !exact(data.evidence, ['records']) || !Array.isArray(data.evidence.records)
      || data.evidence.records.length > 64 || !Array.isArray(data.slices) || data.slices.length > 64
      || typeof data.authorized !== 'boolean' || !['DIRECT', 'GROUP', 'ROOM'].includes(data.audienceKind)
      || (data.threadId !== null && !present(data.threadId, 128))
      || !Number.isInteger(data.maxBudgetChars) || data.maxBudgetChars < 0 || data.maxBudgetChars > 32_000
      || (data.workCommand != null && JSON.stringify(parseLineProjectWorkCommand(data.question)) !== JSON.stringify(data.workCommand))
      // A fixed Work reply is only ever the one the signed inbound text derives.
      || (data.workReply != null && (data.workCommand != null || !exact(data.workReply, ['code', 'text'])
        || JSON.stringify(data.workReply) !== JSON.stringify(workSyntaxReply(data.question))))
      || !boundedJsonWithin(data.evidence, 32 * 1024) || !boundedJsonWithin(data.slices, 32 * 1024)) invalid()
    return
  }
  if (operation === 'resolve') {
    if (!exact(data, ['authorized', 'version', 'scope']) || typeof data.authorized !== 'boolean' || !Number.isInteger(data.version) || data.version < 1
      || !exact(data.scope, ['tenantId', 'businessId', 'accountId', 'identityId', 'identityVersion', 'identityState'])
      || !['tenantId', 'businessId', 'accountId'].every(key => present(data.scope[key], 128))) invalid()
    // A verified sender's scope names the identity, as before; an unverified
    // sender's names no person at all and says so.
    if (data.scope.identityState === undefined) {
      if (!present(data.scope.identityId, 128) || !Number.isInteger(data.scope.identityVersion) || data.scope.identityVersion < 1) invalid()
    } else if (data.scope.identityState !== 'UNVERIFIED' || data.scope.identityId !== null || data.scope.identityVersion !== null) invalid()
    return
  }
  if (operation === 'credential') {
    const schema = z.object({ provider: z.string().min(1).max(32), model: z.string().min(1).max(200),
      apiKey: z.string().min(1).max(4096), baseUrl: z.string().max(2048).optional() }).strict()
    if (!schema.safeParse(data).success) invalid()
    return
  }
  if (operation === 'renew') {
    if (!exact(data, ['version', 'leaseExpiresAt']) || !Number.isInteger(data.version) || data.version < 1
      || !Number.isFinite(Date.parse(data.leaseExpiresAt))) invalid()
    return
  }
  if (operation === 'send') {
    if (!exact(data, ['id', 'status', 'acceptance']) || !present(data.id, 128)
      || !['RECORDED', 'ACCEPTED', 'UNKNOWN', 'FAILED', 'CANCELLED', 'CONTENDED', 'FENCED', 'STOPPED', 'READY', 'SENDING', 'MISSING'].includes(data.status)
      || (data.acceptance !== undefined && (!data.acceptance || typeof data.acceptance !== 'object' || Array.isArray(data.acceptance)
        || !boundedJsonWithin(data.acceptance, 8 * 1024)))) invalid()
    return
  }
  if (operation === 'status') {
    if (!exact(data, ['status', 'operationId', 'version', 'errorCode', 'executionId', 'text'])
      || !present(data?.status, 32) || !present(data?.operationId, 200)
      || (data.version !== undefined && (!Number.isInteger(data.version) || data.version < 1))
      || (data.errorCode !== undefined && data.errorCode !== null && !present(data.errorCode, 80))
      || (data.executionId !== undefined && !present(data.executionId, 128))
      || (data.text !== undefined && !present(data.text, 5000))
      || !boundedJsonWithin(data, MAX_RESPONSE_BYTES)) invalid()
    return
  }
  if (operation === 'work-tool') {
    if (!['COMPLETED', 'NOT_FOUND', 'REJECTED'].includes(data?.status)
      || Buffer.byteLength(JSON.stringify(data), 'utf8') > 32 * 1024) invalid()
    if (data.status === 'REJECTED' && (!exact(data, ['status', 'code', 'result']) || !WORK_REJECTION_CODES.includes(data.code)
      || !exact(data.result, ['text']) || !present(data.result.text, WORK_TEXT_MAX))) invalid()
    if (data.status === 'COMPLETED' && (!exact(data, ['status', 'result'])
      || !exact(data.result, ['text', 'receipt']) || !present(data.result.text, 5000)
      || !data.result.receipt || typeof data.result.receipt !== 'object' || Array.isArray(data.result.receipt)
      || Object.keys(data.result.receipt).length > 12 || !boundedJsonWithin(data.result, 32 * 1024))) invalid()
    if (data.status === 'NOT_FOUND' && (!exact(data, ['status', 'operationId', 'proposalId', 'receipt'])
      || (data.operationId !== undefined && !present(data.operationId, 200))
      || (data.proposalId !== undefined && !present(data.proposalId, 128))
      || (data.receipt !== undefined && (!data.receipt || typeof data.receipt !== 'object' || Array.isArray(data.receipt)
        || Object.keys(data.receipt).length > 12 || !boundedJsonWithin(data.receipt, 32 * 1024))))) invalid()
    return
  }
  if (operation === 'trace') {
    if (!exact(data, ['recorded']) || data.recorded !== true) invalid()
    return
  }
  if (operation === 'memory') {
    if (!['COMPLETED', 'NOT_FOUND'].includes(data?.status) || !present(data.operationId, 200)
      || !boundedJsonWithin(data, 48 * 1024)) invalid()
    if (data.status === 'NOT_FOUND' && !exact(data, ['status', 'operationId'])) invalid()
    if (data.status === 'COMPLETED' && (!exact(data, ['status', 'operationId', 'result'])
      || !exact(data.result, ['contextPacket', 'receipt']) || !data.result.receipt || typeof data.result.receipt !== 'object'
      || Array.isArray(data.result.receipt) || Object.keys(data.result.receipt).length > 12
      || (data.result.contextPacket !== undefined && data.result.contextPacket !== null
        && (typeof data.result.contextPacket !== 'object' || Array.isArray(data.result.contextPacket)
          || data.result.contextPacket.policyDecision !== 'ALLOW'
          || !boundedJsonWithin(data.result.contextPacket, MAX_MEMORY_PACKET_BYTES))))) invalid()
    return
  }
  if (operation === 'complete' || operation === 'fail') {
    const fields = operation === 'complete' ? ['id', 'status', 'version', 'operationId'] : ['id', 'status', 'version']
    if (!exact(data, fields) || !present(data.status, 32) || !Number.isInteger(data.version) || data.version < 1
      || (data.id !== undefined && !present(data.id, 128))
      || (data.operationId !== undefined && !present(data.operationId, 200))) invalid()
    return
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || !boundedJsonWithin(data, MAX_RESPONSE_BYTES)) invalid()
}

// The runtime's Core client aborts every call after 10 s (core-client.js `timeoutMs`),
// whatever the envelope deadline says. The GKS hop's budget must end well inside
// that, leaving room for the GKS_THEN_BUSINESS_KNOWLEDGE fallback read, the trace
// writes and the response, or the runtime abandons an execution Core keeps tracing
// (and a reclaim traces the same turn's NO_EVIDENCE hops again).
export const CORE_PREPARE_CALL_TIMEOUT_MS = 10_000
export const CORE_PREPARE_SAFETY_MARGIN_MS = 2_500

/** The GKS budget Core `prepare` may spend: the configured budget, clamped below
 * both the runtime's call timeout and the envelope deadline, less a safety margin.
 * Returns 0 when not even the margin is left, so the caller reads nothing. */
export function corePrepareKnowledgeBudgetMs(configuredMs, { deadlineAt, now = () => new Date() } = {}) {
  const ceiling = CORE_PREPARE_CALL_TIMEOUT_MS - CORE_PREPARE_SAFETY_MARGIN_MS
  const deadlineMs = Date.parse(deadlineAt)
  const remaining = Number.isFinite(deadlineMs)
    ? deadlineMs - now().getTime() - CORE_PREPARE_SAFETY_MARGIN_MS : ceiling
  const budget = Math.min(configuredMs, ceiling, remaining)
  return Number.isFinite(budget) && budget > 0 ? Math.floor(budget) : 0
}

/**
 * Core-owned turn preparation for a claimed runtime job (already revalidated by
 * `ownedClaim`). Evidence selection is the legacy Server answer path's, not a
 * second derivation: the same `selectRegisteredQuery(question)` input, the same
 * `createLineGroundingReader` for GKS_CORPUS / GKS_THEN_BUSINESS_KNOWLEDGE over an
 * in-process corpus reader scoped to the job's own tenant and Business, and the
 * same unwrapped business-knowledge reader for BUSINESS_KNOWLEDGE. Every hop is
 * traced on the job's execution exactly as `createServerLineAnswer` traces it.
 * Core stays the only MSP/GKS caller; the runtime receives `evidence.records` only.
 */
export function createCorePrepareTurn({ db = prisma, env = process.env, now = () => new Date(), businessPorts,
  corpusReaderFactory = createCorpusKnowledgeReader, traceFactory = createLineExecutionTrace } = {}) {
  if (typeof businessPorts !== 'function') throw new Error('CORE_PREPARE_BUSINESS_PORTS_REQUIRED')
  return async (job, { deadlineAt } = {}) => {
    const question = job.inbound?.body
    // The legacy answer path's input check (createServerLineAnswer), before any read.
    // Non-retryable: the admitted inbound text will not change on a retry.
    if (![job.tenantId, job.businessId, question].every(value => typeof value === 'string' && value.trim())) {
      throw error('LINE_ANSWER_INPUT_INVALID', 422)
    }
    const workCommand = parseLineProjectWorkCommand(question)
    if (workCommand) return { question, evidence: { records: [] }, slices: [], authorized: true,
      audienceKind: job.audienceKind, threadId: null, maxBudgetChars: 0, workCommand }
    // Malformed legacy Work syntax: the reply is fixed by the text alone, as on the Server path.
    const workReply = workSyntaxReply(question)
    if (workReply) return { question, evidence: { records: [] }, slices: [], authorized: true,
      audienceKind: job.audienceKind, threadId: null, maxBudgetChars: 0, workCommand: null, workReply }
    if (!conversationRuntimeServesGroundingMode(job.account.knowledgeGrounding)) throw error('RUNTIME_GROUNDING_MODE_NOT_SUPPORTED', 409)
    const mode = resolveLineKnowledgeGroundingMode(job.account.knowledgeGrounding)
    const ports = await businessPorts()
    if (!ports?.businessKnowledge?.query) throw error('RUNTIME_KNOWLEDGE_UNAVAILABLE', 503)
    const trace = traceFactory({ db, job })
    let knowledge
    if (mode === 'BUSINESS_KNOWLEDGE') {
      // The legacy BUSINESS_KNOWLEDGE reader, unwrapped, with its single
      // pre-FR-235 `recordEvidence(input, evidence)` trace shape.
      knowledge = { query: async input => {
        const evidence = await ports.businessKnowledge.query(input)
        await trace.recordEvidence(input, evidence)
        return evidence
      } }
    } else {
      const budget = lineKnowledgeGroundingBudgetFromEnv(env)
      const budgetMs = corePrepareKnowledgeBudgetMs(budget.budgetMs, { deadlineAt, now })
      if (budgetMs === 0) throw error('CONTRACT_DEADLINE_EXPIRED', 408)
      knowledge = createLineGroundingReader({ mode, trace, budgetMs,
        corpusReader: corpusReaderFactory({ tenantId: job.tenantId, businessId: job.businessId, ...budget }),
        businessKnowledgeReader: ports.businessKnowledge })
    }
    const evidence = await knowledge.query({ tenantId: job.tenantId, businessId: job.businessId, ...selectRegisteredQuery(question) })
    const result = { question, evidence: { records: Array.isArray(evidence?.records) ? evidence.records : [] },
      slices: [], authorized: true, audienceKind: job.audienceKind, threadId: null, maxBudgetChars: 0, workCommand: null }
    if (Buffer.byteLength(JSON.stringify(result.evidence), 'utf8') > 32 * 1024) throw error('TURN_EVIDENCE_TOO_LARGE', 413)
    return result
  }
}

function reply(status, body) {
  return new Response(body, { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}

export function createConversationRuntimeCore({ db = prisma, env = process.env, now = () => new Date(),
  prepareTurn = null, businessPorts = null, credentialResolver = null, linePorts = serverLinePorts, claim = claimRuntimeConversationJob,
  renew = renewRuntimeConversationJob, complete = completeRuntimeConversationJob, fail = failRuntimeConversationJob,
  readStatus = runtimeConversationStatus, operationStatus = runtimeOperationStatus,
  send = sendRuntimeConversationJob, appendTrace = appendRuntimeConversationTrace,
  workSearch = searchLineProjectWork, workPropose = proposeLineWork, workConfirm = confirmLineWork,
  catalogViewer = lineCatalogViewer, catalogCommand = lineCatalogCommandReply,
  threadMemoryFactory = null, memoryContextAssembler, memoryAuthorizationResolver } = {}) {
  let businessPortsPromise
  // `businessPorts` may be the ports object itself (tests) or a function returning it.
  const getBusinessPorts = typeof businessPorts === 'function' ? businessPorts : (async () => {
    if (businessPorts) return businessPorts
    if (!businessPortsPromise) {
      businessPortsPromise = import('@/modules/agent/phase1-runtime').then(({ createPhase1BusinessAgentPortsFromEnv }) =>
        createPhase1BusinessAgentPortsFromEnv(env, { bindingRequired: false }))
      businessPortsPromise.catch(() => { businessPortsPromise = null })
    }
    return businessPortsPromise
  })
  const resolveCredential = credentialResolver ?? (async job => {
    const credential = await resolveBusinessModelCredential({ tenantId: job.tenantId, businessId: job.businessId }, { db, env })
    if (!credential?.apiKey) throw error('MODEL_CREDENTIAL_NOT_RESOLVABLE', 503)
    return { provider: credential.provider, model: credential.model, apiKey: credential.apiKey,
      ...(credential.baseUrl ? { baseUrl: credential.baseUrl } : {}) }
  })
  const prepare = prepareTurn ?? createCorePrepareTurn({ db, env, now, businessPorts: getBusinessPorts })

  // @req FR-210 — the `#sku` decision is made once per job and stored by Core.
  // Only a message that parses as `#sku` has one. The first `prepare` authorizes
  // the sender exactly as the Server worker's answer port does, runs the command
  // when they may, and records the outcome as an immutable trace row under a
  // Core-only key (the runtime's own trace keys are all `<job>:runtime:…`):
  // `{ decision: 'COMMAND', replyText }` or `{ decision: 'ORDINARY' }`. A reclaim
  // or a duplicate `prepare` replays the stored decision and never runs the
  // command again; `credential`, `work-tool` and `complete` read the same row, so
  // they can never disagree with what `prepare` handed out.
  const catalogKey = job => `${job.id}:catalog-command`
  const catalogAuthorize = job => catalogViewer(job, { db })
  const isCatalogMessage = job => Boolean(parseLineCatalogCommand(job.inbound?.body))
  async function storedCatalogDecision(job) {
    const row = await db.agentTraceEvent.findUnique({ where: { tenantId_businessId_idempotencyKey: {
      tenantId: job.tenantId, businessId: job.businessId, idempotencyKey: catalogKey(job) } } })
    if (!row || row.turnId !== job.id || row.kind !== 'TOOL_RESULT') return null
    const payload = JSON.parse(row.payloadJson)
    if (payload?.tool !== 'LINE_CATALOG_COMMAND' || !['COMMAND', 'ORDINARY'].includes(payload.decision)
      || (payload.decision === 'COMMAND' && (!present(payload.replyText, 5000) || payload.replySha256 !== sha256(payload.replyText)))) {
      throw error('CATALOG_COMMAND_DECISION_INVALID', 500)
    }
    return payload
  }
  async function decideCatalogCommand(job, identityState) {
    const stored = await storedCatalogDecision(job)
    if (stored) return stored
    // @req FR-210 — the command acts only for a verified sender; for anyone else the
    // message is an ordinary question. An unverified job's sender is never re-read,
    // so a sender verified mid-turn cannot make the command run for it.
    const reply = identityState === 'UNVERIFIED' ? null : await catalogCommand(job, { db, now, authorize: catalogAuthorize })
    const decision = reply ? { tool: 'LINE_CATALOG_COMMAND', decision: 'COMMAND', replyText: reply.text, replySha256: sha256(reply.text) }
      : { tool: 'LINE_CATALOG_COMMAND', decision: 'ORDINARY' }
    try {
      await appendTraceEvent(db, { scope: { tenantId: job.tenantId, businessId: job.businessId }, turnId: job.id,
        executionId: job.executionId ?? null, kind: 'TOOL_RESULT', idempotencyKey: catalogKey(job), payload: decision, occurredAt: now() })
    } catch (cause) {
      // A concurrent prepare of the same job recorded first: its decision stands,
      // and this one's reply is discarded. The command's own writes are safe to
      // race (a preview is keyed by the LINE event; a commit is a version CAS).
      const winner = await storedCatalogDecision(job)
      if (!winner) throw cause
      return winner
    }
    return decision
  }
  /** The stored decision for a `#sku` message; refuses a later operation that arrives before `prepare` made one. */
  async function requiredCatalogDecision(job) {
    if (!isCatalogMessage(job)) return null
    const stored = await storedCatalogDecision(job)
    if (!stored) throw error('CATALOG_COMMAND_NOT_PREPARED', 409)
    return stored
  }
  async function catalogCommandTurn(job, identityState) {
    if (!isCatalogMessage(job)) return null
    const decision = await decideCatalogCommand(job, identityState)
    if (decision.decision !== 'COMMAND') return null
    // The question is informational only; admission and the turn contract share the
    // LINE_TEXT_MAX_CHARS bound (W7), so a long `#sku` batch still gets its reply.
    return { question: job.inbound.body.slice(0, LINE_TEXT_MAX_CHARS), evidence: { records: [] }, slices: [], authorized: true,
      audienceKind: job.audienceKind, threadId: null, maxBudgetChars: 0, workCommand: null,
      turnKind: 'CATALOG_COMMAND', replyText: decision.replyText }
  }

  async function ownedClaim(ref, { status = 'CLAIMED', checkLease = true, checkIdentity = true } = {}) {
    const job = await db.lineConversationJob.findUnique({ where: { id: ref.jobId },
      include: { account: true, inbound: { include: { conversation: true } } } })
    if (!job || job.executionMode !== 'SERVER' || job.runtimeOwner !== 'CONVERSATION_RUNTIME'
      || job.executionId !== ref.executionId
      || job.tenantId !== ref.tenantId || job.businessId !== ref.businessId || job.accountId !== ref.accountId
      || !['CLAIMED', 'READY'].includes(status) || job.status !== status
      || (status === 'CLAIMED' && (job.version !== ref.version || job.claimantId !== ref.claimantId))
      || job.errorCode === 'PDPA_ERASURE'
      || !job.inbound?.conversation || !runtimeAudienceBound(job)
      || job.inbound.conversation.channel !== 'LINE' || job.inbound.conversation.tenantId !== job.tenantId
      || job.inbound.conversation.businessId !== job.businessId
      || job.account.tenantId !== job.tenantId || job.account.businessId !== job.businessId
      || (job.account.bindingCode || job.account.id) !== job.channelAccountId
      || job.account.serverEnabled !== true || job.account.runtimeOwner !== 'CONVERSATION_RUNTIME'
      || job.account.transportMode !== 'CLOUD'
      || job.account.status !== 'CONNECTED' || job.account.transportEpoch !== job.transportEpoch
      || (checkLease && (!job.leaseExpiresAt || job.leaseExpiresAt <= now())) || job.expiresAt <= now()) {
      throw error('CONVERSATION_JOB_AUTHORITY_REVOKED', 409)
    }
    // The sender authority comes from Core's admission-time record and its own
    // ChannelIdentity row, never from the runtime (see `runtimeSenderAuthority`).
    const sender = await runtimeSenderAuthority(db, job)
    const admitted = sender.identityState === 'UNVERIFIED' ? { admittedPrincipalId: sender.admittedPrincipalId } : {}
    if (!checkIdentity) return { job, identity: null, identityState: sender.identityState, ...admitted }
    if (!sender.authorized) {
      throw sender.identityState === 'UNVERIFIED' ? error('CONVERSATION_JOB_AUTHORITY_REVOKED', 409)
        : error('CONVERSATION_IDENTITY_REVOKED', 403)
    }
    return { job, identity: sender.identity, identityState: sender.identityState, ...admitted }
  }
  // @req FR-149 — the memory façade sees the job exactly as Core's claim check read
  // it, plus Core's own sender decision: a job admitted for an unverified sender is
  // marked `senderIdentityState: 'UNVERIFIED'`, which selects the PENDING memory mode
  // (`memoryServerScope`). The mark comes only from the admission record; the v1
  // `memory` request has no field that could name or change it.
  const memoryClaim = async (ref, options) => {
    const owned = await ownedClaim(ref, options)
    return owned.identityState === 'UNVERIFIED'
      ? { ...owned, job: { ...owned.job, senderIdentityState: 'UNVERIFIED', senderPrincipalId: owned.admittedPrincipalId ?? null } }
      : owned
  }
  const memory = createConversationRuntimeMemory({ db, env, now, ownedClaim: memoryClaim, threadMemoryFactory,
    modelResolver: async job => {
      const credential = await resolveCredential(job)
      return { provider: credential.provider, model: credential.model }
    },
    ...(memoryContextAssembler ? { contextAssembler: memoryContextAssembler } : {}),
    ...(memoryAuthorizationResolver ? { authorizationResolver: memoryAuthorizationResolver } : {}) })

  // Renders with the legacy handler's own text functions, so the reply is the same
  // whichever executor cohort owns the job.
  async function executeWork(job, request, expectedClaim) {
    const input = request.input
    // The Server worker commits `zCompletion.shape.text.parse(text)`: the trimmed text,
    // at most 5,000 characters. Return that same trimmed text, so the bound checked
    // here is the one validateResult checks and padding cannot turn a valid reply into a 500.
    const bounded = text => {
      const committed = text.trim()
      if (committed.length > WORK_TEXT_MAX) throw error('WORK_TOOL_TEXT_TOO_LONG', 422)
      return committed
    }
    if (request.operation === 'read') {
      const result = await workSearch(job.id, input, { db, now, expectedClaim })
      return { status: 'COMPLETED', result: { text: bounded(lineWorkReadText(result)),
        receipt: { source: result.source, observedAt: result.observedAt } } }
    }
    if (request.operation === 'propose') {
      const proposal = await workPropose(job.id, input, { db, now, expectedClaim })
      return { status: 'COMPLETED', result: { text: bounded(lineWorkProposalText(input.action, proposal.preview, proposal.proposalId)),
        receipt: { proposalId: proposal.proposalId, status: 'AWAITING_CONFIRMATION' } } }
    }
    const result = await workConfirm(job.id, input.proposalId, { db, now, expectedClaim })
    return { status: 'COMPLETED', result: { text: bounded(lineWorkConfirmText(result)), receipt: result } }
  }

  async function workOperation(ref, request) {
    const { job, identityState } = await ownedClaim(ref)
    // @req FR-149, FR-150 — Work commands are not allowed in a group or room. The
    // legacy handler refuses them there before any Work read or write
    // (line-project-work-tools `contextFor`: WORK_SCOPE_DENIED) and replies with its
    // fixed refusal text. Core answers every WorkTool call for such a job with a final
    // REJECTED outcome carrying that same text and reaches no Work reader or writer:
    // `status` finds nothing, so the runtime executes and settles on the refusal.
    if (job.audienceKind !== 'DIRECT') {
      if (request.operation === 'status') return { status: 'NOT_FOUND', operationId: request.operationId }
      return { status: 'REJECTED', code: 'WORK_ACTION_UNAVAILABLE', result: { text: WORK_AUDIENCE_REFUSAL_TEXT } }
    }
    // @req FR-244 — an out-of-hours turn never runs a Work command (Server parity).
    if (runtimeOutOfHoursReply(job) !== null) throw error('OUT_OF_HOURS_TURN_HAS_NO_WORK', 409)
    // @req FR-210 — a `#sku` turn is answered by the catalogue command alone.
    if ((await requiredCatalogDecision(job))?.decision === 'COMMAND') throw error('CATALOG_COMMAND_TURN_HAS_NO_WORK', 409)
    const expectedClaim = { ...ref, executionMode: 'SERVER', runtimeOwner: 'CONVERSATION_RUNTIME' }
    const input = request.input
    if (request.operation === 'confirm-execute'
      && (!present(input.proposalId, 128) || request.operationId !== input.proposalId)) throw error('WORK_CONFIRMATION_IDENTITY_INVALID')
    // @req FR-149, FR-150 — a Work command from an unverified sender is refused by the
    // legacy handler (line-project-work-tools `contextFor`: WORK_IDENTITY_REQUIRED)
    // with its fixed reply. Core answers the typed command with that reply as a final
    // REJECTED outcome and reaches no Work reader or writer: `status` finds nothing,
    // so the runtime executes and settles on the refusal. The sender is never re-read,
    // so one verified mid-turn gets the same refusal.
    if (identityState === 'UNVERIFIED') {
      if (request.operation === 'status') return { status: 'NOT_FOUND', operationId: request.operationId }
      const typed = parseLineProjectWorkCommand(job.inbound?.body)
      if (!typed || typed.operation !== request.operation || canonicalJson(typed.input) !== canonicalJson(input)) {
        throw error('WORK_COMMAND_MISMATCH', 409)
      }
      const { text, errorCode } = lineWorkErrorReply({ code: 'WORK_IDENTITY_REQUIRED' })
      return { status: 'REJECTED', code: errorCode, result: { text } }
    }
    if (request.operation !== 'status') {
      // The operation and its arguments are the ones the user typed: Core derives
      // them from the job's own signed inbound text. A runtime request that differs
      // (another target, other arguments, another operation) is refused before any
      // Work call, and only the derived command is ever executed.
      const typed = parseLineProjectWorkCommand(job.inbound?.body)
      if (!typed || typed.operation !== request.operation || canonicalJson(typed.input) !== canonicalJson(input)) {
        throw error('WORK_COMMAND_MISMATCH', 409)
      }
      try { return await executeWork(job, { ...request, input: typed.input }, expectedClaim) } catch (cause) {
        // Transport, database and fencing failures keep their retryable or fenced
        // error. A refusal of the request itself (expired confirmation, version
        // conflict, scope, invalid arguments) is final: its transaction rolled back,
        // so it is returned as a typed outcome carrying the legacy reply.
        if (!isLineWorkDomainError(cause)) throw cause
        // The claim can stop being this runtime's while the Work call runs; a
        // fenced claim gets the fence error, never a reply.
        await ownedClaim(ref)
        const { text, errorCode } = lineWorkErrorReply(cause)
        return { status: 'REJECTED', code: errorCode, result: { text } }
      }
    }
    const proposalId = typeof input.proposalId === 'string' ? input.proposalId : request.operationId
    if (request.operationId === `${job.id}:work-proposal`) {
      const proposed = await db.auditEvent.findUnique({ where: { id: job.id } })
      if (proposed?.entityType === 'LINE_WORK_PROPOSAL') {
        const saved = JSON.parse(proposed.payloadJson)
        return { status: 'COMPLETED', result: { text: lineWorkProposalText(saved.action, saved, job.id).trim(),
          receipt: { proposalId: job.id, status: 'AWAITING_CONFIRMATION' } } }
      }
      return { status: 'NOT_FOUND', operationId: request.operationId }
    }
    const inScope = row => row.tenantId === job.tenantId && row.businessId === job.businessId
    const resultRow = await db.auditEvent.findUnique({ where: { id: `line-work-result:${proposalId}` } })
    // Replay a mutation receipt only to the job that executed it (a reclaim of that
    // job). Any other job re-runs confirm-execute, whose binding checks answer it as
    // the Server path does and never disclose another conversation's receipt.
    if (resultRow && resultRow.requestId === job.id && inScope(resultRow)) {
      return { status: 'COMPLETED', result: { text: LINE_WORK_DUPLICATE_TEXT, receipt: JSON.parse(resultRow.payloadJson) } }
    }
    if (resultRow) return { status: 'NOT_FOUND', operationId: request.operationId }
    const proposal = await db.auditEvent.findUnique({ where: { id: proposalId } })
    if (proposal?.entityType === 'LINE_WORK_PROPOSAL' && inScope(proposal)) return { status: 'NOT_FOUND', proposalId, receipt: { status: 'AWAITING_CONFIRMATION' } }
    return { status: 'NOT_FOUND', operationId: request.operationId }
  }

  async function operate(envelope) {
    const { operation, payload } = envelope
    const claimRef = payload.claim
    switch (operation) {
      case 'claim': return claim({ db, claimantId: payload.claimantId, now })
      case 'renew': {
        await ownedClaim(claimRef)
        return renew(claimRef, { db, now })
      }
      case 'resolve': {
        const { job, identity, identityState } = await ownedClaim(claimRef)
        // @req FR-149 — an unverified sender's turn has account and Business scope and no person.
        if (identityState === 'UNVERIFIED') return { authorized: true, version: job.version, scope: { tenantId: job.tenantId,
          businessId: job.businessId, accountId: job.accountId, identityId: null, identityVersion: null, identityState: 'UNVERIFIED' } }
        return { authorized: true, version: job.version, scope: { tenantId: job.tenantId,
          businessId: job.businessId, accountId: job.accountId, identityId: identity.id, identityVersion: identity.version } }
      }
      case 'prepare': {
        const { job, identityState } = await ownedClaim(claimRef)
        if (payload.authorityVersion !== job.version) throw error('CONVERSATION_AUTHORITY_STALE', 409)
        // @req FR-244 — Core decided out-of-hours at admission and owns the reply.
        // Checked before any injected or default preparer, so no grounding mode,
        // Work command, catalogue command or knowledge read applies to this turn, as on
        // the Server path. The question is informational only here; admission already
        // bounds it to LINE_TEXT_MAX_CHARS, the same bound the turn contract checks (W7).
        const outOfHoursReply = runtimeOutOfHoursReply(job)
        if (outOfHoursReply !== null) return { question: job.inbound.body.slice(0, LINE_TEXT_MAX_CHARS), evidence: { records: [] }, slices: [],
          authorized: true, audienceKind: job.audienceKind, threadId: null, maxBudgetChars: 0, workCommand: null,
          turnKind: 'OUT_OF_HOURS', replyText: outOfHoursReply }
        // @req FR-210 — checked before any injected or default preparer, as the
        // Server worker's answer port checks `#sku` before its model answer.
        const catalogTurn = await catalogCommandTurn(job, identityState)
        if (catalogTurn) return catalogTurn
        const turn = fitPreparedTurn(await prepare(job, { deadlineAt: envelope.deadlineAt }))
        // An opted-in turn tells the runtime to run the memory phases; a Work
        // command (or its fixed reply) never touches memory, as in the legacy worker.
        return job.memorySyncOptIn === true && turn?.workCommand == null && turn?.workReply == null ? { ...turn, memorySync: true } : turn
      }
      case 'credential': {
        const { job } = await ownedClaim(claimRef)
        // @req FR-244 — no model runs for an out-of-hours turn; Core does not hand one out.
        if (runtimeOutOfHoursReply(job) !== null) throw error('OUT_OF_HOURS_TURN_HAS_NO_MODEL', 409)
        // @req FR-210 — no model runs for a `#sku` turn; Core does not hand one out.
        if ((await requiredCatalogDecision(job))?.decision === 'COMMAND') throw error('CATALOG_COMMAND_TURN_HAS_NO_MODEL', 409)
        return resolveCredential(job)
      }
      case 'work-tool': return workOperation(claimRef, payload)
      case 'memory': return memory.operate(claimRef, payload)
      case 'complete': {
        const { job } = await ownedClaim(claimRef)
        // @req FR-210 — Core, not the runtime, owns a `#sku` reply: READY is committed
        // only for the stored reply, bounded as the runtime (and the Server worker)
        // bound an answer, so a runtime cannot report an import that did not happen.
        // An out-of-hours turn was answered before any catalogue decision was stored;
        // its own pin is Core's admission snapshot, checked when READY is committed.
        const catalog = runtimeOutOfHoursReply(job) !== null ? null : await requiredCatalogDecision(job)
        if (catalog?.decision === 'COMMAND' && payload.text !== catalog.replyText.trim()) throw error('CATALOG_COMMAND_REPLY_MISMATCH', 409)
        return complete(claimRef, payload, { db, now })
      }
      case 'fail': {
        await ownedClaim(claimRef)
        return fail(claimRef, payload, { db, now })
      }
      case 'send': {
        if (payload.operationId !== `${claimRef.jobId}:${claimRef.executionId}:delivery`) throw error('DELIVERY_IDENTITY_INVALID')
        const ports = linePorts(env, db)
        return send(claimRef, { db, ...ports, env, now })
      }
      case 'trace': {
        assertRuntimeTraceEvent(claimRef, payload)
        await ownedClaim(claimRef, { status: 'CLAIMED', checkLease: false })
        return appendTrace(claimRef, payload, { db, now })
      }
      case 'status': {
        if (payload.operationId === `${claimRef.jobId}:turn-answer`) return readStatus(claimRef, { db })
        if (payload.operationId !== `${claimRef.jobId}:runtime-model`
          && payload.operationId !== `${claimRef.jobId}:delivery`) throw error('OPERATION_ID_INVALID')
        const result = await operationStatus(claimRef, payload.operationId, { db })
        if (payload.operationId.endsWith(':delivery')) {
          const job = await db.lineConversationJob.findUnique({ where: { id: claimRef.jobId }, select: { status: true,
            executionMode: true, runtimeOwner: true, executionId: true, tenantId: true, businessId: true, accountId: true,
            account: { select: { runtimeOwner: true } } } })
          if (!job || job.executionMode !== 'SERVER' || job.runtimeOwner !== 'CONVERSATION_RUNTIME'
            || job.account.runtimeOwner !== 'CONVERSATION_RUNTIME' || job.executionId !== claimRef.executionId
            || job.tenantId !== claimRef.tenantId || job.businessId !== claimRef.businessId || job.accountId !== claimRef.accountId) throw error('CONVERSATION_JOB_LEASE_CONFLICT', 409)
          return { status: job.status, operationId: payload.operationId }
        }
        if (result.status === 'UNKNOWN_OPERATION') {
          const job = await db.lineConversationJob.findUnique({ where: { id: claimRef.jobId }, select: { status: true, version: true, executionMode: true, runtimeOwner: true, executionId: true,
            tenantId: true, businessId: true, accountId: true, account: { select: { runtimeOwner: true } } } })
          if (!job || job.executionMode !== 'SERVER' || job.runtimeOwner !== 'CONVERSATION_RUNTIME'
            || job.account.runtimeOwner !== 'CONVERSATION_RUNTIME' || job.executionId !== claimRef.executionId
            || job.tenantId !== claimRef.tenantId || job.businessId !== claimRef.businessId || job.accountId !== claimRef.accountId) throw error('CONVERSATION_JOB_LEASE_CONFLICT', 409)
          return { status: job.status, version: job.version, operationId: payload.operationId }
        }
        return result
      }
      default: throw error('CONTRACT_OPERATION_INVALID')
    }
  }

  async function handle(request, { operation: routeOperation, health = false } = {}) {
    if (health) {
      if (!authorized(request.headers.get('authorization'), env.CONVERSATION_RUNTIME_TOKEN)) return reply(401, JSON.stringify({ error: 'CORE_CREDENTIAL_REQUIRED' }))
      return reply(env.CONVERSATION_RUNTIME_TOKEN?.length >= 32 ? 200 : 503,
        JSON.stringify({ contractVersion: VERSION, status: env.CONVERSATION_RUNTIME_TOKEN?.length >= 32 ? 'READY' : 'UNAVAILABLE', runtimeOwner: 'CONVERSATION_RUNTIME' }))
    }
    if (!authorized(request.headers.get('authorization'), env.CONVERSATION_RUNTIME_TOKEN)) return reply(401, JSON.stringify({ contractVersion: VERSION, ok: false, error: { code: 'CORE_CREDENTIAL_REQUIRED', retryable: false } }))
    try {
      const raw = await readBoundedJson(request)
      const parsed = envelopeSchema.safeParse(raw)
      if (!parsed.success || parsed.data.operation !== routeOperation) throw error('CONTRACT_ENVELOPE_INVALID')
      const envelope = parsed.data
      exactPayload(envelope.payload, envelope.operation)
      if (Date.parse(envelope.deadlineAt) <= now().getTime() && envelope.operation !== 'status') throw error('CONTRACT_DEADLINE_EXPIRED', 408)
      const data = await operate(envelope)
      validateResult(envelope.operation, data)
      return reply(200, safeResponse(data))
    } catch (cause) {
      const status = Number.isInteger(cause?.status) && cause.status >= 400 && cause.status < 600 ? cause.status : 503
      const candidateCode = cause?.code ?? cause?.message
      const code = typeof candidateCode === 'string' && /^[A-Z0-9_:-]{1,80}$/.test(candidateCode)
        ? candidateCode : 'CORE_OPERATION_UNAVAILABLE'
      return reply(status, JSON.stringify({ contractVersion: VERSION, ok: false,
        error: { code, retryable: status >= 500 || status === 408 } }))
    }
  }

  return Object.freeze({ handle, operate, ownedClaim })
}

function authorized(value, token) {
  if (typeof token !== 'string' || token.length < 32 || typeof value !== 'string') return false
  const expected = Buffer.from(`Bearer ${token}`)
  const actual = Buffer.from(value)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export const conversationRuntimeContractVersion = VERSION
