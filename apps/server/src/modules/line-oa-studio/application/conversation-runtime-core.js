import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import prisma from '@/lib/db'
import { findChannelIdentity, channelIdentityIsVerified } from '@/modules/identity/channel-identity'
import { resolveBusinessModelCredential } from '@/modules/integration/application/model-provider-credential-service'
import { selectRegisteredQuery } from '@/modules/agent/grounded-business-answer'
import { parseLineProjectWorkCommand, searchLineProjectWork, proposeLineWork, confirmLineWork } from '@/modules/agent/line-project-work-tools'
import { serverLinePorts } from './server-line-runtime'
import {
  appendRuntimeConversationTrace, claimRuntimeConversationJob, completeRuntimeConversationJob,
  failRuntimeConversationJob, renewRuntimeConversationJob, runtimeConversationStatus,
  runtimeOperationStatus, sendRuntimeConversationJob,
} from './line-conversation-jobs'

// @req FR-149, FR-171 — authenticated core ownership boundary for the independent runtime.
// @spec ADR-106 D2-D4, SDD-108 — server-derived authority, strict bounded v1 operations.
// @tested tests/integration/conversation-runtime-vertical-slice.test.js
const VERSION = 'conversation-runtime.v1'
const MAX_BODY_BYTES = 64 * 1024
const MAX_RESPONSE_BYTES = 64 * 1024
const identifier = z.string().trim().min(1).max(128)
const claimSchema = z.object({
  jobId: identifier, executionId: identifier, claimantId: identifier,
  version: z.number().int().positive(), tenantId: identifier, businessId: identifier, accountId: identifier,
}).strict()
const envelopeSchema = z.object({
  contractVersion: z.literal(VERSION), operation: z.enum(['claim', 'renew', 'resolve', 'prepare', 'work-tool', 'credential', 'complete', 'fail', 'send', 'trace', 'status']),
  correlationId: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  idempotencyKey: z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/),
  deadlineAt: z.string().datetime({ offset: true }), payload: z.record(z.unknown()).refine(value => Object.keys(value).length <= 32),
}).strict()
const fields = Object.freeze({ claim: ['claimantId'], renew: ['claim'], resolve: ['claim'], prepare: ['claim', 'authorityVersion'],
  'work-tool': ['claim', 'operation', 'operationId', 'input'], credential: ['claim'],
  complete: ['claim', 'text', 'operationId'], fail: ['claim', 'code', 'outcome'], send: ['claim', 'operationId'],
  trace: ['claim', 'kind', 'payload'], status: ['claim', 'operationId'] })
const error = (code, status = 400) => Object.assign(new Error(code), { code, status })
const present = (value, max = 128) => typeof value === 'string' && value.trim().length > 0 && value.length <= max

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
  if (operation === 'trace' && (!present(payload.kind, 80) || !payload.payload || typeof payload.payload !== 'object'
    || Array.isArray(payload.payload) || !boundedJsonWithin(payload.payload, 8 * 1024))) throw error('TRACE_PAYLOAD_INVALID')
}

