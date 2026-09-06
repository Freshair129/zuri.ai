import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { applyPurchaseOrderAction, getPurchaseOrder } from '@/modules/procurement/application/purchase-order-service'

// @req FR-160 — one purchase order. GET reads it with its lines (each with
//   what was received and what is outstanding), its receipts and the money
//   computed on this read; PATCH applies one versioned action — UPDATE (lines
//   and supplier only while DRAFT), SEND, CLOSE (a short-close with a reason)
//   or CANCEL (refused once anything was received) — under Business OWNER or
//   PROCUREMENT_BUYER authority with the caller's `version` as the
//   compare-and-swap. No DELETE: a cancelled order keeps its row. An unknown
//   id and an order in a Business the viewer may not see answer identically
//   (FR-072).
// @spec ADR-066; BR-001; SEC-001; BR-012
// @tested tests/unit/procurement-routes.test.js, tests/integration/fr160-procurement.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return getPurchaseOrder(params?.id, { viewer })
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return applyPurchaseOrderAction(params?.id, body, { viewer })
  })
}
