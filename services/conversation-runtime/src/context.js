import { createHash } from 'node:crypto'

// @req FR-234, FR-235 — compose one authorized, bounded turn packet.
// @spec ADR-091 D7, ADR-106 D1, SDD-108 — source precedence and thread isolation.
// @tested services/conversation-runtime/test/turn-runtime.test.js
const PRIORITY = Object.freeze({ RECORD: 0, KNOWLEDGE: 1, MSP: 2 })

export function composeTurnContext(input) {
  if (typeof input?.authorized !== 'boolean') throw Object.assign(new Error('CONTEXT_AUTHORITY_REQUIRED'), { code: 'CONTEXT_AUTHORITY_REQUIRED' })
  const budget = input.maxBudgetChars
  if (!Number.isInteger(budget) || budget < 0 || budget > 32_000) throw Object.assign(new Error('CONTEXT_BUDGET_INVALID'), { code: 'CONTEXT_BUDGET_INVALID' })
  if (!input.authorized) return Object.freeze({ text: '', slices: [], dropped: [], receipt: receipt([], budget, 0, []) })
  const entries = (input.slices ?? []).filter(item => item && typeof item.text === 'string')
    .map((item, index) => ({ ...item, id: item.id || `slice:${index}`, source: item.source,
      priority: PRIORITY[item.source], length: item.text.length, index }))
  if (entries.some(item => item.priority === undefined)) throw Object.assign(new Error('CONTEXT_SOURCE_INVALID'), { code: 'CONTEXT_SOURCE_INVALID' })
  entries.sort((a, b) => a.priority - b.priority || a.index - b.index)
  let used = 0
  const slices = []
  const dropped = []
  for (const item of entries) {
    const wrongThread = item.source === 'MSP' && input.threadId && item.threadId !== input.threadId
    const audienceDenied = item.source === 'MSP' && input.audienceKind && input.audienceKind !== 'DIRECT'
      && ['PASSPORT', 'CROSS_THREAD'].includes(item.scope)
    if (wrongThread || audienceDenied) {
      dropped.push({ id: item.id, source: item.source, reason: wrongThread ? 'THREAD_SCOPE_MISMATCH' : 'AUDIENCE_SCOPE_DENIED' })
      continue
    }
    if (used + item.length > budget) {
      dropped.push({ id: item.id, source: item.source, reason: 'BUDGET_EXCEEDED' })
      continue
    }
    used += item.length
    slices.push(item)
  }
  const text = slices.map(item => item.text).join('\n')
  return Object.freeze({ text, slices, dropped, receipt: receipt(slices, budget, used, dropped) })
}

function receipt(slices, max, used, dropped) {
  const refs = slices.map(({ id, source, citationId = null }) => ({ id, source, citationId }))
  const facts = { refs, budget: { max, used, trimmed: dropped.length }, dropped }
  return Object.freeze({ ...facts, hash: createHash('sha256').update(JSON.stringify(facts)).digest('hex') })
}
