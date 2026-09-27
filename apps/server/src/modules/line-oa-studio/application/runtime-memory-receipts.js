import { createHash } from 'node:crypto'
import { isLineProjectWorkCommand } from '@/modules/agent/line-project-work-tools'

// @req FR-149 — durable identities of a Conversation Runtime memory turn's Core
//   receipts, shared by the `memory` operation that writes them and the completion
//   transaction that refuses to commit an answer the thread does not hold.
// @spec ADR-106 D2-D4, SDD-110 — Core-owned receipts in the job's scoped trace.
// @tested tests/integration/conversation-runtime-memory.test.js

export const memoryOperationIds = jobId => Object.freeze({
  read: `${jobId}:memory-read`,
  append: `${jobId}:memory-append`,
  injection: `${jobId}:memory-injection`,
})

export const MEMORY_RECEIPT_KINDS = Object.freeze({ read: 'MEMORY_THREAD_READ', append: 'MEMORY_THREAD_APPENDED' })

export const memoryTextSha256 = text => createHash('sha256').update(text, 'utf8').digest('hex')

export function memoryReceiptKey(jobId, name) {
  return `${jobId}:runtime:${memoryOperationIds(jobId)[name]}:${MEMORY_RECEIPT_KINDS[name]}`
}

/** A Work command never touches memory, in either cohort. */
export function isMemoryTurn(job) {
  return job?.memorySyncOptIn === true && !isLineProjectWorkCommand(job?.inbound?.body)
}

/**
 * Throws unless an opted-in turn's answer is exactly the text Core appended to its
 * MSP thread. `db` may be a transaction client.
 */
export async function assertMemoryAnswerAppended(db, job, text) {
  if (!isMemoryTurn(job)) return
  const row = await db.agentTraceEvent.findFirst({ where: { tenantId: job.tenantId, businessId: job.businessId,
    idempotencyKey: memoryReceiptKey(job.id, 'append') } })
  const receipt = row ? JSON.parse(row.payloadJson) : null
  if (!receipt || receipt.redacted === true) throw Object.assign(new Error('MEMORY_APPEND_REQUIRED'), { code: 'MEMORY_APPEND_REQUIRED', status: 409 })
  if (receipt.textSha256 !== memoryTextSha256(text)) {
    throw Object.assign(new Error('MEMORY_APPEND_CONFLICT'), { code: 'MEMORY_APPEND_CONFLICT', status: 409 })
  }
}
