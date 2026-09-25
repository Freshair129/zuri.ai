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
      status: async (_claim, operationId) => ({ status: 'CLAIMED', operationId }),
      fail: async () => order.push('fail') },
    authority: { resolve: async () => (order.push('authority'), { authorized: true, version: 1,
      scope: { tenantId: claim.tenantId, businessId: claim.businessId, accountId: claim.accountId } }) },
    context: { prepare: async () => (order.push('context'), turn) },
    workTool: { execute: async () => assert.fail('normal turn should not call WorkToolPort'), status: async () => ({ status: 'NOT_FOUND' }) },
    model: { credential: async () => (order.push('credential'), { provider: 'fake' }),
      generate: async input => (order.push('model'), assert.equal(input.contextPacket.text, 'approved fact'), 'supported answer') },
    delivery: { send: async () => (order.push('delivery'), { status: 'RECORDED' }), status: async () => ({ status: 'READY' }) },
    trace: { append: async (_claim, event) => order.push(event.kind), status: async () => ({ status: 'NOT_FOUND' }) },
  }
  const result = await createConversationRuntime({ ports, now: () => new Date('2026-09-24T00:00:00.000Z') }).runOne()
  assert.equal(result.status, 'RECORDED')
  assert.deepEqual(order, ['claim', 'authority', 'context', 'MODEL_STARTED', 'credential', 'model', 'MODEL_COMPLETED', 'CONTEXT_COMMITTED', 'complete', 'ANSWER_READY', 'delivery'])
})

test('turn runner fails closed on denied authority and never calls context/model/delivery', async () => {
  let contextCalls = 0
  let modelCalls = 0
  let failed
  const ports = {
    job: { claim: async () => claim, renew: async () => ({ version: claim.version, leaseExpiresAt: claim.leaseExpiresAt }),
      complete: async () => assert.fail('must not complete'), status: async () => ({ status: 'CLAIMED' }),
      fail: async (_claim, value) => { failed = value } },
    authority: { resolve: async () => ({ authorized: false, scope: { tenantId: 'other', businessId: 'other', accountId: 'other' } }) },
    context: { prepare: async () => { contextCalls += 1 } },
    workTool: { execute: async () => assert.fail('denied turn should not call WorkToolPort'), status: async () => ({ status: 'NOT_FOUND' }) },
    model: { credential: async () => null, generate: async () => { modelCalls += 1 } },
    delivery: { send: async () => assert.fail('must not send'), status: async () => ({ status: 'READY' }) }, trace: { append: async () => {}, status: async () => ({ status: 'NOT_FOUND' }) },
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
      complete: async () => ({ status: 'READY' }), status: async () => ({ status: 'CLAIMED' }), fail: async () => {} },
    authority: { resolve: async () => ({ authorized: true, version: 1,
      scope: { tenantId: claim.tenantId, businessId: claim.businessId, accountId: claim.accountId } }) },
    context: { prepare: async () => ({ ...turn, workCommand: { operation: 'propose', input: { title: 'Review' } } }) },
    workTool: { execute: async (_claim, _authority, request) => { operationId = request.operationId; return { text: 'Proposed' } }, status: async () => ({ status: 'NOT_FOUND' }) },
    model: { credential: async () => assert.fail('work command should bypass model'), generate: async () => assert.fail('work command should bypass model') },
    delivery: { send: async () => ({ status: 'RECORDED' }), status: async () => ({ status: 'READY' }) }, trace: { append: async () => {}, status: async () => ({ status: 'NOT_FOUND' }) },
  }
  await createConversationRuntime({ ports }).runOne()
  assert.equal(operationId, 'job-1:work-proposal')
})

