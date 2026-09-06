import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listMovements, recordMovement } from '@/modules/inventory/application/inventory-stock-service'

// @req FR-155 — the stock ledger of one Business. GET lists the most recent
//   movements, optionally by `productId` (Business visibility plus the
//   `inventory` domain); POST appends one — RECEIPT, ISSUE or ADJUSTMENT —
//   under manager authority, refusing by code an UNTRACKED product, a
//   tracking-mode mismatch, an unknown or already-issued serial, and an ISSUE
//   that would take on-hand below zero. Nothing here is ever edited or
//   deleted. Refusals of scope are the FR-072 404.
// @spec BR-002; SEC-001; BR-012
// @tested tests/unit/inventory-routes.test.js, tests/integration/fr155-inventory-stock.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return listMovements({ businessId: query?.businessId, productId: query?.productId || undefined, limit: query?.limit, viewer })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return recordMovement(body, { viewer })
  })
}
