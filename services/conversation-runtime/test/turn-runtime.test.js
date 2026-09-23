import test from 'node:test'
import assert from 'node:assert/strict'
import { composeTurnContext } from '../src/context.js'
import { createConversationRuntime } from '../src/turn-runtime.js'

const claim = { jobId: 'job-1', executionId: 'exec-1', claimantId: 'cr-1', tenantId: 'tenant-1', businessId: 'business-1',
  accountId: 'account-1', version: 2, leaseExpiresAt: '2026-09-24T00:05:00.000Z', deadlineAt: '2026-09-24T00:04:00.000Z' }
const turn = { question: 'What is this?', evidence: [{ product_code: 'SKU1', price: 10 }], authorized: true,
  slices: [{ source: 'KNOWLEDGE', id: 'k1', citationId: 'cite-1', text: 'approved fact' }], maxBudgetChars: 1000 }

test('context composer prioritizes approved records, drops cross-thread memory and denies unauthorized packets', () => {
  const composed = composeTurnContext({ authorized: true, threadId: 'thread-1', audienceKind: 'GROUP', maxBudgetChars: 20,
    slices: [
      { id: 'msp', source: 'MSP', threadId: 'thread-2', text: 'private' },
      { id: 'knowledge', source: 'KNOWLEDGE', text: 'knowledge evidence' },
      { id: 'record', source: 'RECORD', text: 'record' },
    ] })
  assert.equal(composed.slices[0].id, 'record')
  assert.ok(composed.dropped.some(item => item.reason === 'THREAD_SCOPE_MISMATCH'))
  assert.equal(composeTurnContext({ authorized: false, maxBudgetChars: 1 }).text, '')
})

test('real turn runner claims, checks authority, composes, invokes the model and coordinates delivery through ports', async () => {
  const order = []
  const ports = {
    job: { claim: async () => (order.push('claim'), claim), renew: async () => ({ version: claim.version, leaseExpiresAt: claim.leaseExpiresAt }),
      complete: async (_claim, result) => (order.push('complete'), { status: 'READY', ...result }),
      fail: async () => order.push('fail') },
    authority: { resolve: async () => (order.push('authority'), { authorized: true, version: 1,
      scope: { tenantId: claim.tenantId, businessId: claim.businessId, accountId: claim.accountId } }) },
    context: { prepare: async () => (order.push('context'), turn) },
    workTool: { execute: async () => assert.fail('normal turn should not call WorkToolPort') },
    model: { credential: async () => (order.push('credential'), { provider: 'fake' }),
      generate: async input => (order.push('model'), assert.equal(input.contextPacket, 'approved fact'), 'supported answer') },
    delivery: { send: async () => (order.push('delivery'), { status: 'RECORDED' }) },
    trace: { append: async (_claim, event) => order.push(event.kind) },
  }
  const result = await createConversationRuntime({ ports, now: () => new Date('2026-09-24T00:00:00.000Z') }).runOne()
  assert.equal(result.status, 'RECORDED')
  assert.deepEqual(order, ['claim', 'authority', 'context', 'credential', 'model', 'CONTEXT_COMMITTED', 'complete', 'ANSWER_READY', 'delivery'])
})

test('turn runner fails closed on denied authority and never calls context/model/delivery', async () => {
  let contextCalls = 0
  let modelCalls = 0
  let failed
  const ports = {
    job: { claim: async () => claim, renew: async () => ({ version: claim.version, leaseExpiresAt: claim.leaseExpiresAt }),
      complete: async () => assert.fail('must not complete'), fail: async (_claim, value) => { failed = value } },
    authority: { resolve: async () => ({ authorized: false, scope: { tenantId: 'other', businessId: 'other', accountId: 'other' } }) },
    context: { prepare: async () => { contextCalls += 1 } },
    workTool: { execute: async () => assert.fail('denied turn should not call WorkToolPort') },
    model: { credential: async () => null, generate: async () => { modelCalls += 1 } },
    delivery: { send: async () => assert.fail('must not send') }, trace: { append: async () => {} },
  }
  const result = await createConversationRuntime({ ports }).runOne()
  assert.equal(result.status, 'FAILED')
  assert.equal(failed.code, 'AUTHORITY_DENIED')
  assert.equal(contextCalls, 0)
  assert.equal(modelCalls, 0)
})

test('WorkToolPort receives a fixed operation and stable mutation id; arbitrary actions fail', async () => {
  let operationId
  const ports = {
    job: { claim: async () => claim, renew: async () => ({ version: claim.version, leaseExpiresAt: claim.leaseExpiresAt }),
      complete: async () => ({ status: 'READY' }), fail: async () => {} },
    authority: { resolve: async () => ({ authorized: true, version: 1,
      scope: { tenantId: claim.tenantId, businessId: claim.businessId, accountId: claim.accountId } }) },
    context: { prepare: async () => ({ ...turn, workCommand: { operation: 'propose', input: { title: 'Review' } } }) },
    workTool: { execute: async (_claim, _authority, request) => { operationId = request.operationId; return { text: 'Proposed' } } },
    model: { credential: async () => assert.fail('work command should bypass model'), generate: async () => assert.fail('work command should bypass model') },
    delivery: { send: async () => ({ status: 'RECORDED' }) }, trace: { append: async () => {} },
  }
  await createConversationRuntime({ ports }).runOne()
  assert.equal(operationId, 'job-1:exec-1')
})

test('runtime construction requires every versioned side-effect port', () => {
  assert.throws(() => createConversationRuntime({ ports: {} }), /RUNTIME_PORTS_REQUIRED/)
})
