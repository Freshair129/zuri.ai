import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createCorePorts } from '../src/core-ports.js'
import { validateCoreEnvelope, validateMemoryRequest, validateTurnContext } from '../src/contracts.js'
import { createConversationRuntime } from '../src/turn-runtime.js'

// @req FR-149 — memory-sync opt-in turns: the runtime reads, invokes with MSP injection
// receipts and appends only through Core's v1 `memory` operation.
// @spec ADR-106 D2, SDD-110 — stable per-job memory identities; Core is the only MSP caller.
const now = () => new Date('2026-09-24T00:00:00.000Z')
const claim = { jobId: 'job-1', executionId: 'exec-1', claimantId: 'cr-1', tenantId: 'tenant-1', businessId: 'business-1',
  accountId: 'account-1', version: 2, leaseExpiresAt: '2026-09-24T00:05:00.000Z', deadlineAt: '2026-09-24T00:04:00.000Z' }
const turn = { question: 'ราคาเท่าไร', evidence: { records: [{ product_code: 'A1', name: 'สินค้า A1', sell_price: 10, currency: 'THB', unit: 'ชิ้น', moq: null, as_of: '2026-09-01T00:00:00.000Z' }] }, authorized: true, slices: [],
  audienceKind: 'DIRECT', threadId: null, maxBudgetChars: 0, workCommand: null, memorySync: true }
const packet = { contextId: 'context_1', injectionId: 'injection_1', policyDecision: 'ALLOW', thread: { threadId: 'thread-1' },
  memory: { recentExchanges: [{ exchangeId: 'exchange-1' }] } }
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex')

function fakePorts({ order, memory = {}, generate } = {}) {
  let appended = null
  return {
    job: { claim: async () => (order.push('claim'), claim),
      renew: async () => ({ version: claim.version, leaseExpiresAt: claim.leaseExpiresAt }),
      complete: async (_claim, result) => (order.push(`complete ${result.text}`), { status: 'READY', operationId: result.operationId }),
      status: async (_claim, operationId) => ({ status: 'CLAIMED', operationId }),
      fail: async (_claim, result) => order.push(`fail ${result.code} ${result.outcome}`) },
    authority: { resolve: async () => ({ authorized: true, version: 2,
      scope: { tenantId: claim.tenantId, businessId: claim.businessId, accountId: claim.accountId, identityId: 'identity-1', identityVersion: 1 } }) },
    context: { prepare: async () => turn },
    workTool: { execute: async () => assert.fail('no WorkTool'), status: async () => assert.fail('no WorkTool') },
    model: { credential: async () => ({ provider: 'openrouter', model: 'test-model', apiKey: 'synthetic' }),
      generate: generate ?? (async input => { order.push(`model ${input.contextPacket?.injectionId ?? 'none'}`); return 'คำตอบ' }) },
    delivery: { send: async () => (order.push('delivery'), { status: 'RECORDED' }), status: async () => ({ status: 'READY' }) },
    trace: { append: async () => {}, status: async () => ({ status: 'NOT_FOUND' }) },
    memory: {
      read: memory.read ?? (async () => (order.push('memory read'), { status: 'COMPLETED', operationId: 'job-1:memory-read',
        result: { contextPacket: packet, receipt: { policyDecision: 'ALLOW' } } })),
      append: memory.append ?? (async (_claim, text) => {
        order.push(`memory append ${text}`)
        appended = text
        return { status: 'COMPLETED', operationId: 'job-1:memory-append', result: { receipt: { textSha256: sha(text), duplicate: false } } }
      }),
      receipt: memory.receipt ?? (async (_claim, name, input) => {
        if (name === 'injection') { order.push(`receipt ${input.state}`); return { status: 'COMPLETED', operationId: 'job-1:memory-injection', result: { receipt: { state: input.state } } } }
        order.push(`receipt ${name}`)
        return appended ? { status: 'COMPLETED', operationId: 'job-1:memory-append', result: { receipt: { textSha256: sha(appended), duplicate: true } } }
          : { status: 'NOT_FOUND', operationId: 'job-1:memory-append' }
      }),
    },
  }
}

