import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { validateCoreEnvelope, validateClaim, validateWorkToolRequest, validateTurnContext } from '../src/contracts.js'
import { createCoreClient } from '../src/core-client.js'

const envelope = (operation, payload = { claimantId: 'cr-1' }) => ({ contractVersion: 'conversation-runtime.v1', operation, correlationId: 'corr-1',
  idempotencyKey: 'op-1', deadlineAt: '2026-09-24T00:00:30.000Z', payload })

test('core envelopes reject unknown fields, wrong versions and unsupported operations', () => {
  assert.equal(validateCoreEnvelope(envelope('claim')).operation, 'claim')
  assert.throws(() => validateCoreEnvelope({ ...envelope('claim'), viewer: { businessId: 'spoofed' } }), /CONTRACT_UNKNOWN_FIELD/)
  assert.throws(() => validateCoreEnvelope({ ...envelope('claim'), contractVersion: 'v2' }), /CONTRACT_VERSION_UNSUPPORTED/)
  assert.throws(() => validateCoreEnvelope(envelope('execute-anything')), /CONTRACT_OPERATION_INVALID/)
  assert.throws(() => validateCoreEnvelope({ ...envelope('claim'), correlationId: 'has space' }), /CONTRACT_CORRELATION_ID_INVALID/)
  assert.throws(() => validateCoreEnvelope({ ...envelope('claim'), deadlineAt: '2026-09-24' }), /CONTRACT_DEADLINE_INVALID/)
})

test('claim, turn context and work tool payloads enforce scope and bounds', () => {
  assert.throws(() => validateClaim({ jobId: 'j', version: 1 }), /CLAIM_SCOPE_INVALID/)
  assert.throws(() => validateWorkToolRequest({ operation: 'shell', operationId: 'op', input: {} }), /WORK_TOOL_OPERATION_INVALID/)
  assert.throws(() => validateTurnContext({ question: 'q', evidence: [], slices: [], authorized: null, maxBudgetChars: 0 }), /TURN_AUTHORITY_REQUIRED/)
})

test('WorkTool inputs use the same fixed operation shapes and nested bounds as Core', () => {
  const common = { operationId: 'work-op-1' }
  assert.doesNotThrow(() => validateWorkToolRequest({ ...common, operation: 'read', input: { kind: 'work', query: 'active' } }))
  assert.doesNotThrow(() => validateWorkToolRequest({ ...common, operation: 'status', input: {} }))
  assert.throws(() => validateWorkToolRequest({ ...common, operation: 'read', input: { shell: 'id' } }), /WORK_TOOL_INPUT_INVALID/)
  assert.throws(() => validateWorkToolRequest({ ...common, operation: 'propose', input: { action: 'create_work', targetId: 'not-a-uuid', args: {} } }), /WORK_TOOL_INPUT_INVALID/)

  let nested = { value: 'x' }
  for (let depth = 0; depth < 66; depth += 1) nested = { nested }
  assert.throws(() => validateWorkToolRequest({ ...common, operation: 'propose', input: {
    action: 'create_work', targetId: '00000000-0000-4000-8000-000000000001', args: nested,
  } }), /WORK_TOOL_INPUT_INVALID/)
  const cyclic = {}
  cyclic.self = cyclic
  assert.throws(() => validateWorkToolRequest({ ...common, operation: 'propose', input: {
    action: 'create_work', targetId: '00000000-0000-4000-8000-000000000001', args: cyclic,
  } }), /WORK_TOOL_INPUT_INVALID/)

  let tracePayload = { value: 'x' }
  for (let depth = 0; depth < 66; depth += 1) tracePayload = { nested: tracePayload }
  const claim = { jobId: 'j', executionId: 'e', claimantId: 'c', version: 1, tenantId: 't', businessId: 'b', accountId: 'a' }
  assert.throws(() => validateCoreEnvelope(envelope('trace', { claim, kind: 'test', payload: tracePayload })), /TRACE_PAYLOAD_INVALID/)
})

test('published operation schema closes nested WorkTool fields and uses bounded JSON payloads', async () => {
  const schemaPath = fileURLToPath(new URL('../contracts/v1/operation.schema.json', import.meta.url))
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'))
  assert.equal(schema.$defs.workTool.additionalProperties, false)
  assert.equal(schema.$defs.workPropose.additionalProperties, false)
  assert.equal(schema.$defs.workConfirm.additionalProperties, false)
  assert.deepEqual(schema.$defs.trace.properties.payload.additionalProperties, { $ref: '#/$defs/boundedJson' })
})

