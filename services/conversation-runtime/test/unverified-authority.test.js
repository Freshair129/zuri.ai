import test from 'node:test'
import assert from 'node:assert/strict'
import { createCoreClient } from '../src/core-client.js'
import { createConversationRuntime } from '../src/turn-runtime.js'

// @req FR-149 — an unverified LINE sender's turn (ADR-106 D3, owner ruling 2026-09-27):
// Core's `resolve` names no person and says UNVERIFIED. The runtime accepts that shape
// only exactly, never names a person itself, and ends the turn when two resolves of one
// turn disagree, so an authority cannot change under a running turn.
const claim = { jobId: 'job-u', executionId: 'exec-u', claimantId: 'cr-u', tenantId: 'tenant-u', businessId: 'business-u',
  accountId: 'account-u', version: 2, leaseExpiresAt: '2026-09-24T00:05:00.000Z', deadlineAt: '2026-09-24T00:04:00.000Z' }
const unverifiedScope = { tenantId: claim.tenantId, businessId: claim.businessId, accountId: claim.accountId,
  identityId: null, identityVersion: null, identityState: 'UNVERIFIED' }
const verifiedScope = { tenantId: claim.tenantId, businessId: claim.businessId, accountId: claim.accountId,
  identityId: 'identity-1', identityVersion: 1 }
const turn = { question: 'มีสินค้าอะไรบ้าง', evidence: { records: [{ product: 'synthetic' }] }, authorized: true, slices: [],
  audienceKind: 'DIRECT', threadId: null, maxBudgetChars: 0, workCommand: null }

function portsWith(resolves, sink) {
  let calls = 0
  return {
    job: { claim: async () => ({ ...claim }), renew: async () => ({ version: claim.version, leaseExpiresAt: claim.leaseExpiresAt }),
      complete: async (_claim, result) => { sink.completed = result.text; return { status: 'READY', operationId: result.operationId } },
      status: async (_claim, operationId) => ({ status: 'CLAIMED', operationId }),
      fail: async (_claim, result) => { sink.failed = result } },
    authority: { resolve: async () => resolves[Math.min(calls++, resolves.length - 1)] },
    context: { prepare: async () => turn },
    workTool: { execute: async () => assert.fail('no Work tool on an ordinary turn'), status: async () => ({ status: 'NOT_FOUND' }) },
    model: { credential: async () => ({ provider: 'fake', model: 'controlled', apiKey: 'synthetic-key' }),
      generate: async () => { sink.modelCalls = (sink.modelCalls ?? 0) + 1; return 'คำตอบทดสอบ' } },
    delivery: { send: async () => ({ status: 'RECORDED' }), status: async () => ({ status: 'READY', operationId: `${claim.jobId}:delivery` }) },
    trace: { append: async () => {}, status: async () => ({ status: 'NOT_FOUND' }) },
  }
}

test('an unverified sender turn runs with no person and completes', async () => {
  const sink = {}
  const result = await createConversationRuntime({ ports: portsWith([{ authorized: true, version: 1, scope: unverifiedScope }], sink),
    now: () => new Date('2026-09-24T00:00:00.000Z') }).runOne()
  assert.equal(result.status, 'RECORDED')
  assert.equal(sink.completed, 'คำตอบทดสอบ')
  assert.equal(sink.modelCalls, 1)
})

test('an authority that changes between the two resolves of one turn ends it before the model', async () => {
  for (const [first, second] of [[unverifiedScope, verifiedScope], [verifiedScope, unverifiedScope]]) {
    const sink = {}
    const result = await createConversationRuntime({ ports: portsWith([{ authorized: true, version: 1, scope: first },
      { authorized: true, version: 1, scope: second }], sink), now: () => new Date('2026-09-24T00:00:00.000Z') }).runOne()
    assert.equal(result.code, 'CONVERSATION_IDENTITY_CHANGED')
    assert.equal(sink.modelCalls, undefined)
    assert.equal(sink.completed, undefined)
  }
})

test('an UNVERIFIED scope that names a person, or a person-less scope without the state, is denied', async () => {
  for (const scope of [{ ...unverifiedScope, identityId: 'identity-1' }, { ...unverifiedScope, identityVersion: 1 },
    { ...unverifiedScope, identityState: undefined }, { ...verifiedScope, identityState: 'VERIFIED' }]) {
    const sink = {}
    const result = await createConversationRuntime({ ports: portsWith([{ authorized: true, version: 1, scope }], sink),
      now: () => new Date('2026-09-24T00:00:00.000Z') }).runOne()
    assert.equal(result.code, 'AUTHORITY_DENIED')
    assert.equal(sink.modelCalls, undefined)
  }
})

test('the Core client accepts the two resolve shapes Core emits and nothing in between', async () => {
  const respond = data => createCoreClient({ baseUrl: 'http://core:3000', token: 't'.repeat(40), fetchFn: async () =>
    new Response(JSON.stringify({ contractVersion: 'conversation-runtime.v1', ok: true, data }), { status: 200, headers: { 'content-type': 'application/json' } }) })
  const ref = { jobId: 'j', executionId: 'e', claimantId: 'c', version: 1, tenantId: 't', businessId: 'b', accountId: 'a' }
  const call = data => respond(data).call('resolve', { claim: ref })
  assert.deepEqual(await call({ authorized: true, version: 1, scope: unverifiedScope }), { authorized: true, version: 1, scope: unverifiedScope })
  assert.deepEqual(await call({ authorized: true, version: 1, scope: verifiedScope }), { authorized: true, version: 1, scope: verifiedScope })
  for (const scope of [{ ...unverifiedScope, identityId: 'identity-1' }, { ...unverifiedScope, identityState: 'VERIFIED' },
    { ...unverifiedScope, identityState: undefined }, { ...verifiedScope, identityState: 'UNVERIFIED' }]) {
    await assert.rejects(call({ authorized: true, version: 1, scope: JSON.parse(JSON.stringify(scope)) }), { code: 'CORE_RESPONSE_INVALID' })
  }
})