test('reconciles a READY commit after the completion response is lost without failing or re-running the model', async () => {
  let modelCalls = 0
  let completeCalls = 0
  let failureCalls = 0
  let deliveryCalls = 0
  let completedText
  const ports = {
    job: { claim: async () => claim, renew: async () => ({ version: claim.version, leaseExpiresAt: claim.leaseExpiresAt }),
      complete: async (_claim, value) => {
        completeCalls += 1
        completedText = value.text
        if (completeCalls === 1) throw Object.assign(new Error('response lost after commit'), { code: 'CORE_RESPONSE_LOST' })
        return { status: 'READY', operationId: value.operationId }
      },
      status: async (_claim, operationId) => ({ status: 'READY', operationId }), fail: async () => { failureCalls += 1 } },
    authority: { resolve: async () => ({ authorized: true,
      scope: { tenantId: claim.tenantId, businessId: claim.businessId, accountId: claim.accountId } }) },
    context: { prepare: async () => turn },
    workTool: { execute: async () => assert.fail('normal turn should not call WorkToolPort'), status: async () => ({ status: 'NOT_FOUND' }) },
    model: { credential: async () => ({ provider: 'fake' }), generate: async () => { modelCalls += 1; return 'committed answer' } },
    delivery: { send: async () => { deliveryCalls += 1; return { status: 'RECORDED' } }, status: async () => ({ status: 'READY' }) },
    trace: { append: async () => {}, status: async () => ({ status: 'NOT_FOUND' }) },
  }
  const result = await createConversationRuntime({ ports, now: () => new Date('2026-09-24T00:00:00.000Z') }).runOne()
  assert.equal(result.status, 'RECORDED')
  assert.equal(completeCalls, 1)
  assert.equal(completedText, 'committed answer')
  assert.equal(modelCalls, 1)
  assert.equal(deliveryCalls, 1)
  assert.equal(failureCalls, 0)
})

test('uses the durable Work receipt after mutation response loss and never executes the mutation twice', async () => {
  const mutationId = 'proposal-stable-id'
  let mutationCalls = 0
  let receiptLookups = 0
  let modelCalls = 0
  let completedText
  const ports = {
    job: { claim: async () => claim, renew: async () => ({ version: claim.version, leaseExpiresAt: claim.leaseExpiresAt }),
      complete: async (_claim, value) => { completedText = value.text; return { status: 'READY' } },
      status: async () => ({ status: 'CLAIMED' }), fail: async () => {} },
    authority: { resolve: async () => ({ authorized: true,
      scope: { tenantId: claim.tenantId, businessId: claim.businessId, accountId: claim.accountId } }) },
    context: { prepare: async () => ({ ...turn, workCommand: { operation: 'confirm-execute', input: { proposalId: mutationId } } }) },
    workTool: {
      execute: async (_claim, _authority, request) => {
        assert.equal(request.operationId, mutationId)
        mutationCalls += 1
        throw Object.assign(new Error('response lost after receipt commit'), { code: 'CORE_RESPONSE_LOST' })
      },
      status: async (_claim, operationId) => {
        receiptLookups += 1
        assert.equal(operationId, mutationId)
        return receiptLookups === 1 ? { status: 'NOT_FOUND' }
          : { status: 'COMPLETED', result: { text: 'Work saved', receipt: { proposalId: mutationId } } }
      },
    },
    model: { credential: async () => { modelCalls += 1 }, generate: async () => { modelCalls += 1 } },
    delivery: { send: async () => ({ status: 'RECORDED' }), status: async () => ({ status: 'READY' }) },
    trace: { append: async () => {}, status: async () => ({ status: 'NOT_FOUND' }) },
  }
  const result = await createConversationRuntime({ ports, now: () => new Date('2026-09-24T00:00:00.000Z') }).runOne()
  assert.equal(result.status, 'RECORDED')
  assert.equal(mutationCalls, 1)
  assert.equal(receiptLookups, 2)
  assert.equal(modelCalls, 0)
  assert.equal(completedText, 'Work saved')
})

