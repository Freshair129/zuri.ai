import { fromSatang, lineTotalSatang, orderTotals, paymentState, paymentSummary } from '../../../kernel/commerce/commerce.js'
import { commerceAuthority, denied } from '../../../infrastructure/delegation.js'
import * as repo from '../adapters/commerce-repo.js'

// Sales-order read model inside SCM — the legacy orderDto: every money figure is
// recomputed from lines and VERIFIED payments on read, never stored (ADR-065).
// D-5: `customer` is the id reference only (plus the code the CRM owner returned
// at write time, when present); display names are read from CRM, not copied here.

const lineDto = (l) => ({ id: l.id, productId: l.productId, description: l.description, qty: l.qty, unitPrice: fromSatang(l.unitPriceSatang), discount: fromSatang(l.discountSatang), lineTotal: fromSatang(lineTotalSatang(l)) })
const paymentDto = (p) => ({ ...p, amount: fromSatang(p.amountSatang), amountSatang: undefined })

export function orderDto(row, customerRef = null) {
  const { lines, payments, discountSatang, ...order } = row
  const totals = orderTotals(lines, discountSatang)
  const summary = paymentSummary(payments)
  return {
    ...order,
    customer: order.customerId ? { id: order.customerId, ...(customerRef?.code ? { code: customerRef.code } : {}) } : null,
    attributed: Boolean(order.conversationId),
    discount: fromSatang(discountSatang),
    subtotal: fromSatang(totals.subtotal),
    lineDiscount: fromSatang(totals.lineDiscount),
    total: fromSatang(totals.total),
    paid: fromSatang(summary.paid),
    refunded: fromSatang(summary.refunded),
    net: fromSatang(summary.net),
    pending: fromSatang(summary.pending),
    balanceDue: fromSatang(Math.max(0, totals.total - summary.net)),
    paymentState: paymentState(totals.total, summary),
    lines: lines.map(lineDto),
    payments: payments.map(paymentDto),
  }
}

export function getOrder(sql, scope, id) {
  const orderId = typeof id === 'string' ? id.trim() : ''
  const row = orderId ? repo.loadOrder(sql, orderId) : null
  if (!row || row.tenantId !== scope.tenantId) throw denied()
  commerceAuthority.require(scope, row.businessId)
  return orderDto(row)
}
