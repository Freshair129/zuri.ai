import { z } from 'zod'
import { createHash } from 'node:crypto'
import prisma from '@/lib/db'
import { createEdgeLineMemoryContext } from './edge-line-memory-context'
import { enqueueEdgeInvocationTrace } from './edge-invocation-trace'

// @req FR-232, FR-234 — revalidate ephemeral memory immediately before each
// Edge model invocation. Refuse stale/erased/relinked context, return no memory.
// @spec ADR-091 D7, SEC-018, SEC-025
// @tested tests/unit/edge-memory-invocation.test.js
export const zEdgeMemoryInvocation = z.object({ version: z.number().int().positive(),
  executionId: z.string().uuid(), contextHash: z.string().regex(/^[a-f0-9]{64}$/),
  injection: z.object({ id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),
    modelRef: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/),
    state: z.enum(['RESOLVED', 'SUBMITTED', 'COMPLETED', 'FAILED', 'UNKNOWN']),
    mspRefs: z.array(z.string().min(1).max(256)).max(24) }).strict().optional(),
}).strict()
const denied = status => { throw Object.assign(new Error('CONTEXT_INVOCATION_REJECTED'), { status }) }
export async function validateEdgeMemoryInvocation(jobId, input, { deviceContext, db = prisma,
  now = () => new Date(), contextBuilder = createEdgeLineMemoryContext() } = {}) {
  if (!deviceContext?.isEdgeDevice) denied(401)
  const parsed = zEdgeMemoryInvocation.parse(input)
  const job = await db.lineConversationJob.findFirst({ where: { id: jobId,
    tenantId: deviceContext.tenantId, businessId: deviceContext.businessId,
    version: parsed.version, executionId: parsed.executionId, claimantId: deviceContext.credentialId,
    status: 'CLAIMED', executionMode: 'EDGE' }, include: { account: true, inbound: { include: { conversation: true } } } })
  if (!job || !job.leaseExpiresAt || job.leaseExpiresAt <= now() || job.expiresAt <= now()
    || job.memorySyncOptIn !== true || job.errorCode === 'PDPA_ERASURE') denied(409)
  const account = job.account
  if (!account || account.serverEnabled !== true || account.status !== 'CONNECTED'
    || account.transportMode !== 'CLOUD' || account.transportEpoch !== job.transportEpoch) denied(409)
  const commitment = await db.agentTraceEvent.findFirst({ where: {
    turnId: job.id, executionId: parsed.executionId,
    tenantId: deviceContext.tenantId, businessId: deviceContext.businessId,
    idempotencyKey: `${job.id}:execution:${parsed.executionId}:contract`, kind: 'CONTEXT_COMMITTED',
  } })
  let contract
  try { contract = JSON.parse(commitment?.payloadJson) } catch { denied(409) }
  if (contract?.contractVersion !== '2' || contract.memoryContextHash !== parsed.contextHash
    || !['REPLY', 'DELAYED_PUSH'].includes(contract.executionBudget?.deliveryMode)) denied(409)
  // The original claim owns the budget. A later check must neither shorten a
  // negotiated delayed push to the reply window nor start a fresh deadline.
  const answerDeadlineAt = new Date(contract.executionBudget.answerDeadlineAt)
  if (!Number.isFinite(answerDeadlineAt.getTime())) denied(409)
  const budgetMs = Math.min(3000, answerDeadlineAt.getTime() - now().getTime())
  if (budgetMs < 1) denied(409)
  let binding
  const packet = await contextBuilder({ ...job, answerDeadlineAt: answerDeadlineAt.toISOString() }, {
    memoryStateReader: id => db.lineConversationJob.findUnique({ where: { id }, include: { account: true } }), budgetMs,
    onContextResolved: value => { binding = value } })
  if (!packet || packet.contextHash !== parsed.contextHash || now() >= answerDeadlineAt) denied(409)
  if (parsed.injection) {
    const { id, modelRef, state, mspRefs } = parsed.injection
    if (!binding || typeof binding.port?.recordInjection !== 'function') denied(503)
    const selected = new Set(mspRefs)
    if (selected.size !== mspRefs.length || mspRefs.some(ref => !binding.slices.some(slice => slice.id === ref))) denied(409)
    const slices = mspRefs.map(ref => binding.slices.find(slice => slice.id === ref))
    const packetHash = createHash('sha256').update(JSON.stringify({ threadId: binding.threadId, slices })).digest('hex')
    const occurredAt = now()
    await binding.port.recordInjection({ threadId: binding.threadId, exchangeId: binding.exchangeId,
      injectionId: id, packetHash, modelRef, state, authorization: binding.authorization, requesterId: binding.requesterId })
    enqueueEdgeInvocationTrace(db, job, {
      kind: state === 'COMPLETED' ? 'MODEL_COMPLETED' : state === 'FAILED' ? 'MODEL_FAILED' : 'EVIDENCE_SELECTED',
      key: `model:${id}:${state}`, occurredAt,
      payload: { phase: state === 'RESOLVED' ? 'CONTEXT_RESOLVED' : `MODEL_${state}`,
        receiptId: id, modelRef, evidenceSource: 'EDGE_REPORTED', snapshotState: 'CONTENT_NOT_RETAINED' },
    })
  }
  if (now() >= answerDeadlineAt || now() >= job.leaseExpiresAt || now() >= job.expiresAt) denied(409)
}