test('reconciles an existing Work receipt before retrying after a process reclaim', async () => {
  const mutationId = 'proposal-durable-receipt'
  let mutationCalls = 0
  let receiptLookups = 0
  let completedText
  const ports = {
    job: { claim: async () => ({ ...claim, executionId: 'exec-reclaimed', claimantId: 'cr-reclaimed', version: 5 }),
      renew: async () => ({ version: 5, leaseExpiresAt: claim.leaseExpiresAt }),
      complete: async (_claim, value) => { completedText = value.text; return { status: 'READY' } },
      status: async () => ({ status: 'CLAIMED' }), fail: async () => {} },
    authority: { resolve: async () => ({ authorized: true,
      scope: { tenantId: claim.tenantId, businessId: claim.businessId, accountId: claim.accountId } }) },
    context: { prepare: async () => ({ ...turn, workCommand: { operation: 'confirm-execute', input: { proposalId: mutationId } } }) },
    workTool: {
      execute: async () => { mutationCalls += 1; assert.fail('completed Work receipt must be returned before retry') },
      status: async (_claim, operationId) => {
        receiptLookups += 1
        assert.equal(operationId, mutationId)
        return { status: 'COMPLETED', result: { text: 'Work receipt recovered', receipt: { proposalId: mutationId } } }
      },
    },
    model: { credential: async () => assert.fail('Work recovery must not call the model'),
      generate: async () => assert.fail('Work recovery must not call the model') },
    delivery: { send: async () => ({ status: 'RECORDED' }), status: async () => ({ status: 'READY' }) },
    trace: { append: async () => {}, status: async () => ({ status: 'NOT_FOUND' }) },
  }
  const result = await createConversationRuntime({ ports, now: () => new Date('2026-09-24T00:00:00.000Z') }).runOne()
  assert.equal(result.status, 'RECORDED')
  assert.equal(receiptLookups, 1)
  assert.equal(mutationCalls, 0)
  assert.equal(completedText, 'Work receipt recovered')
})

test('does not re-run a provider call with a started receipt after process reclaim', async () => {
  const reclaimed = { ...claim, executionId: 'exec-2', claimantId: 'cr-2', version: 4 }
  let claims = 0
  let modelCalls = 0
  let status = { status: 'NOT_FOUND' }
  let completed = 0
  const ports = {
    job: { claim: async () => (++claims === 1 ? claim : reclaimed), renew: async () => ({ version: claim.version, leaseExpiresAt: claim.leaseExpiresAt }),
      complete: async () => { completed += 1; return { status: 'READY' } },
      status: async () => ({ status: 'CLAIMED' }), fail: async () => {} },
    authority: { resolve: async () => ({ authorized: true,
      scope: { tenantId: claim.tenantId, businessId: claim.businessId, accountId: claim.accountId } }) },
    context: { prepare: async () => turn },
    workTool: { execute: async () => assert.fail('normal turn should not call WorkToolPort'), status: async () => ({ status: 'NOT_FOUND' }) },
    model: { credential: async () => ({ provider: 'fake' }), generate: async () => {
      modelCalls += 1
      status = { status: 'STARTED', executionId: claim.executionId }
      throw Object.assign(new Error('provider response was lost'), { code: 'MODEL_PROVIDER_NETWORK_ERROR', outcome: 'UNKNOWN' })
    } },
    delivery: { send: async () => assert.fail('uncertain provider result must not be delivered'), status: async () => ({ status: 'READY' }) },
    trace: { append: async () => {}, status: async () => status },
  }
  const runtime = createConversationRuntime({ ports, now: () => new Date('2026-09-24T00:00:00.000Z') })
  assert.equal((await runtime.runOne()).status, 'UNKNOWN')
  assert.equal((await runtime.runOne()).status, 'UNKNOWN')
  assert.equal(modelCalls, 1)
  assert.equal(completed, 0)
})

test('runtime construction requires every versioned side-effect port', () => {
  assert.throws(() => createConversationRuntime({ ports: {} }), /RUNTIME_PORTS_REQUIRED/)
})
