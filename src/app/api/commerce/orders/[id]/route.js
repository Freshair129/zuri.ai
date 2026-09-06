import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { applyOrderAction, getOrder } from '@/modules/commerce/application/sales-order-service'

// @req FR-162 — one sales order. GET reads it with its lines, its payments and
//   the money computed on this read; PATCH applies one versioned action —
//   UPDATE (lines only while DRAFT), CONFIRM, COMPLETE (optionally issuing
//   stock through the Inventory ledger) or CANCEL — under Business OWNER or
//   SALES_REP authority with the caller's `version` as the compare-and-swap.
//   No DELETE: a cancelled order keeps its row and its payments. An unknown
//   id and an order in a Business the viewer may not see answer identically
//   (FR-072).
// @spec ADR-065; BR-001; SEC-001; BR-012
// @tested tests/unit/commerce-routes.test.js, tests/integration/fr162-sales-order.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return getOrder(params?.id, { viewer })
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return applyOrderAction(params?.id, body, { viewer })
  })
}
