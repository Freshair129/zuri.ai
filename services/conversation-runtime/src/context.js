import { createHash, randomUUID } from 'node:crypto'

// @req FR-234, FR-235 — compose one authorized, bounded turn packet.
// @spec ADR-091 D7, ADR-106 D1, SDD-110 — source precedence and thread isolation.
// @tested services/conversation-runtime/test/turn-runtime.test.js
const PRIORITY = Object.freeze({ RECORD: 0, KNOWLEDGE: 1, MSP: 2 })
const RECEIPT_MAX_BYTES = 7 * 1024

export function composeTurnContext(input) {
  if (typeof input?.authorized !== 'boolean') throw Object.assign(new Error('CONTEXT_AUTHORITY_REQUIRED'), { code: 'CONTEXT_AUTHORITY_REQUIRED' })
  const budget = input.maxBudgetChars
  if (!Number.isInteger(budget) || budget < 0 || budget > 32_000) throw Object.assign(new Error('CONTEXT_BUDGET_INVALID'), { code: 'CONTEXT_BUDGET_INVALID' })
  if (input.receiptId !== undefined && (typeof input.receiptId !== 'string'
    || !/^ctxrcpt_[0-9a-f-]{36}$/.test(input.receiptId))) {
    throw Object.assign(new Error('CONTEXT_RECEIPT_ID_INVALID'), { code: 'CONTEXT_RECEIPT_ID_INVALID' })
  }
  if (!input.authorized) return Object.freeze({ text: '', slices: [], dropped: [], receipt: receipt([], budget, 0, [], input.receiptId) })
  const entries = (input.slices ?? []).filter(item => item && typeof item.text === 'string')
    .map((item, index) => ({ ...item, id: item.id || `slice:${index}`, source: item.source,
      priority: PRIORITY[item.source], length: item.text.length, index }))
  if (entries.some(item => item.priority === undefined)) throw Object.assign(new Error('CONTEXT_SOURCE_INVALID'), { code: 'CONTEXT_SOURCE_INVALID' })
  entries.sort((a, b) => a.priority - b.priority || a.index - b.index)
  if (entries.length > 64) throw Object.assign(new Error('CONTEXT_SLICE_LIMIT'), { code: 'CONTEXT_SLICE_LIMIT' })
  let used = 0
  const slices = []
  const dropped = []
  const recordSubjects = new Set(entries.filter(item => item.source === 'RECORD').map(item => item.subjectKey).filter(Boolean))
  const closedSequences = new Set()
  for (const item of entries) {
    const wrongThread = item.source === 'MSP' && item.scope !== 'CROSS_THREAD'
      && input.threadId && item.threadId !== input.threadId
    const audienceDenied = item.source === 'MSP' && ['PASSPORT', 'CROSS_THREAD'].includes(item.scope)
      && input.audienceKind !== 'DIRECT'
    if (wrongThread || audienceDenied) {
      dropped.push({ id: item.id, source: item.source, reason: wrongThread ? 'THREAD_SCOPE_MISMATCH' : 'AUDIENCE_SCOPE_DENIED' })
      continue
    }
    if (item.source === 'MSP' && item.subjectKey && recordSubjects.has(item.subjectKey)) {
      dropped.push({ id: item.id, source: item.source, reason: 'SUPERSEDED_BY_RECORD' })
      continue
    }
    const sequenceKey = item.sequence ? `${item.source}:${item.sequence}` : null
    if ((sequenceKey && closedSequences.has(sequenceKey)) || used + item.length > budget) {
      if (sequenceKey) closedSequences.add(sequenceKey)
      dropped.push({ id: item.id, source: item.source, reason: 'BUDGET_TRIMMED' })
      continue
    }
    used += item.length
    slices.push(item)
  }
  const text = slices.map(item => item.text).join('\n')
  return Object.freeze({ text, slices, dropped, receipt: receipt(slices, budget, used, dropped, input.receiptId) })
}

function receipt(slices, max, used, dropped, receiptId) {
  const refs = {
    msp: slices.filter(item => item.source === 'MSP').map(item => item.id),
    citations: slices.filter(item => item.source === 'KNOWLEDGE').map(item => item.citationId ?? item.id),
    records: slices.filter(item => item.source === 'RECORD').map(item => item.id),
  }
  const facts = { refs, budget: { max, used, trimmed: dropped.filter(item => item.reason === 'BUDGET_TRIMMED').length }, dropped }
  const value = { receiptId: receiptId ?? `ctxrcpt_${randomUUID()}`, ...facts,
    hash: createHash('sha256').update(JSON.stringify(facts)).digest('hex') }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > RECEIPT_MAX_BYTES) {
    throw Object.assign(new Error('CONTEXT_RECEIPT_TOO_LARGE'), { code: 'CONTEXT_RECEIPT_TOO_LARGE' })
  }
  return Object.freeze(value)
}
