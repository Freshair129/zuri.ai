// @req FR-171, FR-150 — content-free execution diagnostics for the operator console.
// @spec ADR-070, SEC-001 — never render arbitrary payloads as operational logs.
// @tested tests/unit/line-trace-summary.test.js
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const bounded = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max
const allowed = (value, values) => values.includes(value) ? value : null

export function lineTraceSummary(event) {
  const parts = []
  if (typeof event.executionId === 'string' && uuid.test(event.executionId)) parts.push(`execution ${event.executionId}`)
  const p = event.payload ?? {}
  const phase = allowed(p.phase, ['CONTEXT_RESOLVED', 'MODEL_SUBMITTED', 'MODEL_COMPLETED', 'MODEL_FAILED', 'MODEL_UNKNOWN', 'STARTED', 'COMPLETED', 'FAILED'])
  if (phase) parts.push(phase)
  const tool = allowed(p.toolName, ['search_project_work', 'propose_work_change', 'search_products', 'quote_price', 'find_within_budget'])
  if (tool) parts.push(tool)
  if (typeof p.modelRef === 'string' && /^(?:openai-compatible|ollama):[a-zA-Z0-9_.:-]{1,100}$/.test(p.modelRef)) parts.push(p.modelRef)
  if (typeof p.receiptId === 'string' && /^ctxrcpt_[a-f0-9-]{36}$/.test(p.receiptId)) parts.push(p.receiptId)
  if (bounded(p.durationMs, 240000)) parts.push(`${p.durationMs} ms`)
  const b = p.executionBudget
  if (b) {
    const mode = allowed(b.deliveryMode, ['REPLY', 'DELAYED_PUSH'])
    if (mode) parts.push(mode)
    if (bounded(b.remainingBudgetMs, 240000)) parts.push(`งบตอน claim ${b.remainingBudgetMs} ms`)
    const end = Date.parse(b.answerDeadlineAt)
    if (Number.isFinite(end)) parts.push(`deadline ${new Date(end).toISOString()}`)
    const done = Date.parse(p.completedAt)
    if (Number.isFinite(end) && Number.isFinite(done)) parts.push(`เหลือเมื่อส่งผล ${Math.max(0, end - done)} ms`)
  }
  const method = allowed(p.method, ['REPLY', 'PUSH'])
  if (method) parts.push(method === 'PUSH' ? 'DELAYED_PUSH' : method)
  const status = allowed(p.providerOutcome, ['ACCEPTED_BY_LINE', 'UNKNOWN', 'PERMANENT_FAILURE', 'RETRYABLE_FAILURE'])
  if (status) parts.push(status)
  if (p.errorCode === 'REPLY_DEADLINE_MISSED') parts.push('DEADLINE_MISSED')
  if (event.kind === 'CONTEXT_RECEIPT' && p.budget) {
    if (bounded(p.budget.used, 65536)) parts.push(`context ${p.budget.used} bytes`)
    if (bounded(p.budget.trimmed, 10000)) parts.push(`ตัด ${p.budget.trimmed} รายการ`)
  }
  return parts.join(' · ')
}
