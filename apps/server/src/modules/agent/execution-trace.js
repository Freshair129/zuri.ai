import { createHash } from 'node:crypto'
import { z } from 'zod'
import { inspectMemoryWriteLink } from './memory-trace-contract'

// @req FR-149, FR-171 — one append-only, scope-bound journal for an admitted agent turn.
// @spec ADR-061, ADR-070, SEC-001 — the journal stores bounded data snapshots only; it never
// executes tools, replays side effects, or carries provider credentials.
// @tested tests/integration/execution-trace.test.js

/**
 * The event vocabulary is deliberately small. New event kinds are a contract change:
 * callers must add one here before they can write a row. `OUTBOUND_RECORDED` links the
 * accepted CRM Message to delivery evidence without creating another trace table.
 */
export const TRACE_EVENT_KINDS = Object.freeze([
  'TURN_RECEIVED',
  'EXECUTION_STARTED',
  'CONTEXT_COMMITTED',
  'EVIDENCE_SELECTED',
  'MODEL_COMPLETED',
  'MODEL_FAILED',
  'ANSWER_READY',
  'EXECUTION_FAILED',
  'SEND_STARTED',
  'SEND_RESULT',
  'OUTBOUND_RECORDED',
  'TOOL_INVOKED',
  'TOOL_RESULT',
  'ACTION_STARTED',
  'ACTION_RESULT',
  'MEMORY_WRITTEN',
  'ARTIFACT_CREATED',
  'RETENTION_TOMBSTONE',
])

export const zTraceEventKind = z.enum(TRACE_EVENT_KINDS)

export const MAX_TRACE_PAYLOAD_BYTES = 1024 * 1024
export const MAX_TRACE_IDEMPOTENCY_KEY_LENGTH = 512
export const MAX_TRACE_IDENTIFIER_LENGTH = 512
export const MAX_TRACE_EVENTS_PER_READ = 256
export const MAX_TRACE_READ_BYTES = 8 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SECRET_FIELD_NAMES = new Set([
  'replytoken',
  'credential',
  'credentials',
  'authorization',
  'authorisation',
  'password',
  'passwd',
  'secret',
  'clientsecret',
  'channelsecret',
  'webhooksecret',
  'apikey',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'bearertoken',
  'token',
])

const FAILURE_KINDS = new Set(['MODEL_FAILED', 'EXECUTION_FAILED'])
const FAILURE_STATUS = new Set(['FAILED', 'FAILURE', 'ERROR', 'ERRORED', 'REJECTED'])
const REDACTED_PAYLOAD_JSON = '{"redacted":true}'

function traceError(code, message, status = 400) {
  const error = new Error(`${code}: ${message}`)
  error.code = code
  error.status = status
  return error
}

function requiredText(value, label, { max = MAX_TRACE_IDENTIFIER_LENGTH } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw traceError('EXECUTION_TRACE_INPUT_INVALID', `${label} must be a non-empty string`)
  }
  if (value.length > max) {
    throw traceError('EXECUTION_TRACE_INPUT_INVALID', `${label} exceeds ${max} characters`)
  }
  return value
}

function requiredUuid(value, label) {
  const text = requiredText(value, label, { max: 36 })
  if (!UUID.test(text)) throw traceError('EXECUTION_TRACE_INPUT_INVALID', `${label} must be a UUID`)
  return text
}

function normalizeScope(scope) {
  if (!scope || typeof scope !== 'object') {
    throw traceError('EXECUTION_TRACE_SCOPE_REQUIRED', 'scope is required')
  }
  return {
    tenantId: requiredUuid(scope.tenantId, 'scope.tenantId'),
    businessId: requiredUuid(scope.businessId, 'scope.businessId'),
  }
}

function normalizeExecutionId(value) {
  if (value === undefined || value === null) return null
  return requiredUuid(value, 'executionId')
}

function normalizeOccurredAt(value) {
  if (value === undefined || value === null) return new Date()
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw traceError('EXECUTION_TRACE_INPUT_INVALID', 'occurredAt must be a valid date')
  }
  return date
}

