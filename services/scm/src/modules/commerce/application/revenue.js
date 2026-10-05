import { z } from 'zod'
import { fromSatang, revenueSummary } from '../../../kernel/commerce/commerce.js'
import { commerceAuthority } from '../../../infrastructure/delegation.js'
import * as repo from '../adapters/commerce-repo.js'

// Revenue read model (FR-163) inside SCM — port of apps/server
// revenue-read-model.getRevenueSummary over the SCM store, with the SAME pure
// calculator (kernel `revenueSummary`): VERIFIED payments net of VERIFIED
// refunds, by origin and by Bangkok day of payment, pending money beside it and
// never inside it, rejected money never counted. Read-only: exports no writer.
// Reading needs the `commerce` domain (404 otherwise, FR-072).

const zDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
export const zRevenueQuery = z.object({
  businessId: z.string().trim().min(1).max(200),
  from: zDay.optional(),
  to: zDay.optional(),
}).strict()

export function getRevenueSummary(sql, scope, query) {
  const q = zRevenueQuery.parse(query)
  const business = commerceAuthority.require(scope, q.businessId)
  const orders = repo.ordersForRevenue(sql, business.id)
  const summary = revenueSummary(orders, { from: q.from ?? null, to: q.to ?? null })
  return {
    businessId: business.id,
    from: q.from ?? null,
    to: q.to ?? null,
    verifiedNet: fromSatang(summary.verifiedNet),
    refunded: fromSatang(summary.refunded),
    byOrigin: Object.fromEntries(Object.entries(summary.byOrigin).map(([k, v]) => [k, fromSatang(v)])),
    byDay: summary.byDay.map((d) => ({ day: d.day, net: fromSatang(d.net) })),
    pending: { count: summary.pending.count, amount: fromSatang(summary.pending.amount) },
    orders: {
      open: orders.filter((o) => o.status === 'DRAFT' || o.status === 'CONFIRMED').length,
      completed: orders.filter((o) => o.status === 'COMPLETED').length,
    },
  }
}
