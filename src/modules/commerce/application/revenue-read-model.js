import { z } from 'zod'
import prisma from '@/lib/db'
import { fromSatang, revenueSummary } from '../domain/commerce'
import { loadBusiness } from './commerce-authority'

// @req FR-159 — the revenue read model: verified payments net of verified
//   refunds, by origin (CHAT — the legacy "ads revenue", attributed to a
//   Conversation — WALK_IN, ONLINE) and by day in the Business's calendar,
//   with pending money reported beside it and never inside it. Read-only by
//   construction: this module exports no writer. Reading needs Business
//   visibility plus the `commerce` domain (FR-072 404 otherwise).
// @spec ADR-065; SEC-001
// @tested tests/integration/fr159-payment.test.js

const zDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
export const zRevenueQuery = z.object({
  businessId: z.string().trim().min(1).max(200),
  from: zDay.optional(),
  to: zDay.optional(),
}).strict()

export async function getRevenueSummary(query, { viewer, db = prisma } = {}) {
  const q = zRevenueQuery.parse(query)
  const business = await loadBusiness(db, viewer, q.businessId)
  const orders = await db.salesOrder.findMany({
    where: { businessId: business.id },
    select: { id: true, origin: true, status: true, payments: { select: { kind: true, status: true, amountSatang: true, paidAt: true, createdAt: true } } },
  })
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
