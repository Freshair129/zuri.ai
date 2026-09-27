// @req FR-149 — the runtime's side of every conversation-runtime.v1 port.
// @spec ADR-106 D2-D4, SDD-110 — each port maps to one authenticated Core operation
// with a stable idempotency key; the runtime never talks to a store directly.
// @tested services/conversation-runtime/test/core-ports.test.js

function randomNonce() { return `${Date.now()}:${Math.random().toString(36).slice(2)}` }

/**
 * Build the port object `createConversationRuntime` consumes from a Core client.
 * `isCoreReady` gates new claims on Core health; `signal` aborts in-flight calls on
 * shutdown. The composition root owns both.
 */
export function createCorePorts({ client, model, isCoreReady = () => true, signal } = {}) {
  const ref = claim => ({ jobId: claim.jobId, executionId: claim.executionId, claimantId: claim.claimantId,
    version: claim.version, tenantId: claim.tenantId, businessId: claim.businessId, accountId: claim.accountId })
  const call = (operation, payload, idempotencyKey, claim) => {
    if (operation === 'claim' && !isCoreReady()) throw Object.assign(new Error('CORE_RUNTIME_OWNER_MISMATCH'), { code: 'CORE_RUNTIME_OWNER_MISMATCH' })
    return client.call(operation, payload, {
      correlationId: claim?.correlationId,
      idempotencyKey: idempotencyKey ?? `${operation}:${claim?.jobId ?? 'poll'}:${Date.now()}`,
      deadlineAt: claim?.deadlineAt ?? new Date(Date.now() + 10_000).toISOString(), signal,
    })
  }
  return {
    job: {
      claim: ({ claimantId }) => call('claim', { claimantId }, `claim:${claimantId}:${randomNonce()}`),
      renew: claim => call('renew', { claim: ref(claim) }, `renew:${claim.jobId}:${claim.executionId}:${Date.now()}`, claim),
      complete: (claim, result) => call('complete', { claim: ref(claim), ...result }, `complete:${claim.jobId}:${claim.executionId}`, claim),
      fail: (claim, result) => call('fail', { claim: ref(claim), ...result }, `fail:${claim.jobId}:${claim.executionId}`, claim),
      status: (claim, operationId) => call('status', { claim: ref(claim), operationId }, `status:${operationId}`, claim),
    },
    authority: { resolve: claim => call('resolve', { claim: ref(claim) }, `authority:${claim.jobId}:${claim.executionId}`, claim) },
    context: { prepare: (claim, authority) => call('prepare', { claim: ref(claim), authorityVersion: authority.version }, `context:${claim.jobId}:${claim.executionId}`, claim) },
    workTool: {
      execute: (claim, _authority, request) => call('work-tool', { claim: ref(claim), ...request }, request.operationId, claim),
      status: (claim, operationId) => call('work-tool', { claim: ref(claim), operation: 'status', operationId, input: {} }, `work-status:${operationId}`, claim),
    },
    model: {
      credential: claim => call('credential', { claim: ref(claim) }, `credential:${claim.jobId}:${claim.executionId}`, claim),
      generate: input => model.generate(input),
    },
    delivery: {
      send: claim => call('send', { claim: ref(claim), operationId: `${claim.jobId}:${claim.executionId}:delivery` }, `delivery:${claim.jobId}:${claim.executionId}`, claim),
      status: claim => call('status', { claim: ref(claim), operationId: `${claim.jobId}:delivery` }, `delivery-status:${claim.jobId}:${claim.executionId}`, claim),
    },
    trace: {
      append: (claim, event) => call('trace', { claim: ref(claim), ...event }, `trace:${claim.jobId}:${event.payload?.operationId ?? claim.executionId}:${event.kind}`, claim),
      status: (claim, operationId) => call('status', { claim: ref(claim), operationId }, `operation-status:${operationId}`, claim),
    },
  }
}