test('a memory turn reads, records RESOLVED/SUBMITTED/COMPLETED around the model, appends, then completes', async () => {
  const order = []
  const result = await createConversationRuntime({ ports: fakePorts({ order }), now }).runOne()
  assert.equal(result.status, 'RECORDED')
  assert.deepEqual(order, ['claim', 'memory read', 'receipt RESOLVED', 'model injection_1',
    'receipt SUBMITTED', 'receipt COMPLETED', 'receipt append',
    'memory append คำตอบ', 'complete คำตอบ', 'delivery'])
})

test('a memory turn with no evidence still reads and appends, with no model and no injection receipt', async () => {
  const order = []
  const ports = fakePorts({ order })
  ports.context.prepare = async () => ({ ...turn, evidence: { records: [] } })
  const result = await createConversationRuntime({ ports, now }).runOne()
  assert.equal(result.status, 'RECORDED')
  assert.equal(order.filter(entry => entry.startsWith('model') || entry.startsWith('receipt R')).length, 0)
  assert.deepEqual(order.slice(0, 2), ['claim', 'memory read'])
  assert.ok(order.some(entry => entry.startsWith('memory append ')))
})

test('a turn without memorySync never touches the memory port, and an absent port fails only memory turns', async () => {
  const order = []
  const ports = fakePorts({ order })
  ports.context.prepare = async () => ({ ...turn, memorySync: undefined })
  delete ports.memory
  assert.equal((await createConversationRuntime({ ports, now }).runOne()).status, 'RECORDED')
  const memoryOrder = []
  const memoryPorts = fakePorts({ order: memoryOrder })
  delete memoryPorts.memory
  const failed = await createConversationRuntime({ ports: memoryPorts, now }).runOne()
  assert.deepEqual(failed, { jobId: 'job-1', status: 'FAILED', code: 'MEMORY_PORT_UNAVAILABLE' })
  assert.ok(!memoryOrder.some(entry => entry.startsWith('model') || entry.startsWith('complete') || entry === 'delivery'))
})

test('a read failure fails the turn before any model call, as the legacy worker does', async () => {
  const order = []
  const ports = fakePorts({ order, memory: { read: async () => { throw Object.assign(new Error('MSP_TRANSPORT_MISCONFIGURED'), { code: 'MSP_TRANSPORT_MISCONFIGURED', retryable: true }) } } })
  const result = await createConversationRuntime({ ports, now }).runOne()
  assert.deepEqual(result, { jobId: 'job-1', status: 'FAILED', code: 'MSP_TRANSPORT_MISCONFIGURED' })
  assert.deepEqual(order, ['claim', 'fail MSP_TRANSPORT_MISCONFIGURED FAILED'])
})

test('an unestablished injection receipt after the provider ran is UNKNOWN and nothing is appended', async () => {
  for (const failing of ['SUBMITTED', 'COMPLETED']) {
    const order = []
    const ports = fakePorts({ order })
    const receipt = ports.memory.receipt
    ports.memory.receipt = async (c, name, input) => {
      if (input?.state === failing) throw Object.assign(new Error('MSP_INJECTION_RECEIPT_UNKNOWN'), { code: 'MSP_INJECTION_RECEIPT_UNKNOWN', retryable: true })
      return receipt(c, name, input)
    }
    const result = await createConversationRuntime({ ports, now }).runOne()
    assert.deepEqual(result, { jobId: 'job-1', status: 'UNKNOWN', code: 'MSP_INJECTION_RECEIPT_UNKNOWN' }, failing)
    assert.ok(order.includes('fail MSP_INJECTION_RECEIPT_UNKNOWN UNKNOWN'), failing)
    assert.ok(!order.some(entry => entry.startsWith('memory append') || entry.startsWith('complete')), failing)
  }
})