function normalizedSecretFieldName(key) {
  return key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

function assertSafeJson(value, path = 'payload', seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw traceError('EXECUTION_TRACE_PAYLOAD_INVALID', `${path} contains a non-finite number`)
    }
    return
  }
  if (typeof value !== 'object') {
    throw traceError('EXECUTION_TRACE_PAYLOAD_INVALID', `${path} is not JSON data`)
  }
  if (seen.has(value)) {
    throw traceError('EXECUTION_TRACE_PAYLOAD_INVALID', `${path} contains a cycle`)
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null && !Array.isArray(value)) {
    throw traceError('EXECUTION_TRACE_PAYLOAD_INVALID', `${path} contains a non-plain object`)
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw traceError('EXECUTION_TRACE_PAYLOAD_INVALID', `${path} contains symbol keys`)
  }

  seen.add(value)
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      assertSafeJson(value[index], `${path}[${index}]`, seen)
    }
  } else {
    for (const key of Object.keys(value)) {
      if (SECRET_FIELD_NAMES.has(normalizedSecretFieldName(key))) {
        throw traceError('EXECUTION_TRACE_SECRET_FIELD', `${path}.${key} is not allowed in a trace payload`)
      }
      assertSafeJson(value[key], `${path}.${key}`, seen)
    }
  }
  seen.delete(value)
}

/**
 * Stable JSON for hashes and persisted payloads. Object keys are sorted at every
 * depth; array order remains meaningful. This intentionally accepts JSON data only.
 */
