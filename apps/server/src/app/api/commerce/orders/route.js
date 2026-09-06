import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createOrder, listOrders } from '@/modules/commerce/application/sales-order-service'

// @req FR-162 — sales orders of one Business. GET lists open ones (closed on
//   request) with totals, paid, balance and payment state computed from the
//   lines and verified payments; filters `status`, `origin`, `customerId`,
//   `conversationId`. POST creates one under Business OWNER or SALES_REP
//   authority. Both need the `commerce` domain (FR-061) and answer the FR-072
//   404 without it. `businessId` is a selector the service validates against
//   the trusted viewer, never the scope.
// @spec ADR-065; BR-001; SEC-001; BR-012
// @tested tests/unit/commerce-routes.test.js, tests/integration/fr162-sales-order.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const q = queryParams(request)
    return listOrders({
      businessId: q?.businessId,
      ...(q?.status ? { status: q.status } : {}),
      ...(q?.origin ? { origin: q.origin } : {}),
      ...(q?.customerId ? { customerId: q.customerId } : {}),
      ...(q?.conversationId ? { conversationId: q.conversationId } : {}),
      ...(q?.includeClosed === 'true' ? { includeClosed: true } : {}),
      ...(q?.limit ? { limit: Number(q.limit) } : {}),
    }, { viewer })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return createOrder(body, { viewer })
  })
}
