import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCoreEnvelope, validateClaim, validateWorkToolRequest, validateTurnContext } from '../src/contracts.js'
import { createCoreClient } from '../src/core-client.js'

const envelope = (operation, payload = { claimantId: 'cr-1' }) => ({ contractVersion: 'conversation-runtime.v1', operation, correlationId: 'corr-1',
  idempotencyKey: 'op-1', deadlineAt: '2026-09-24T00:00:30.000Z', payload })

test('core envelopes reject unknown fields, wrong versions and unsupported operations', () => {
  assert.equal(validateCoreEnvelope(envelope('claim')).operation, 'claim')
  assert.throws(() => validateCoreEnvelope({ ...envelope('claim'), viewer: { businessId: 'spoofed' } }), /CONTRACT_UNKNOWN_FIELD/)
  assert.throws(() => validateCoreEnvelope({ ...envelope('claim'), contractVersion: 'v2' }), /CONTRACT_VERSION_UNSUPPORTED/)
  assert.throws(() => validateCoreEnvelope(envelope('execute-anything')), /CONTRACT_OPERATION_INVALID/)
})

test('claim, turn context and work tool payloads enforce scope and bounds', () => {
  assert.throws(() => validateClaim({ jobId: 'j', version: 1 }), /CLAIM_SCOPE_INVALID/)
  assert.throws(() => validateWorkToolRequest({ operation: 'shell', operationId: 'op', input: {} }), /WORK_TOOL_OPERATION_INVALID/)
  assert.throws(() => validateTurnContext({ question: 'q', evidence: [], slices: [], authorized: null, maxBudgetChars: 0 }), /TURN_AUTHORITY_REQUIRED/)
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