export function canonicalJson(value) {
  assertSafeJson(value)

  function encode(input) {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return JSON.stringify(input)
    if (typeof input === 'number') return JSON.stringify(input)
    if (Array.isArray(input)) return `[${input.map(encode).join(',')}]`
    return `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${encode(input[key])}`).join(',')}}`
  }

  return encode(value)
}

/** SHA-256 of a string, or of its stable canonical JSON representation. */
export function sha256(value) {
  const source = typeof value === 'string' ? value : canonicalJson(value)
  return createHash('sha256').update(source, 'utf8').digest('hex')
}

function serializePayload(payload) {
  const payloadJson = canonicalJson(payload)
  const bytes = Buffer.byteLength(payloadJson, 'utf8')
  if (bytes > MAX_TRACE_PAYLOAD_BYTES) {
    throw traceError('EXECUTION_TRACE_PAYLOAD_TOO_LARGE', `payload exceeds ${MAX_TRACE_PAYLOAD_BYTES} bytes`)
  }
  return payloadJson
}

function normalizeInput(input) {
  if (!input || typeof input !== 'object') {
    throw traceError('EXECUTION_TRACE_INPUT_INVALID', 'event input is required')
  }
  const scope = normalizeScope(input.scope)
  const turnId = requiredUuid(input.turnId, 'turnId')
  const kind = zTraceEventKind.safeParse(input.kind)
  if (!kind.success) throw traceError('EXECUTION_TRACE_KIND_INVALID', 'kind is not a supported trace event kind')
  const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey', { max: MAX_TRACE_IDEMPOTENCY_KEY_LENGTH })
  if (!Object.prototype.hasOwnProperty.call(input, 'payload')) {
    throw traceError('EXECUTION_TRACE_PAYLOAD_INVALID', 'payload is required')
  }
  const payloadJson = serializePayload(input.payload)
  return {
    ...scope,
    turnId,
    executionId: normalizeExecutionId(input.executionId),
    kind: kind.data,
    idempotencyKey,
    payloadJson,
    occurredAt: normalizeOccurredAt(input.occurredAt),
  }
}

function assertTraceModel(db) {
  const model = db?.agentTraceEvent
  if (!model || typeof model.create !== 'function' || typeof model.findMany !== 'function') {
    throw traceError('EXECUTION_TRACE_MODEL_UNAVAILABLE', 'Prisma AgentTraceEvent model is not available', 500)
  }
  return model
}

function isUniqueConflict(error) {
  return error?.code === 'P2002' || /unique constraint/i.test(String(error?.message ?? ''))
}

function scopeMatches(row, scope) {
  return row?.tenantId === scope.tenantId && row?.businessId === scope.businessId
}

function assertRowScope(row, scope) {
  if (!scopeMatches(row, scope)) {
    throw traceError('EXECUTION_TRACE_SCOPE_MISMATCH', 'trace row resolved outside the requested tenant/business scope', 403)
  }
}

function assertExistingMatches(existing, input) {
  assertRowScope(existing, input)
  let samePayload = existing.payloadJson === input.payloadJson
  if (!samePayload && typeof existing.payloadJson === 'string') {
    try {
      samePayload = canonicalJson(JSON.parse(existing.payloadJson)) === input.payloadJson
    } catch {
      samePayload = false
    }
  }
  const sameIdentity = existing.turnId === input.turnId
    && existing.kind === input.kind
    && (existing.executionId ?? null) === input.executionId
  if (!samePayload || !sameIdentity) {
    throw traceError('EXECUTION_TRACE_IDEMPOTENCY_CONFLICT', 'idempotency key was reused with different trace data', 409)
  }
  return existing
}

async function findByIdempotency(model, input) {
  if (typeof model.findFirst !== 'function') return null
  return model.findFirst({
    where: {
      tenantId: input.tenantId,
      businessId: input.businessId,
      idempotencyKey: input.idempotencyKey,
    },
  })
}

/**
 * Lock the optional LineConversationJob row before a new event is written. The
 * conditional update is intentionally a no-op on version: workers use version for
 * lease CAS, so journalling must never advance or reset that counter. A missing job
 * means this is another kind of turn and is allowed. A PDPA-erased job is closed.
 */
async function assertTraceTurnOpen(db, input) {
  const jobs = db?.lineConversationJob
  if (!jobs || typeof jobs.findUnique !== 'function') return

  const select = { tenantId: true, businessId: true, errorCode: true, executionId: true }
  const job = await jobs.findUnique({ where: { id: input.turnId }, select })
  if (!job) return
  if (job.tenantId !== input.tenantId || job.businessId !== input.businessId) {
    throw traceError('EXECUTION_TRACE_SCOPE_MISMATCH', 'turn resolved outside the requested tenant/business scope', 403)
  }
  if (job.errorCode === 'PDPA_ERASURE') {
    throw traceError('EXECUTION_TRACE_TURN_REDACTED', 'trace writes are closed after PDPA erasure', 409)
  }
  if (typeof jobs.updateMany !== 'function') return

  const result = await jobs.updateMany({
    where: {
      id: input.turnId,
      tenantId: input.tenantId,
      businessId: input.businessId,
      OR: [{ errorCode: null }, { errorCode: { not: 'PDPA_ERASURE' } }],
    },
    // This preserves the worker lease version and never lets a stale callback
    // overwrite the job's current execution id. Updating the same primary key is
    // the smallest Prisma-supported row lock with no business-field mutation.
    data: { id: input.turnId },
  })
  if (result?.count === 1) return

  const current = await jobs.findUnique({ where: { id: input.turnId }, select })
  if (current?.errorCode === 'PDPA_ERASURE') {
    throw traceError('EXECUTION_TRACE_TURN_REDACTED', 'trace writes are closed after PDPA erasure', 409)
  }
  if (current) {
    throw traceError('EXECUTION_TRACE_TURN_LOCK_FAILED', 'trace turn could not be locked for append', 409)
  }
}

async function appendTraceEventInternal(db, input, { bypassTurnGuard = false, retryOnUnique = true } = {}) {
  const model = assertTraceModel(db)
  const normalized = normalizeInput(input)
  if (!bypassTurnGuard) await assertTraceTurnOpen(db, normalized)
  if (!bypassTurnGuard) {
    const tombstone = await model.findFirst({
      where: { tenantId: normalized.tenantId, businessId: normalized.businessId, turnId: normalized.turnId, kind: 'RETENTION_TOMBSTONE' },
    })
    if (tombstone) {
      throw traceError('EXECUTION_TRACE_TURN_REDACTED', 'trace writes are closed after retention', 409)
    }
  }
  const existing = await findByIdempotency(model, normalized)
  if (existing) return assertExistingMatches(existing, normalized)

  if (normalized.kind === 'MEMORY_WRITTEN') {
    const parents = await readExecutionTrace(db, { scope: normalized, turnId: normalized.turnId })
    const link = inspectMemoryWriteLink(normalized, parents, { verifyContext: verifyContextPayload, digest: sha256 })
    if (link.reasons.length) {
      throw traceError('MEMORY_TRACE_LINK_INVALID', link.reasons.join(', '), 409)
    }
  }

  const data = {
    tenantId: normalized.tenantId,
    businessId: normalized.businessId,
    turnId: normalized.turnId,
    executionId: normalized.executionId,
    kind: normalized.kind,
    idempotencyKey: normalized.idempotencyKey,
    payloadJson: normalized.payloadJson,
    occurredAt: normalized.occurredAt,
  }
  try {
    const created = await model.create({ data })
    assertRowScope(created, normalized)
    return created
  } catch (error) {
    if (!isUniqueConflict(error)) throw error
    if (!retryOnUnique) throw error
    // The composite unique key is the concurrency boundary. The winner's row is
    // returned only after the same payload and event identity are rechecked.
    const winner = await findByIdempotency(model, normalized)
    if (!winner) throw error
    return assertExistingMatches(winner, normalized)
  }
}

/**
 * Append one immutable event. Pass a Prisma transaction client here to make the
 * journal part of the caller's transaction; this function does not open a nested
 * transaction, which SQLite and transaction poolers cannot safely support.
 *
 * `bypassTurnGuard` skips the turn-open lock, the retention-tombstone check and
 * the idempotency read (2026-09-09, PERF). It is safe ONLY for a caller that just
 * created `turnId` in the same still-open transaction and is writing that turn's
 * very first event: no other writer can have touched a row that did not exist a
 * moment ago, so every one of those reads is guaranteed to come back negative.
 * It stays `false` for every other call — a turn that already exists needs the
 * real guard, because a concurrent retention/erasure run is exactly what it
 * catches. Default preserves prior behavior for every existing caller.
 */
export async function appendTraceEvent(db, input, { bypassTurnGuard = false } = {}) {
  if (typeof db?.$transaction === 'function') {
    try {
      return await db.$transaction((tx) => appendTraceEventInternal(tx, input, { bypassTurnGuard, retryOnUnique: false }))
    } catch (error) {
      // A PostgreSQL transaction that loses a unique race is aborted; resolve the
      // winner only after Prisma has rolled that transaction back.
      if (!isUniqueConflict(error)) throw error
      const normalized = normalizeInput(input)
      const winner = await findByIdempotency(db.agentTraceEvent, normalized)
      if (!winner) throw error
      return assertExistingMatches(winner, normalized)
    }
  }
  // A transaction client has no $transaction method. Let a unique conflict
  // propagate so its caller can retry the whole transaction; a PostgreSQL
  // transaction is unusable after P2002 and cannot safely query the winner.
  return appendTraceEventInternal(db, input, { bypassTurnGuard, retryOnUnique: false })
}

function parseStoredPayload(row) {
  if (Object.prototype.hasOwnProperty.call(row, 'payload') && row.payload !== undefined) return row.payload
  try {
    return JSON.parse(row.payloadJson)
  } catch {
    throw traceError('EXECUTION_TRACE_PAYLOAD_INVALID', `event ${row.id ?? '<unknown>'} has invalid payload JSON`, 500)
  }
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) deepFreeze(child, seen)
  return Object.freeze(value)
}

function immutableEvent(row, scope) {
  assertRowScope(row, scope)
  const payload = deepFreeze(parseStoredPayload(row))
  return Object.freeze({ ...row, payload })
}

/**
 * Read one turn with both scope columns in the predicate and rechecked on every
 * returned row. Authorization belongs to the trusted API caller; this boundary
 * proves only that a caller cannot accidentally read another tenant/business row.
 */
export async function readExecutionTrace(db, { scope, turnId } = {}) {
  const model = assertTraceModel(db)
  const normalizedScope = normalizeScope(scope)
  const normalizedTurnId = requiredUuid(turnId, 'turnId')
  const rows = await model.findMany({
    where: { ...normalizedScope, turnId: normalizedTurnId },
    orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_TRACE_EVENTS_PER_READ + 1,
  })
  if (rows.length > MAX_TRACE_EVENTS_PER_READ) {
    throw traceError('EXECUTION_TRACE_READ_LIMIT', `trace exceeds ${MAX_TRACE_EVENTS_PER_READ} events`, 413)
  }
  let bytes = 0
  for (const row of rows) {
    bytes += Buffer.byteLength(String(row.payloadJson ?? ''), 'utf8')
    if (bytes > MAX_TRACE_READ_BYTES) {
      throw traceError('EXECUTION_TRACE_READ_LIMIT', `trace exceeds ${MAX_TRACE_READ_BYTES} bytes`, 413)
    }
  }
  return Object.freeze(rows.map((row) => immutableEvent(row, normalizedScope)))
}

const zManifestRef = z.union([
  z.string().min(1).max(MAX_TRACE_IDENTIFIER_LENGTH),
  z.null(),
])

/** Public references that identify the exact context inputs used by a model call. */
export const zContextManifest = z.object({
  memoryVersion: zManifestRef.optional(),
  docVersion: zManifestRef.optional(),
  artifactVersion: zManifestRef.optional(),
  retrievalRun: zManifestRef.optional(),
  soul: zManifestRef.optional(),
  systemPrompt: zManifestRef.optional(),
}).strict()

export function validateContextManifest(value) {
  const parsed = zContextManifest.parse(value)
  assertSafeJson(parsed, 'contextManifest')
  return parsed
}

function verifyContextPayload(payload, reasons) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    reasons.push('CONTEXT_MISSING')
    return false
  }
  let valid = true
  if (payload.contextManifest !== undefined) {
    try {
      validateContextManifest(payload.contextManifest)
    } catch {
      reasons.push('CONTEXT_MANIFEST_INVALID')
      valid = false
    }
  }
  const hasRequestBody = Object.prototype.hasOwnProperty.call(payload, 'requestBody')
  const hasRequestHash = typeof payload.requestHash === 'string' && payload.requestHash.length > 0
  if (!hasRequestBody || !hasRequestHash) {
    reasons.push('CONTEXT_HASH_MISSING')
    return false
  }
  let stableHash
  try {
    stableHash = sha256(payload.requestBody)
  } catch {
    reasons.push('CONTEXT_REQUEST_INVALID')
    return false
  }
  if (payload.requestHash !== stableHash) {
    reasons.push('CONTEXT_HASH_MISMATCH')
    return false
  }
  return valid
}

function eventFailure(event, payload) {
  if (FAILURE_KINDS.has(event.kind)) return true
  if (payload && typeof payload === 'object') {
    if (typeof payload.errorCode === 'string' && payload.errorCode) return true
    if (payload.ok === false) return true
    if (FAILURE_STATUS.has(String(payload.status ?? '').toUpperCase())) return true
    if (event.kind === 'SEND_RESULT' && ['REJECTED', 'FAILED', 'ERROR'].includes(String(payload.providerAcceptance ?? '').toUpperCase())) return true
  }
  return false
}

/**
 * Reconstruct read-only model contexts and outputs grouped by execution and handle.
 * The function is intentionally data-only: no executor, tool handler, provider, or
 * callback is ever invoked. Any missing/invalid context, hash mismatch, failure, or
 * retention tombstone marks the affected execution incomplete and withholds that
 * call's output. A successful retry remains inspectable beside a failed attempt.
 */
export function playbackTrace(events) {
  const list = Array.isArray(events) ? events : events?.events
  if (!Array.isArray(list)) throw traceError('EXECUTION_TRACE_INPUT_INVALID', 'playbackTrace requires an event array')

  const executions = new Map()
  const globalReasons = []
  if (list.length === 0) globalReasons.push('TRACE_MISSING')
  let globalTombstone = false

  function executionFor(event, index, payload = null) {
    const executionId = event.executionId ?? payload?.executionId ?? null
    const key = executionId ?? '__unscoped__'
    let execution = executions.get(key)
    if (!execution) {
      execution = {
        executionId,
        contexts: new Map(),
        calls: new Map(),
        reasons: [],
        failed: false,
        eventCount: 0,
      }
      executions.set(key, execution)
    }
    execution.eventCount += 1
    return execution
  }

  function addReason(target, reason) {
    if (!target.reasons.includes(reason)) target.reasons.push(reason)
  }

  function callFor(execution, payload, event, index, kind) {
    const ctxId = payload?.ctxId ?? payload?.contextId ?? null
    const modelCallId = payload?.modelCallId ?? null
    const key = modelCallId ?? (ctxId ? `ctx:${ctxId}` : `${kind.toLowerCase()}:${event.id ?? index}`)
    let call = execution.calls.get(key)
    if (!call) {
      call = {
        key,
        executionId: execution.executionId,
        ctxId,
        modelCallId,
        kind,
        context: null,
        output: null,
        hasOutput: false,
        reasons: [],
        failed: false,
      }
      execution.calls.set(key, call)
    }
    if (ctxId && !call.ctxId) call.ctxId = ctxId
    if (modelCallId && !call.modelCallId) call.modelCallId = modelCallId
    if (kind === 'MODEL_COMPLETED' || kind === 'ANSWER_READY') {
      if (call.hasOutput && canonicalJson(call.output) !== canonicalJson(payload)) {
        call.failed = true
        addReason(call, 'MODEL_OUTPUT_CONFLICT')
      } else {
        call.output = payload
        call.hasOutput = true
      }
    }
    if (kind === 'MODEL_FAILED') {
      call.failed = true
      addReason(call, 'MODEL_FAILED')
      if (payload?.errorCode) addReason(call, `MODEL_FAILED:${payload.errorCode}`)
    }
    if (eventFailure(event, payload)) call.failed = true
    return call
  }

  list.forEach((event, index) => {
    if (!event || typeof event !== 'object') {
      globalReasons.push('EVENT_INVALID')
      return
    }
    let payload
    try {
      payload = parseStoredPayload(event)
    } catch {
      globalReasons.push('PAYLOAD_INVALID')
      return
    }
    const execution = executionFor(event, index, payload)
    if (event.kind === 'RETENTION_TOMBSTONE') {
      globalTombstone = true
      execution.failed = true
      addReason(execution, 'RETENTION_TOMBSTONE')
      return
    }
    if (eventFailure(event, payload)) {
      execution.failed = true
      addReason(execution, event.kind === 'EXECUTION_FAILED' ? 'EXECUTION_FAILED' : (payload?.errorCode ? `EVENT_FAILED:${payload.errorCode}` : 'EVENT_FAILED'))
    }
    if (event.kind === 'CONTEXT_COMMITTED') {
      const ctxId = payload?.ctxId ?? payload?.contextId ?? null
      const contextReasons = []
      const valid = Boolean(ctxId) && verifyContextPayload(payload, contextReasons)
      if (!ctxId) contextReasons.push('CONTEXT_ID_MISSING')
      const contextKey = ctxId ?? `context:${event.id ?? index}`
      const existing = execution.contexts.get(contextKey)
      if (existing && canonicalJson(existing.payload) !== canonicalJson(payload)) {
        existing.valid = false
        addReason(existing, 'CONTEXT_SNAPSHOT_CONFLICT')
      } else if (!existing) {
        execution.contexts.set(contextKey, {
          ctxId,
          modelCallId: payload?.modelCallId ?? null,
          payload,
          valid,
          reasons: contextReasons,
        })
      }
      if (!valid || contextReasons.length > 0) execution.failed = true
    }
    if (event.kind === 'MODEL_COMPLETED' || event.kind === 'MODEL_FAILED' || event.kind === 'ANSWER_READY') {
      callFor(execution, payload, event, index, event.kind)
    }
    if (event.kind === 'EXECUTION_FAILED' && (payload?.ctxId || payload?.contextId || payload?.modelCallId)) {
      callFor(execution, payload, event, index, event.kind)
    }
  })

  const modelCalls = []
  for (const execution of executions.values()) {
    // A context is a promise that a model call will either complete or fail. Add a
    // missing-output call so a truncated journal cannot appear replayable.
    for (const context of execution.contexts.values()) {
      const linked = [...execution.calls.values()].find((call) =>
        (context.modelCallId && call.modelCallId === context.modelCallId)
        || (context.ctxId && call.ctxId === context.ctxId),
      )
      if (!linked) {
        const call = {
          key: context.modelCallId ?? `ctx:${context.ctxId}`,
          executionId: execution.executionId,
          ctxId: context.ctxId,
          modelCallId: context.modelCallId,
          kind: 'CONTEXT_COMMITTED',
          context: null,
          output: null,
          hasOutput: false,
          reasons: ['MODEL_OUTPUT_MISSING'],
          failed: true,
        }
        execution.calls.set(call.key, call)
      }
    }

    const immutableCalls = []
    for (const call of execution.calls.values()) {
      const contextKey = call.ctxId ?? (call.modelCallId ? `context:${call.modelCallId}` : null)
      const context = contextKey ? execution.contexts.get(contextKey) : null
      if (call.kind === 'ANSWER_READY' && !call.ctxId) {
        // Deterministic/local answers have no model context by design.
      } else if (!context) {
        call.failed = true
        addReason(call, 'CONTEXT_MISSING')
      } else {
        call.context = context
        if (!context.valid) {
          call.failed = true
          for (const reason of context.reasons) addReason(call, reason)
        }
        if (context.modelCallId && call.modelCallId && context.modelCallId !== call.modelCallId) {
          call.failed = true
          addReason(call, 'MODEL_CONTEXT_MISMATCH')
        }
      }
      if (call.kind === 'MODEL_COMPLETED') {
        if (!call.modelCallId || !call.ctxId) {
          call.failed = true
          addReason(call, 'MODEL_HANDLE_MISSING')
        }
        if (!call.hasOutput) {
          call.failed = true
          addReason(call, 'MODEL_OUTPUT_MISSING')
        }
      }
      if (globalTombstone) {
        call.failed = true
        addReason(call, 'RETENTION_TOMBSTONE')
      }
      const status = call.failed || call.reasons.length > 0 ? 'REPLAY_INCOMPLETE' : 'REPLAY_COMPLETE'
      if (status === 'REPLAY_INCOMPLETE') execution.failed = true
      const callDto = {
        executionId: call.executionId,
        ctxId: call.ctxId,
        modelCallId: call.modelCallId,
        kind: call.kind,
        status,
        reasons: Object.freeze([...new Set(call.reasons)]),
        context: status === 'REPLAY_COMPLETE' && call.context ? call.context.payload : null,
        output: status === 'REPLAY_COMPLETE' && call.hasOutput ? call.output : null,
      }
      immutableCalls.push(deepFreeze(callDto))
      modelCalls.push(immutableCalls[immutableCalls.length - 1])
    }
    execution.modelCalls = immutableCalls
    if (execution.executionId && immutableCalls.length === 0) {
      execution.failed = true
      addReason(execution, 'EXECUTION_OUTPUT_MISSING')
    }
    execution.status = execution.failed ? 'REPLAY_INCOMPLETE' : 'REPLAY_COMPLETE'
    execution.reasons = [...new Set(execution.reasons)]
  }

  const memoryWrites = []
  if (!globalTombstone) {
    for (const event of list) {
      if (event?.kind !== 'MEMORY_WRITTEN') continue
      const link = inspectMemoryWriteLink(event, list, { verifyContext: verifyContextPayload, digest: sha256 })
      const reasons = [...link.reasons]
      if (link.payload) {
        if (link.payload.receipt.status !== 'ACKNOWLEDGED') reasons.push('MEMORY_RECEIPT_INCOMPLETE')
        // API-009 acknowledges an upsert; it does not attest a replayable MSP session.
        reasons.push('MSP_SESSION_AUTHORITY_UNAVAILABLE')
      }
      globalReasons.push(...reasons)
      const execution = executions.get(event.executionId ?? '__unscoped__')
      if (execution && reasons.length) {
        execution.failed = true
        execution.status = 'REPLAY_INCOMPLETE'
        for (const reason of reasons) addReason(execution, reason)
      }
      memoryWrites.push({ eventId: event.id ?? null, executionId: event.executionId ?? null,
        status: 'REPLAY_INCOMPLETE', reasons,
        evidence: link.reasons.length ? null : link.payload })
    }
  }

  const executionsDto = [...executions.values()].map((execution) => deepFreeze({
    executionId: execution.executionId,
    status: execution.status,
    eventCount: execution.eventCount,
    reasons: Object.freeze([...execution.reasons]),
    modelCalls: Object.freeze(execution.modelCalls),
  }))
  const deliveries = new Map()
  if (!globalTombstone) {
    for (const event of list) {
      if (!['SEND_STARTED', 'SEND_RESULT'].includes(event?.kind)) continue
      let payload
      try { payload = parseStoredPayload(event) } catch { continue }
      const attemptId = payload?.sendAttemptId
      if (!attemptId) { globalReasons.push('SEND_ATTEMPT_ID_MISSING'); continue }
      const attempt = deliveries.get(attemptId) ?? { sendAttemptId: attemptId, started: null, result: null }
      if (event.kind === 'SEND_STARTED') attempt.started = payload
      else attempt.result = payload
      deliveries.set(attemptId, attempt)
    }
    for (const attempt of deliveries.values()) {
      attempt.status = attempt.started && attempt.result ? 'REPLAY_COMPLETE' : 'REPLAY_INCOMPLETE'
      if (!attempt.started) globalReasons.push('SEND_INTENT_MISSING')
      if (!attempt.result) globalReasons.push('SEND_OUTCOME_MISSING')
    }
  }
  const overallReasons = [...new Set([
    ...globalReasons,
    ...executionsDto.flatMap((execution) => execution.reasons),
    ...modelCalls.flatMap((call) => call.reasons),
  ])]
  const overallIncomplete = overallReasons.length > 0 || executionsDto.some((execution) => execution.status === 'REPLAY_INCOMPLETE')
  const status = overallIncomplete ? 'REPLAY_INCOMPLETE' : 'REPLAY_COMPLETE'
  const completeCalls = modelCalls.filter((call) => call.status === 'REPLAY_COMPLETE')
  const singular = status === 'REPLAY_COMPLETE' && completeCalls.length === 1 ? completeCalls[0] : null
  const dto = {
    status,
    replayStatus: status,
    playbackStatus: status,
    executions: Object.freeze(executionsDto),
    modelCalls: Object.freeze(modelCalls),
    memoryWrites,
    deliveries: Object.freeze([...deliveries.values()].map(value => deepFreeze(value))),
    context: singular?.context ?? null,
    modelContext: singular?.context ?? null,
    output: singular?.output ?? null,
    modelOutput: singular?.output ?? null,
    reasons: Object.freeze(overallReasons),
  }
  return deepFreeze(dto)
}

/**
 * Redact all event payloads for one exact scope/turn and append one durable
 * RETENTION_TOMBSTONE. Metadata (ids, kinds, ordering and scope) remains queryable;
 * the model context/output cannot be reconstructed after this operation.
 */
async function redactTraceTurnInternal(db, { scope, turnId, now } = {}) {
  const model = assertTraceModel(db)
  const normalizedScope = normalizeScope(scope)
  const normalizedTurnId = requiredUuid(turnId, 'turnId')
  const redactedAt = normalizeOccurredAt(now)
  const where = { ...normalizedScope, turnId: normalizedTurnId }
  // Use the same parent lock as append. Erasure callers may already hold it;
  // retention invoked independently must serialize before clearing snapshots.
  const jobs = db?.lineConversationJob
  if (jobs) {
    const job = await jobs.findUnique({ where: { id: normalizedTurnId }, select: { tenantId: true, businessId: true } })
    if (job) {
      assertRowScope(job, normalizedScope)
      await jobs.updateMany({ where: { id: normalizedTurnId, ...normalizedScope }, data: { id: normalizedTurnId } })
    }
  }
  const rows = await model.findMany({ where, orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] })
  for (const row of rows) assertRowScope(row, normalizedScope)

  const existingTombstone = rows.find((row) => row.kind === 'RETENTION_TOMBSTONE')
  if (existingTombstone) {
    return Object.freeze({ redactedCount: rows.filter((row) => row.kind !== 'RETENTION_TOMBSTONE').length, tombstone: existingTombstone })
  }

  if (typeof model.updateMany !== 'function') {
    throw traceError('EXECUTION_TRACE_MODEL_UNAVAILABLE', 'Prisma AgentTraceEvent model must support updateMany for retention', 500)
  }
  await model.updateMany({ where, data: { payloadJson: REDACTED_PAYLOAD_JSON } })

  const executionId = rows.find((row) => row.executionId)?.executionId ?? null
  const payload = { reason: 'PDPA_ERASURE', redactedAt: redactedAt.toISOString() }
  let tombstone
  try {
    tombstone = await appendTraceEventInternal(db, {
      scope: normalizedScope,
      turnId: normalizedTurnId,
      executionId,
      kind: 'RETENTION_TOMBSTONE',
      idempotencyKey: `retention:${normalizedTurnId}`,
      payload,
      occurredAt: redactedAt,
    }, { bypassTurnGuard: true, retryOnUnique: false })
  } catch (error) {
    // Another retention transaction may have won the unique key after both reads.
    // Its tombstone is the authoritative row and is safe to return.
    if (error?.code !== 'EXECUTION_TRACE_IDEMPOTENCY_CONFLICT') throw error
    const winner = await findByIdempotency(model, {
      ...normalizedScope,
      idempotencyKey: `retention:${normalizedTurnId}`,
    })
    if (!winner || winner.kind !== 'RETENTION_TOMBSTONE') throw error
    tombstone = winner
  }
  return Object.freeze({ redactedCount: rows.length, tombstone })
}

export async function redactTraceTurn(db, input) {
  if (typeof db?.$transaction === 'function') {
    try {
      return await db.$transaction((tx) => redactTraceTurnInternal(tx, input))
    } catch (error) {
      if (!isUniqueConflict(error)) throw error
      const normalizedScope = normalizeScope(input?.scope)
      const normalizedTurnId = requiredUuid(input?.turnId, 'turnId')
      const winner = await db.agentTraceEvent.findFirst({
        where: { ...normalizedScope, turnId: normalizedTurnId, kind: 'RETENTION_TOMBSTONE' },
      })
      if (!winner) throw error
      const rows = await db.agentTraceEvent.findMany({ where: { ...normalizedScope, turnId: normalizedTurnId } })
      return Object.freeze({ redactedCount: rows.filter((row) => row.kind !== 'RETENTION_TOMBSTONE').length, tombstone: winner })
    }
  }
  return redactTraceTurnInternal(db, input)
}
