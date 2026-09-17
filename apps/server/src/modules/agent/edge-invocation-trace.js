import { appendTraceEvent } from './execution-trace'

// @req FR-171, FR-234 — content-free live Edge invocation evidence in the existing journal.
// @spec ADR-070, ADR-091 D7, SEC-001 — logging never blocks inference or grants send rights.
// @tested tests/integration/line-project-work-tools.test.js
const pending = new Set()
const unavailable = () => console.warn('EDGE_INVOCATION_TRACE_UNAVAILABLE')

export function enqueueEdgeInvocationTrace(db, job, { kind, key, payload, occurredAt }) {
  if (pending.size >= 128) { unavailable(); return }
  const event = { scope: { tenantId: job.tenantId, businessId: job.businessId },
    turnId: job.id, executionId: job.executionId, kind,
    idempotencyKey: `${job.id}:${job.executionId}:${key}`, payload, occurredAt }
  const write = async tx => {
    // Reclamation or erasure cannot attribute a late queued callback to the new
    // execution. The journal's own erasure/retention guards run in this transaction.
    const current = await tx.lineConversationJob.findFirst({ where: { id: job.id,
      tenantId: job.tenantId, businessId: job.businessId, executionId: job.executionId,
      version: job.version, claimantId: job.claimantId, status: 'CLAIMED', executionMode: 'EDGE' } })
    if (!current) return
    await appendTraceEvent(tx, event)
  }
  const task = Promise.resolve().then(() => db.$transaction(write, { maxWait: 250, timeout: 1000 }))
    .catch(unavailable).finally(() => pending.delete(task))
  pending.add(task)
}

// Deterministic test/shutdown drain; request handlers never await this.
export async function drainEdgeInvocationTraces() { await Promise.all([...pending]) }
