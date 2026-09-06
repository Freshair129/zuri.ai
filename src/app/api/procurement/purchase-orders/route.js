import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createPurchaseOrder, listPurchaseOrders } from '@/modules/procurement/application/purchase-order-service'

// @req FR-164 — purchase orders of one Business. GET lists open ones (closed
//   on request) with total, received and outstanding value and the
//   `receiptState` computed from the lines and their receipt lines; filters
//   `status`, `supplierId`. POST creates one against an ACTIVE supplier under
//   Business OWNER or PROCUREMENT_BUYER authority. Both need the
//   `procurement` domain (FR-061) and answer the FR-072 404 without it.
//   `businessId` is a selector the service validates against the trusted
//   viewer, never the scope.
// @spec ADR-066; BR-001; SEC-001; BR-012
// @tested tests/unit/procurement-routes.test.js, tests/integration/fr164-procurement.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const q = queryParams(request)
    return listPurchaseOrders({
      businessId: q?.businessId,
      ...(q?.status ? { status: q.status } : {}),
      ...(q?.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q?.includeClosed === 'true' ? { includeClosed: true } : {}),
      ...(q?.limit ? { limit: Number(q.limit) } : {}),
    }, { viewer })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return createPurchaseOrder(body, { viewer })
  })
}