test('core client sends a strict bearer request and maps lost responses to typed timeouts', async () => {
  let observed
  const client = createCoreClient({ baseUrl: 'http://core:3000', token: 't'.repeat(40), fetchFn: async (url, options) => {
    observed = { url: String(url), options }
    return new Response(JSON.stringify({ contractVersion: 'conversation-runtime.v1', ok: true, data: null }), { status: 200, headers: { 'content-type': 'application/json' } })
  } })
  assert.equal(await client.call('claim', { claimantId: 'cr-1' }), null)
  assert.equal(observed.url, 'http://core:3000/api/internal/conversation-runtime/v1/claim')
  assert.equal(observed.options.headers.authorization, `Bearer ${'t'.repeat(40)}`)
  const timeoutClient = createCoreClient({ baseUrl: 'http://core:3000', token: 't'.repeat(40), timeoutMs: 100,
    fetchFn: (_url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))) ) })
  await assert.rejects(timeoutClient.call('claim', { claimantId: 'cr-1' }), { code: 'CORE_OPERATION_TIMEOUT' })
})

test('core readiness must name Conversation Runtime as the authoritative job owner', async () => {
  const client = createCoreClient({ baseUrl: 'http://core:3000', token: 't'.repeat(40), fetchFn: async () =>
    new Response(JSON.stringify({ contractVersion: 'conversation-runtime.v1', status: 'READY', runtimeOwner: 'LEGACY_WORKER' }), { status: 200, headers: { 'content-type': 'application/json' } }) })
  await assert.rejects(client.health(), { code: 'CORE_RUNTIME_OWNER_MISMATCH' })
})

test('core client stops oversized responses before parsing or validating them', async () => {
  const client = createCoreClient({ baseUrl: 'http://core:3000', token: 't'.repeat(40), fetchFn: async () =>
    new Response(JSON.stringify({ contractVersion: 'conversation-runtime.v1', ok: true, data: null }) + ' '.repeat(70 * 1024),
      { status: 200, headers: { 'content-type': 'application/json' } }) })
  await assert.rejects(client.call('claim', { claimantId: 'cr-1' }), { code: 'CORE_RESPONSE_TOO_LARGE' })
})

test('core client validates typed Core errors and nested credential responses', async () => {
  const claim = { jobId: 'j', executionId: 'e', claimantId: 'c', version: 1, tenantId: 't', businessId: 'b', accountId: 'a' }
  const credentialPayload = { claim }
  const rejected = createCoreClient({ baseUrl: 'http://core:3000', token: 't'.repeat(40), fetchFn: async () =>
    new Response(JSON.stringify({ contractVersion: 'conversation-runtime.v1', ok: false,
      error: { code: 'CONVERSATION_IDENTITY_REVOKED', retryable: false } }),
    { status: 403, headers: { 'content-type': 'application/json' } }) })
  await assert.rejects(rejected.call('credential', credentialPayload), { code: 'CONVERSATION_IDENTITY_REVOKED', retryable: false })

  const invalidCredential = createCoreClient({ baseUrl: 'http://core:3000', token: 't'.repeat(40), fetchFn: async () =>
    new Response(JSON.stringify({ contractVersion: 'conversation-runtime.v1', ok: true,
      data: { provider: 'prp', model: 'controlled', apiKey: 'secret', unexpected: true } }),
    { status: 200, headers: { 'content-type': 'application/json' } }) })
  await assert.rejects(invalidCredential.call('credential', credentialPayload), { code: 'CORE_RESPONSE_INVALID' })
})

