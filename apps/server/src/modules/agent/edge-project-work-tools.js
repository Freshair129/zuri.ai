import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { createLineProjectWorkTools } from './line-project-work-tools'
import { enqueueEdgeInvocationTrace } from './edge-invocation-trace'

// @req FR-026, FR-072, FR-150 — Edge model tools invoke Server-owned Project/Work authority.
// @spec SEC-001, SEC-025, ADR-061 — no caller scope, raw LINE identity, or confirmation bypass.
// @tested tests/integration/line-project-work-tools.test.js
export const zLineProjectWorkToolCall = z.object({
  version: z.number().int().positive(), executionId: z.string().uuid(),
  toolName: z.enum(['search_project_work', 'propose_work_change']),
  args: z.record(z.unknown()),
}).strict()
const denied = status => { throw Object.assign(new Error('CONVERSATION_TOOL_REQUEST_REJECTED'), { status }) }

export async function executeEdgeProjectWorkTool(jobId, input, { deviceContext, db = prisma, now = () => new Date() } = {}) {
  if (!deviceContext?.isEdgeDevice) denied(401)
  const parsed = zLineProjectWorkToolCall.parse(input)
  if (Buffer.byteLength(JSON.stringify(parsed.args), 'utf8') > 4096) denied(400)
  const expectedClaim = { version: parsed.version, executionId: parsed.executionId,
    credentialId: deviceContext.credentialId, tenantId: deviceContext.tenantId, businessId: deviceContext.businessId }
  const check = async () => {
    const at = new Date(typeof now === 'function' ? now() : now)
    const job = await db.lineConversationJob.findFirst({ where: { id: jobId,
      tenantId: expectedClaim.tenantId, businessId: expectedClaim.businessId, version: expectedClaim.version,
      executionId: expectedClaim.executionId, claimantId: expectedClaim.credentialId, executionMode: 'EDGE',
      status: 'CLAIMED', leaseExpiresAt: { gt: at }, expiresAt: { gt: at } } })
    if (!job) denied(409)
    const commitment = await db.agentTraceEvent.findFirst({ where: {
      turnId: job.id, executionId: job.executionId, tenantId: job.tenantId, businessId: job.businessId,
      idempotencyKey: `${job.id}:execution:${job.executionId}:contract`, kind: 'CONTEXT_COMMITTED',
    } })
    let contract
    try { contract = JSON.parse(commitment?.payloadJson) } catch { denied(409) }
    const deadline = Date.parse(contract?.executionBudget?.answerDeadlineAt)
    if (contract?.contractVersion !== '2' || !['REPLY', 'DELAYED_PUSH'].includes(contract.executionBudget?.deliveryMode)
      || !Number.isFinite(deadline) || deadline <= new Date(typeof now === 'function' ? now() : now).getTime()) denied(409)
    return job
  }
  const job = await check()
  const descriptor = createLineProjectWorkTools(jobId, { db, now, expectedClaim }).find(tool => tool.name === parsed.toolName)
  const toolInvocationId = randomUUID()
  const record = phase => enqueueEdgeInvocationTrace(db, job, {
    kind: phase === 'STARTED' ? 'TOOL_INVOKED' : 'TOOL_RESULT', key: `tool:${toolInvocationId}:${phase}`,
    occurredAt: new Date(typeof now === 'function' ? now() : now),
    payload: { toolName: parsed.toolName, toolInvocationId, phase, evidenceSource: 'SERVER_OBSERVED' },
  })
  record('STARTED')
  try {
    const result = await descriptor.handler(parsed.args)
    await check()
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 16000) denied(413)
    record('COMPLETED')
    return { toolName: parsed.toolName, result }
  } catch (error) { record('FAILED'); throw error }
}
