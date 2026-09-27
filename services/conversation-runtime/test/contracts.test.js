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
