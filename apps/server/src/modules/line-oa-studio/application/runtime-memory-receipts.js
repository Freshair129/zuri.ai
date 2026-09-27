import { createHash } from 'node:crypto'
import { isLineProjectWorkCommand } from '@/modules/agent/line-project-work-tools'

// @req FR-149 — durable identities of a Conversation Runtime memory turn's Core
//   receipts, shared by the `memory` operation that writes them and the completion
//   transaction that refuses to commit an answer the thread does not hold.
// @spec ADR-106 D2-D4, SDD-110 — Core-owned receipts live in their own trace key
//   namespace (`${jobId}:core-memory:…`). The runtime's `trace` operation writes only
//   under `${jobId}:runtime:…` and only allow-listed kinds, so it cannot write, and so
//   cannot forge, any receipt read here.
// @tested tests/integration/conversation-runtime-memory.test.js

export const memoryOperationIds = jobId => Object.freeze({
  read: `${jobId}:memory-read`,
  append: `${jobId}:memory-append`,
  injection: `${jobId}:memory-injection`,
})

export const MEMORY_RECEIPT_KINDS = Object.freeze({ read: 'MEMORY_THREAD_READ', append: 'MEMORY_THREAD_APPENDED' })

export const memoryTextSha256 = text => createHash('sha256').update(text, 'utf8').digest('hex')

/** The Core-only key of one memory receipt or note of this job. */
export function coreMemoryKey(jobId, name, kind) {
  return `${jobId}:core-memory:${name}:${kind}`
}

export function memoryReceiptKey(jobId, name) {
  return coreMemoryKey(jobId, name, MEMORY_RECEIPT_KINDS[name])
}

/** Load one Core receipt of this job, matching turn, kind and key. `db` may be a transaction client. */
export async function loadMemoryReceipt(db, job, name) {
  const row = await db.agentTraceEvent.findFirst({ where: { tenantId: job.tenantId, businessId: job.businessId,
    turnId: job.id, kind: MEMORY_RECEIPT_KINDS[name], idempotencyKey: memoryReceiptKey(job.id, name) } })
  if (!row) return null
  const payload = JSON.parse(row.payloadJson)
  // An erased turn's trace is a tombstone; nothing in it may be replayed.
  if (payload?.redacted === true) {
    throw Object.assign(new Error('LINE_MEMORY_JOB_ERASED'), { code: 'LINE_MEMORY_JOB_ERASED', status: 409 })
  }
  return payload
}

/** A Work command never touches memory, in either cohort. */
export function isMemoryTurn(job) {
  return job?.memorySyncOptIn === true && !isLineProjectWorkCommand(job?.inbound?.body)
}

/**
 * Throws unless the answer is exactly the text Core appended to the MSP thread,
 * for every job that is a memory turn or that Core has already read memory for.
 * `db` may be a transaction client.
 */
export async function assertMemoryAnswerAppended(db, job, text) {
  if (!isMemoryTurn(job) && !(await loadMemoryReceipt(db, job, 'read'))) return
  const receipt = await loadMemoryReceipt(db, job, 'append')
  if (!receipt) throw Object.assign(new Error('MEMORY_APPEND_REQUIRED'), { code: 'MEMORY_APPEND_REQUIRED', status: 409 })
  if (receipt.textSha256 !== memoryTextSha256(text)) {
    throw Object.assign(new Error('MEMORY_APPEND_CONFLICT'), { code: 'MEMORY_APPEND_CONFLICT', status: 409 })
  }
}
