import { randomUUID } from 'node:crypto'
import { appendTraceEvent, sha256 } from './execution-trace'

// @req FR-171 — preserve the evidence and exact model inputs used by a SERVER job.
// @spec ADR-070, ADR-061, SEC-001 — public-only remains the default; an opted-in
// worker records the bounded MSP context packet used by the model.
// @tested tests/integration/server-line-trace.test.js

const digest = sha256

/** Composed only by the authenticated worker after it has acquired a job lease. */
export function createLineExecutionTrace({ db, job }) {
  const scope = { tenantId: job.tenantId, businessId: job.businessId }
  let failure = null
  let retrieval = null
  let memoryContext = null
  const contextStartedAt = new Date().toISOString()
  async function record(kind, key, payload) {
    try {
      return await appendTraceEvent(db, { scope, turnId: job.id, executionId: job.executionId,
        kind, idempotencyKey: `${job.executionId}:${key}`, payload, occurredAt: new Date() })
    } catch (error) {
      const code = ['EXECUTION_TRACE_PAYLOAD_TOO_LARGE', 'EXECUTION_TRACE_SECRET_FIELD'].includes(error?.code)
        ? error.code : 'EXECUTION_TRACE_UNAVAILABLE'
      failure = Object.assign(new Error(code), { code })
      throw failure
    }
  }
  return {
    assertHealthy() { if (failure) throw failure },
    async recordEvidence(query, evidence) {
      retrieval = { retrievalRunId: randomUUID(), source: 'BUSINESS_QUERY', query, evidence,
        snapshotHash: digest(evidence), observedAt: new Date().toISOString() }
      await record('EVIDENCE_SELECTED', `retrieval:${retrieval.retrievalRunId}`, retrieval)
    },
    recordThreadMemory(details) {
      // The packet is persisted with CONTEXT_COMMITTED by beforeModelCall. Keeping
      // this setter synchronous ensures a failed provider never races a second
      // trace write, while the existing trace observer remains the write boundary.
      memoryContext = details && typeof details === 'object' ? details : null
    },
    async beforeModelCall({ provider, model, requestBody, promptVersion, systemPrompt }) {
      if (failure) throw failure
      const ctxId = randomUUID()
      const modelCallId = randomUUID()
      const handle = { ctxId, modelCallId }
      const packet = memoryContext?.contextPacket
      const privateContextDisposition = packet?.policyDecision === 'ALLOW' ? 'MSP_CONTEXT' : 'EXCLUDED_BY_POLICY'
      await record('CONTEXT_COMMITTED', `ctx:${ctxId}`, {
        ...handle, schemaVersion: '0.3', assemblerVersion: 'server-line-v1', provider, model,
        sessionId: packet?.thread?.sessionId ?? null, soul: null,
        memory: packet?.memory ?? [], history: packet?.memory?.recentExchanges ?? [], documents: [], tools: [],
        privateContextDisposition,
        threadMemory: packet ? {
          thread: packet.thread ?? null,
          manifest: packet.manifest ?? null,
          exchangeId: memoryContext?.exchangeId ?? null,
          inboundMessageId: memoryContext?.inboundMessageId ?? null,
        } : null,
        authorizationReceipt: { ...scope, accountId: job.accountId, transportEpoch: job.transportEpoch,
          modelAccess: job.modelAccess, executionMode: job.executionMode },
        systemPrompt: systemPrompt ?? { version: promptVersion, availability: 'NOT_REPORTED' },
        retrievalRunId: retrieval?.retrievalRunId ?? null,
        requestBody, requestHash: digest(requestBody), contextStartedAt, contextReadyAt: new Date().toISOString(),
      })
      return handle
    },
    async afterModelCall(result) {
      const { handle, ...details } = result
      if (!handle?.ctxId || !handle?.modelCallId) throw new Error('EXECUTION_TRACE_HANDLE_REQUIRED')
      await record(result.errorCode ? 'MODEL_FAILED' : 'MODEL_COMPLETED',
        `model:${handle.modelCallId}:result`, { ...handle, ...details })
    },
  }
}
