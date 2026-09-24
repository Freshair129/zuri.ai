import { dayKey, orderCode, paymentCode } from '../../../kernel/commerce/commerce.js'
import * as repo from '../adapters/commerce-repo.js'

// Human codes ORD-/PAY-YYYYMMDD-NNN per Tenant, same probe as legacy. Runs inside
// the writer's unit of work (the lock makes count→probe→insert race-free here).
const SPEC = {
  SalesOrder: { prefix: 'ORD', codeFor: orderCode, exhausted: 'SALES_ORDER_CODE_EXHAUSTED' },
  Payment: { prefix: 'PAY', codeFor: paymentCode, exhausted: 'PAYMENT_CODE_EXHAUSTED' },
}

export function nextCommerceCode(sql, kind, business, now) {
  const { prefix, codeFor, exhausted } = SPEC[kind]
  const date = new Date(now)
  const head = `${prefix}-${dayKey(date).replace(/-/g, '')}-`
  const count = repo.countCodesWithPrefix(sql, kind, business.tenantId, head)
  for (let seq = count + 1; seq < count + 50; seq += 1) {
    const code = codeFor(date, seq)
    if (!repo.codeTaken(sql, kind, business.tenantId, code)) return code
  }
  throw Object.assign(new Error(exhausted), { status: 409, code: exhausted, retryable: false })
}