function safeResponse(data) {
  const value = { contractVersion: VERSION, ok: true, data }
  const body = JSON.stringify(value)
  if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) throw error('CONTRACT_RESPONSE_TOO_LARGE', 500)
  return body
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
    if (!exact(data, ['question', 'evidence', 'slices', 'authorized', 'audienceKind', 'threadId', 'maxBudgetChars', 'workCommand'])
      || !present(data.question, 8000) || !exact(data.evidence, ['records']) || !Array.isArray(data.evidence.records)
      || data.evidence.records.length > 64 || !Array.isArray(data.slices) || data.slices.length > 64
      || typeof data.authorized !== 'boolean' || !['DIRECT', 'GROUP', 'ROOM'].includes(data.audienceKind)
      || (data.threadId !== null && !present(data.threadId, 128))
      || !Number.isInteger(data.maxBudgetChars) || data.maxBudgetChars < 0 || data.maxBudgetChars > 32_000
      || (data.workCommand != null && JSON.stringify(parseLineProjectWorkCommand(data.question)) !== JSON.stringify(data.workCommand))
      || !boundedJsonWithin(data, 32 * 1024)) invalid()
    return
  }
  if (operation === 'resolve') {
    if (!exact(data, ['authorized', 'version', 'scope']) || typeof data.authorized !== 'boolean' || !Number.isInteger(data.version) || data.version < 1
      || !exact(data.scope, ['tenantId', 'businessId', 'accountId', 'identityId', 'identityVersion'])
      || !['tenantId', 'businessId', 'accountId', 'identityId'].every(key => present(data.scope[key], 128))
      || !Number.isInteger(data.scope.identityVersion) || data.scope.identityVersion < 1) invalid()
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
      || !['RECORDED', 'ACCEPTED', 'UNKNOWN', 'FAILED', 'CANCELLED', 'CONTENDED', 'FENCED', 'STOPPED', 'READY', 'SENDING'].includes(data.status)
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
    if (!['COMPLETED', 'NOT_FOUND'].includes(data?.status)
      || Buffer.byteLength(JSON.stringify(data), 'utf8') > 32 * 1024) invalid()
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

function reply(status, body) {
  return new Response(body, { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}

export function createConversationRuntimeCore({ db = prisma, env = process.env, now = () => new Date(),
  prepareTurn = null, credentialResolver = null, linePorts = serverLinePorts, claim = claimRuntimeConversationJob,
  renew = renewRuntimeConversationJob, complete = completeRuntimeConversationJob, fail = failRuntimeConversationJob,
  readStatus = runtimeConversationStatus, operationStatus = runtimeOperationStatus,
  send = sendRuntimeConversationJob, appendTrace = appendRuntimeConversationTrace,
  workSearch = searchLineProjectWork, workPropose = proposeLineWork, workConfirm = confirmLineWork } = {}) {
  let businessPortsPromise
  const getBusinessPorts = async () => {
    if (!businessPortsPromise) {
      businessPortsPromise = import('@/modules/agent/phase1-runtime').then(({ createPhase1BusinessAgentPortsFromEnv }) =>
        createPhase1BusinessAgentPortsFromEnv(env, { bindingRequired: false }))
      businessPortsPromise.catch(() => { businessPortsPromise = null })
    }
    return businessPortsPromise
  }
  const resolveCredential = credentialResolver ?? (async job => {
    const credential = await resolveBusinessModelCredential({ tenantId: job.tenantId, businessId: job.businessId }, { db, env })
    if (!credential?.apiKey) throw error('MODEL_CREDENTIAL_NOT_RESOLVABLE', 503)
    return { provider: credential.provider, model: credential.model, apiKey: credential.apiKey,
      ...(credential.baseUrl ? { baseUrl: credential.baseUrl } : {}) }
  })
  const prepare = prepareTurn ?? (async job => {
    const question = job.inbound?.body
    const workCommand = parseLineProjectWorkCommand(question)
    if (workCommand) return { question, evidence: { records: [] }, slices: [], authorized: true,
      audienceKind: job.audienceKind, threadId: null, maxBudgetChars: 0, workCommand }
    if (job.account.knowledgeGrounding !== 'BUSINESS_KNOWLEDGE') throw error('RUNTIME_GROUNDING_MODE_NOT_SUPPORTED', 409)
    const ports = await getBusinessPorts()
    if (!ports?.businessKnowledge?.query) throw error('RUNTIME_KNOWLEDGE_UNAVAILABLE', 503)
    const query = selectRegisteredQuery(question)
    const evidence = await ports.businessKnowledge.query({ tenantId: job.tenantId, businessId: job.businessId, ...query })
    const result = { question, evidence: { records: Array.isArray(evidence?.records) ? evidence.records : [] },
      slices: [], authorized: true, audienceKind: job.audienceKind, threadId: null, maxBudgetChars: 0, workCommand: null }
    if (Buffer.byteLength(JSON.stringify(result.evidence), 'utf8') > 32 * 1024) throw error('TURN_EVIDENCE_TOO_LARGE', 413)
    return result
  })

  async function ownedClaim(ref, { status = 'CLAIMED', checkLease = true } = {}) {
    const job = await db.lineConversationJob.findUnique({ where: { id: ref.jobId },
      include: { account: true, inbound: { include: { conversation: true } } } })
    if (!job || job.executionMode !== 'SERVER' || job.runtimeOwner !== 'CONVERSATION_RUNTIME'
      || job.executionId !== ref.executionId
      || job.tenantId !== ref.tenantId || job.businessId !== ref.businessId || job.accountId !== ref.accountId
      || !['CLAIMED', 'READY'].includes(status) || job.status !== status
      || (status === 'CLAIMED' && (job.version !== ref.version || job.claimantId !== ref.claimantId))
      || job.memorySyncOptIn || job.errorCode === 'PDPA_ERASURE' || job.audienceKind !== 'DIRECT'
      || job.recipientId !== job.sourceUserId || !job.inbound?.conversation
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
    const identity = await findChannelIdentity({ db, tenantId: job.tenantId,
      channelAccountId: job.channelAccountId, providerSubject: job.sourceUserId })
    if (!channelIdentityIsVerified(identity)) throw error('CONVERSATION_IDENTITY_REVOKED', 403)
    return { job, identity }
  }

  async function workOperation(ref, request) {
    const { job } = await ownedClaim(ref)
    const expectedClaim = { ...ref, executionMode: 'SERVER', runtimeOwner: 'CONVERSATION_RUNTIME' }
    const input = request.input
    if (request.operation === 'read') {
      const result = await workSearch(job.id, input, { db, now, expectedClaim })
      const text = result.items.length ? result.items.map(item => `${item.code}: ${item.title ?? item.name} — ${item.status}`).join('\n')
        : 'ไม่พบรายการในธุรกิจที่คุณมีสิทธิ์เข้าถึง'
      return { status: 'COMPLETED', result: { text, receipt: { source: result.source, observedAt: result.observedAt } } }
    }
    if (request.operation === 'propose') {
      const proposal = await workPropose(job.id, input, { db, now, expectedClaim })
      const preview = proposal.preview
      return { status: 'COMPLETED', result: { text: `รอยืนยันการเปลี่ยนแปลงงาน\nเป้าหมาย: ${preview.target.title}\n${JSON.stringify(preview.args)}\nหมดอายุ ${preview.expiresAt}\nพิมพ์ ยืนยันงาน ${proposal.proposalId}`,
        receipt: { proposalId: proposal.proposalId, status: 'AWAITING_CONFIRMATION' } } }
    }
    if (request.operation === 'confirm-execute') {
      const proposalId = input.proposalId
      if (!present(proposalId, 128) || request.operationId !== proposalId) throw error('WORK_CONFIRMATION_IDENTITY_INVALID')
      const result = await workConfirm(job.id, proposalId, { db, now, expectedClaim })
      return { status: 'COMPLETED', result: { text: result.duplicate ? 'คำสั่งนี้ยืนยันและดำเนินการแล้ว ไม่มีการทำซ้ำ' : `บันทึกงาน ${result.code} แล้ว สถานะ ${result.status}`,
        receipt: result } }
    }
    const proposalId = typeof input.proposalId === 'string' ? input.proposalId : request.operationId
    if (request.operationId === `${job.id}:work-proposal`) {
      const proposed = await db.auditEvent.findUnique({ where: { id: job.id } })
      if (proposed?.entityType === 'LINE_WORK_PROPOSAL') {
        const saved = JSON.parse(proposed.payloadJson)
        return { status: 'COMPLETED', result: { text: `รอยืนยันการเปลี่ยนแปลงงาน\nเป้าหมาย: ${saved.target.title}\n${JSON.stringify(saved.args)}\nหมดอายุ ${saved.expiresAt}\nพิมพ์ ยืนยันงาน ${job.id}`,
          receipt: { proposalId: job.id, status: 'AWAITING_CONFIRMATION' } } }
      }
      return { status: 'NOT_FOUND', operationId: request.operationId }
    }
    const resultRow = await db.auditEvent.findUnique({ where: { id: `line-work-result:${proposalId}` } })
    if (resultRow) return { status: 'COMPLETED', result: { text: 'คำสั่งนี้ยืนยันและดำเนินการแล้ว ไม่มีการทำซ้ำ', receipt: JSON.parse(resultRow.payloadJson) } }
    const proposal = await db.auditEvent.findUnique({ where: { id: proposalId } })
    if (proposal?.entityType === 'LINE_WORK_PROPOSAL') return { status: 'NOT_FOUND', proposalId, receipt: { status: 'AWAITING_CONFIRMATION' } }
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
        const { job, identity } = await ownedClaim(claimRef)
        return { authorized: true, version: job.version, scope: { tenantId: job.tenantId,
          businessId: job.businessId, accountId: job.accountId, identityId: identity.id, identityVersion: identity.version } }
      }
      case 'prepare': {
        const { job } = await ownedClaim(claimRef)
        if (payload.authorityVersion !== job.version) throw error('CONVERSATION_AUTHORITY_STALE', 409)
        return prepare(job)
      }
      case 'credential': {
        const { job } = await ownedClaim(claimRef)
        return resolveCredential(job)
      }
      case 'work-tool': return workOperation(claimRef, payload)
      case 'complete': {
        await ownedClaim(claimRef)
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
        await ownedClaim(claimRef, { status: payload.kind === 'ANSWER_READY' ? 'READY' : 'CLAIMED', checkLease: false })
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
