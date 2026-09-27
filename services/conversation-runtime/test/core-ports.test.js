import test from 'node:test'
import assert from 'node:assert/strict'
import { createCorePorts } from '../src/core-ports.js'

// @req FR-149 — the runtime's WorkToolPort and sibling ports address one Core operation each.
// @spec ADR-106 D2, SDD-110 — fixed operation names, claim reference and stable idempotency keys.
const claim = {
  jobId: 'job-1', executionId: 'exec-1', claimantId: 'runtime-a', version: 3,
  tenantId: 'tenant-1', businessId: 'business-1', accountId: 'account-1',
  leaseExpiresAt: '2030-01-01T00:00:00.000Z', deadlineAt: '2030-01-01T00:01:00.000Z',
  correlationId: 'corr-1', phase: 'EXECUTION',
}
const claimRef = { jobId: 'job-1', executionId: 'exec-1', claimantId: 'runtime-a', version: 3,
  tenantId: 'tenant-1', businessId: 'business-1', accountId: 'account-1' }

function recordingClient() {
  const calls = []
  return { calls, call: async (operation, payload, options) => { calls.push({ operation, payload, options }); return { ok: true } } }
}

test('WorkToolPort sends the fixed work-tool operation with the claim reference and the request identity', async () => {
  const client = recordingClient()
  const signal = new AbortController().signal
  const ports = createCorePorts({ client, model: { generate: async () => 'unused' }, signal })
  const request = { operation: 'propose', operationId: 'job-1:work-proposal',
    input: { action: 'create_work', targetId: '00000000-0000-4000-8000-000000000000', args: { title: 'x' } } }
  await ports.workTool.execute(claim, { version: 3 }, request)
  await ports.workTool.status(claim, 'job-1:work-proposal')
  assert.deepEqual(client.calls.map(({ operation, payload }) => ({ operation, payload })), [
    { operation: 'work-tool', payload: { claim: claimRef, ...request } },
    { operation: 'work-tool', payload: { claim: claimRef, operation: 'status', operationId: 'job-1:work-proposal', input: {} } },
  ])
  assert.equal(client.calls[0].options.idempotencyKey, 'job-1:work-proposal')
  assert.equal(client.calls[1].options.idempotencyKey, 'work-status:job-1:work-proposal')
  for (const { options } of client.calls) {
    assert.equal(options.correlationId, 'corr-1')
    assert.equal(options.deadlineAt, claim.deadlineAt)
    assert.equal(options.signal, signal)
  }
})

test('claims are refused while Core readiness is not established', async () => {
  const client = recordingClient()
  let ready = false
  const ports = createCorePorts({ client, model: { generate: async () => 'unused' }, isCoreReady: () => ready })
  assert.throws(() => ports.job.claim({ claimantId: 'runtime-a' }), /CORE_RUNTIME_OWNER_MISMATCH/)
  assert.equal(client.calls.length, 0)
  ready = true
  await ports.job.claim({ claimantId: 'runtime-a' })
  assert.equal(client.calls[0].operation, 'claim')
  assert.deepEqual(client.calls[0].payload, { claimantId: 'runtime-a' })
})

test('non-claim ports are not gated on readiness so in-flight turns can finish during drain', async () => {
  const client = recordingClient()
  const ports = createCorePorts({ client, model: { generate: async () => 'unused' }, isCoreReady: () => false })
  await ports.workTool.status(claim, 'job-1:work-read')
  await ports.job.complete(claim, { text: 'answer', operationId: 'job-1:turn-answer' })
  assert.deepEqual(client.calls.map(call => call.operation), ['work-tool', 'complete'])
  assert.equal(client.calls[1].options.idempotencyKey, 'complete:job-1:exec-1')
})
