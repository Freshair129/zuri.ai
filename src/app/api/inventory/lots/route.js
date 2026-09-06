import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createLot, listLots } from '@/modules/inventory/application/inventory-stock-service'

// @req FR-155 — lots (lot_id) of one Business: a manufacturing batch of one
//   LOT- or SERIAL-tracked SKU, optionally from a factory, with expiry. GET
//   lists them, optionally by `productId` (Business visibility plus the
//   `inventory` domain); POST creates one under manager authority — a receipt
//   may also create a lot by `lotCode`, so this is the explicit path for a
//   lot that carries dates before any stock arrives. Refusals are the FR-072 404.
// @spec BR-002; SEC-001; BR-012
// @tested tests/unit/inventory-routes.test.js, tests/integration/fr155-inventory-stock.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return listLots({ businessId: query?.businessId, productId: query?.productId || undefined, viewer })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return createLot(body, { viewer })
  })
}