test('core client accepts only the exact v1 WorkTool receipt shape for the request it sent', async () => {
  const claim = { jobId: 'job-1', executionId: 'e', claimantId: 'c', version: 1, tenantId: 't', businessId: 'b', accountId: 'a' }
  const proposalId = '6f1c1a52-6a55-4b8e-9d7c-2f1b8e3c9a10'
  const clientReturning = data => createCoreClient({ baseUrl: 'http://core:3000', token: 't'.repeat(40), fetchFn: async () =>
    new Response(JSON.stringify({ contractVersion: 'conversation-runtime.v1', ok: true, data }), { status: 200, headers: { 'content-type': 'application/json' } }) })
  const call = (request, data) => clientReturning(data).call('work-tool', { claim, ...request })
  const read = { operation: 'read', operationId: 'job-1:work-read', input: { kind: 'projects', query: '' } }
  const propose = { operation: 'propose', operationId: 'job-1:work-proposal', input: { action: 'create_work', targetId: proposalId, args: { title: 'Task' } } }
  const confirm = { operation: 'confirm-execute', operationId: proposalId, input: { proposalId } }
  const status = operationId => ({ operation: 'status', operationId, input: {} })
  const completed = receipt => ({ status: 'COMPLETED', result: { text: 'ok', receipt } })
  const readReceipt = { source: 'PROJECT_MANAGER', observedAt: '2026-09-27T00:00:00.000Z' }
  const proposalReceipt = { proposalId: 'job-1', status: 'AWAITING_CONFIRMATION' }
  const executed = { proposalId, action: 'create_work', itemId: 'item-1', code: 'WI-0001', status: 'TODO', version: 1 }

  // The shapes Core emits pass.
  const accepted = [
    [read, completed(readReceipt)],
    [propose, completed(proposalReceipt)],
    [confirm, completed(executed)],
    [confirm, completed({ ...executed, duplicate: true })],
    [status('job-1:work-proposal'), completed(proposalReceipt)],
    [status(proposalId), completed(executed)],
    [status('job-1:work-read'), { status: 'NOT_FOUND', operationId: 'job-1:work-read' }],
    [status(proposalId), { status: 'NOT_FOUND', proposalId, receipt: { status: 'AWAITING_CONFIRMATION' } }],
  ]
  for (const [request, data] of accepted) assert.deepEqual(await call(request, data), data)

  // Anything else is a drifted Core and fails in the client, including the
  // "any object with at most 12 keys" receipts the previous check let through.
  const rejected = [
    ['read receipt with an extra key', read, completed({ ...readReceipt, extra: 1 })],
    ['read receipt from another source', read, completed({ ...readReceipt, source: 'MODEL' })],
    ['read receipt with an unparseable time', read, completed({ ...readReceipt, observedAt: 'yesterday' })],
    ['read answered with a proposal receipt', read, completed(proposalReceipt)],
    ['arbitrary small receipt', read, completed({ a: 1, b: 2 })],
    ['empty receipt', confirm, completed({})],
    ['proposal naming another job', propose, completed({ ...proposalReceipt, proposalId: 'job-2' })],
    ['proposal with another status', propose, completed({ ...proposalReceipt, status: 'CONFIRMED' })],
    ['execution for another proposal', confirm, completed({ ...executed, proposalId: 'other-proposal' })],
    ['execution missing its version', confirm, completed({ ...executed, version: undefined })],
    ['execution with a fractional version', confirm, completed({ ...executed, version: 1.5 })],
    ['execution with an unknown action', confirm, completed({ ...executed, action: 'delete_work' })],
    ['execution with a lower-case status', confirm, completed({ ...executed, status: 'done' })],
    ['execution with duplicate: false', confirm, completed({ ...executed, duplicate: false })],
    ['execution with an extra key', confirm, completed({ ...executed, actor: 'forged' })],
    ['status replay marked duplicate', status(proposalId), completed({ ...executed, duplicate: true })],
    ['status replay for another proposal', status(proposalId), completed({ ...executed, proposalId: 'job-1' })],
    ['empty completion text', read, { status: 'COMPLETED', result: { text: '', receipt: readReceipt } }],
    ['NOT_FOUND for an execute', confirm, { status: 'NOT_FOUND', operationId: proposalId }],
    ['NOT_FOUND naming another operation', status('job-1:work-read'), { status: 'NOT_FOUND', operationId: 'job-2:work-read' }],
    ['NOT_FOUND with an unexpected receipt', status(proposalId), { status: 'NOT_FOUND', proposalId, receipt: { status: 'EXECUTED' } }],
    ['NOT_FOUND with both identities', status(proposalId), { status: 'NOT_FOUND', operationId: proposalId, proposalId, receipt: { status: 'AWAITING_CONFIRMATION' } }],
    ['unknown status', read, { status: 'PENDING' }],
  ]
  for (const [label, request, data] of rejected)
    await assert.rejects(call(request, data), { code: 'CORE_RESPONSE_INVALID' }, label)
})

