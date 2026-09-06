import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listSerialUnits } from '@/modules/inventory/application/inventory-stock-service'

// @req FR-155 — serial units (serial_id) of one Business: one row per
//   physical unit of a SERIAL-tracked SKU with its custody status. GET only:
//   a unit comes into existence through a RECEIPT movement and leaves through
//   an ISSUE (POST /api/inventory/stock-movements), never by a direct write,
//   so its history is always explained by ledger rows. Filters: `productId`,
//   `lotId`, `status`. Refusals are the FR-072 404.
// @spec BR-002 (a serial is an attribute, unique per product, never a key); SEC-001
// @tested tests/unit/inventory-routes.test.js, tests/integration/fr155-inventory-stock.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return listSerialUnits({ businessId: query?.businessId, productId: query?.productId || undefined, lotId: query?.lotId || undefined, status: query?.status || undefined, viewer })
  })
}