test('RESOLVED gates the provider: a fence refusal FAILS, an unestablished write is UNKNOWN; a provider failure records FAILED', async () => {
  for (const [error, expected] of [
    [{ code: 'CONVERSATION_JOB_AUTHORITY_REVOKED', retryable: false }, { status: 'FAILED', code: 'CONVERSATION_JOB_AUTHORITY_REVOKED' }],
    [{ code: 'MSP_INJECTION_RECEIPT_UNKNOWN', retryable: true }, { status: 'UNKNOWN', code: 'MSP_INJECTION_RECEIPT_UNKNOWN' }],
  ]) {
    const order = []
    const ports = fakePorts({ order })
    ports.memory.receipt = async () => { throw Object.assign(new Error(error.code), error) }
    const result = await createConversationRuntime({ ports, now }).runOne()
    assert.deepEqual(result, { jobId: 'job-1', ...expected })
    assert.ok(!order.some(entry => entry.startsWith('model')))
  }

  const failedOrder = []
  const failedPorts = fakePorts({ order: failedOrder, generate: async () => { throw Object.assign(new Error('MODEL_PROVIDER_HTTP_503'), { code: 'MODEL_PROVIDER_HTTP_503' }) } })
  const failed = await createConversationRuntime({ ports: failedPorts, now }).runOne()
  // A provider failure records FAILED and then, as the legacy grounded answer does
  // (W8 parity), answers from the evidence; the exchange is still appended.
  assert.equal(failed.status, 'RECORDED')
  assert.ok(failedOrder.includes('receipt FAILED'))
  assert.ok(!failedOrder.includes('receipt COMPLETED'))
  const fallback = 'สินค้า A1 (A1) — ราคา 10 THB/ชิ้น — ข้อมูล ณ 2026-09-01'
  assert.ok(failedOrder.includes(`memory append ${fallback}`), JSON.stringify(failedOrder))
  assert.ok(failedOrder.includes(`complete ${fallback}`), JSON.stringify(failedOrder))
})

test('append: a typed refusal is final; an ambiguous failure is reconciled from the receipt and retried once', async () => {
  const refusedOrder = []
  const refused = fakePorts({ order: refusedOrder, memory: { append: async () => { throw Object.assign(new Error('LINE_MEMORY_POLICY_REVOKED'), { code: 'LINE_MEMORY_POLICY_REVOKED', retryable: false }) } } })
  const refusedResult = await createConversationRuntime({ ports: refused, now }).runOne()
  assert.deepEqual(refusedResult, { jobId: 'job-1', status: 'FAILED', code: 'LINE_MEMORY_POLICY_REVOKED' })
  assert.equal(refusedOrder.filter(entry => entry === 'receipt append').length, 1)

  const order = []
  let attempts = 0
  const ports = fakePorts({ order })
  const append = ports.memory.append
  ports.memory.append = async (c, text) => {
    attempts += 1
    if (attempts === 1) throw Object.assign(new Error('CORE_OPERATION_TIMEOUT'), { code: 'CORE_OPERATION_TIMEOUT', retryable: true })
    return append(c, text)
  }
  assert.equal((await createConversationRuntime({ ports, now }).runOne()).status, 'RECORDED')
  assert.equal(attempts, 2)
  assert.deepEqual(order.filter(entry => entry.startsWith('receipt append') || entry.startsWith('memory append')),
    ['receipt append', 'receipt append', 'memory append คำตอบ'])
})

test('append: a durable receipt for different text is a conflict, never a silent success', async () => {
  const order = []
  const ports = fakePorts({ order })
  ports.memory.receipt = async (_claim, name, input) => name === 'injection'
    ? { status: 'COMPLETED', operationId: 'job-1:memory-injection', result: { receipt: { state: input.state } } }
    : { status: 'COMPLETED', operationId: 'job-1:memory-append', result: { receipt: { textSha256: sha('another answer'), duplicate: true } } }
  const result = await createConversationRuntime({ ports, now }).runOne()
  assert.deepEqual(result, { jobId: 'job-1', status: 'FAILED', code: 'MEMORY_APPEND_CONFLICT' })
  assert.ok(!order.some(entry => entry.startsWith('complete')))
})