test('WorkTool REJECTED outcomes and prepare workReply are typed, bounded and closed', async () => {
  const claim = { jobId: 'j', executionId: 'e', claimantId: 'c', version: 1, tenantId: 't', businessId: 'b', accountId: 'a' }
  const request = { claim, operation: 'confirm-execute', operationId: '00000000-0000-4000-8000-000000000009',
    input: { proposalId: '00000000-0000-4000-8000-000000000009' } }
  const replying = data => createCoreClient({ baseUrl: 'http://core:3000', token: 't'.repeat(40), fetchFn: async () =>
    new Response(JSON.stringify({ contractVersion: 'conversation-runtime.v1', ok: true, data }),
      { status: 200, headers: { 'content-type': 'application/json' } }) })
  const rejected = { status: 'REJECTED', code: 'WORK_CONFIRMATION_EXPIRED', result: { text: 'expired' } }
  assert.deepEqual(await replying(rejected).call('work-tool', request), rejected)
  for (const invalid of [
    { ...rejected, code: 'WORK_SCOPE_DENIED' },
    { ...rejected, result: { text: 'expired', receipt: {} } },
    { ...rejected, result: { text: '' } },
    { ...rejected, result: { text: 'x'.repeat(5001) } },
    { ...rejected, retryable: false },
  ]) await assert.rejects(replying(invalid).call('work-tool', request), { code: 'CORE_RESPONSE_INVALID' })

  const turn = { question: '/work-create', evidence: { records: [] }, slices: [], authorized: true, audienceKind: 'DIRECT',
    threadId: null, maxBudgetChars: 0, workCommand: null }
  assert.equal(validateTurnContext({ ...turn, workReply: { code: 'WORK_COMMAND_USAGE', text: 'usage' } }).workReply.text, 'usage')
  assert.equal(validateTurnContext({ ...turn, workReply: null }).workReply, null)
  for (const workReply of [
    { code: 'WORK_VERSION_CONFLICT', text: 'usage' },
    { code: 'WORK_COMMAND_USAGE', text: '' },
    { code: 'WORK_COMMAND_USAGE', text: 'x'.repeat(5001) },
    { code: 'WORK_COMMAND_USAGE', text: 'usage', extra: true },
  ]) assert.throws(() => validateTurnContext({ ...turn, workReply }), { code: 'TURN_WORK_REPLY_INVALID' })
  assert.throws(() => validateTurnContext({ ...turn, workCommand: { operation: 'read', input: {} },
    workReply: { code: 'WORK_COMMAND_USAGE', text: 'usage' } }), { code: 'TURN_WORK_REPLY_INVALID' })
})

test('an OUT_OF_HOURS turn carries only a bounded fixed reply and nothing to execute', () => {
  const base = { question: 'q', evidence: { records: [] }, slices: [], authorized: true, audienceKind: 'DIRECT',
    threadId: null, maxBudgetChars: 0, workCommand: null }
  assert.doesNotThrow(() => validateTurnContext({ ...base, turnKind: 'OUT_OF_HOURS', replyText: 'closed' }))
  assert.doesNotThrow(() => validateTurnContext(base))
  assert.throws(() => validateTurnContext({ ...base, turnKind: 'ANYTHING', replyText: 'closed' }), /TURN_KIND_INVALID/)
  assert.throws(() => validateTurnContext({ ...base, turnKind: 'OUT_OF_HOURS' }), /TURN_REPLY_TEXT_INVALID/)
  assert.throws(() => validateTurnContext({ ...base, turnKind: 'OUT_OF_HOURS', replyText: '   ' }), /TURN_REPLY_TEXT_INVALID/)
  assert.throws(() => validateTurnContext({ ...base, turnKind: 'OUT_OF_HOURS', replyText: 'x'.repeat(5001) }), /TURN_REPLY_TEXT_INVALID/)
  assert.throws(() => validateTurnContext({ ...base, replyText: 'closed' }), /TURN_KIND_INVALID/)
  assert.throws(() => validateTurnContext({ ...base, turnKind: 'OUT_OF_HOURS', replyText: 'closed',
    workCommand: { operation: 'read', input: {} } }), /TURN_KIND_INVALID/)
  assert.throws(() => validateTurnContext({ ...base, turnKind: 'OUT_OF_HOURS', replyText: 'closed',
    evidence: { records: [{ sku: 1 }] } }), /TURN_KIND_INVALID/)
})