test('memory ports address the fixed memory operation with stable per-job identities', async () => {
  const calls = []
  const client = { call: async (operation, payload, options) => { calls.push({ operation, payload, options }); return {} } }
  const ports = createCorePorts({ client, model: { generate: async () => 'unused' }, isCoreReady: () => false })
  const ref = { jobId: 'job-1', executionId: 'exec-1', claimantId: 'cr-1', version: 2, tenantId: 'tenant-1', businessId: 'business-1', accountId: 'account-1' }
  await ports.memory.read(claim)
  await ports.memory.append(claim, 'answer')
  await ports.memory.receipt(claim, 'append')
  await ports.memory.receipt(claim, 'injection', { state: 'SUBMITTED' })
  assert.throws(() => ports.memory.receipt(claim, 'erase'), /MEMORY_OPERATION_ID_INVALID/)
  assert.deepEqual(calls.map(({ operation, payload, options }) => [operation, payload, options.idempotencyKey]), [
    ['memory', { claim: ref, operation: 'read', operationId: 'job-1:memory-read', input: {} }, 'job-1:memory-read'],
    ['memory', { claim: ref, operation: 'append', operationId: 'job-1:memory-append', input: { text: 'answer' } }, 'job-1:memory-append'],
    ['memory', { claim: ref, operation: 'receipt', operationId: 'job-1:memory-append', input: {} }, 'memory-status:job-1:memory-append'],
    ['memory', { claim: ref, operation: 'receipt', operationId: 'job-1:memory-injection', input: { state: 'SUBMITTED' } }, 'job-1:memory-injection:SUBMITTED'],
  ])
})

test('the memory contract rejects forged scope, unknown states and oversized text; memorySync never rides a Work command', () => {
  assert.doesNotThrow(() => validateMemoryRequest({ operation: 'read', operationId: 'job-1:memory-read', input: {} }))
  for (const bad of [
    { operation: 'read', operationId: 'job-1:memory-read', input: { threadId: 'forged' } },
    { operation: 'append', operationId: 'job-1:memory-append', input: { text: 'x'.repeat(5001) } },
    { operation: 'append', operationId: 'job-1:memory-append', input: { text: 'a', tenantId: 'forged' } },
    { operation: 'receipt', operationId: 'job-1:memory-injection', input: { state: 'DELETED' } },
    // The model reference is Core's, from the claim-bound credential; the runtime cannot name one.
    { operation: 'receipt', operationId: 'job-1:memory-injection', input: { state: 'RESOLVED', model: { provider: 'p', model: 'm' } } },
    { operation: 'erase', operationId: 'job-1:memory-erase', input: {} },
  ]) assert.throws(() => validateMemoryRequest(bad), /MEMORY_/)
  assert.throws(() => validateCoreEnvelope({ contractVersion: 'conversation-runtime.v1', operation: 'memory', correlationId: 'c',
    idempotencyKey: 'k', deadlineAt: '2026-09-24T00:00:00.000Z', payload: { claim: { jobId: 'j', executionId: 'e', claimantId: 'c',
      version: 1, tenantId: 't', businessId: 'b', accountId: 'a' }, operation: 'read', operationId: 'j:memory-read', input: { actor: 'x' } } }), /MEMORY_INPUT_INVALID/)
  assert.throws(() => validateTurnContext({ ...turn, memorySync: true, workCommand: { operation: 'read', input: {} } }), /TURN_MEMORY_SYNC_INVALID/)
  assert.throws(() => validateTurnContext({ ...turn, memorySync: false }), /TURN_MEMORY_SYNC_INVALID/)
})
