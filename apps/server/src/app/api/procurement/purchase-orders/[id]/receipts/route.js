import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listGoodsReceipts, postGoodsReceipt } from '@/modules/procurement/application/goods-receipt-service'

// @req FR-165 — the goods receipts of one purchase order. GET lists them with
//   their lines; POST posts one against a SENT order under Business OWNER or
//   GOODS_RECEIVER authority (FR-196/ADR-079 split PROCUREMENT_BUYER's receipt
//   half into its own, conflicting role) — every line names an order line and may not
//   exceed what is outstanding, a line naming a counted SKU writes RECEIPT
//   rows into the Inventory ledger in the same transaction (which needs
//   Inventory's write authority on top), and a receipt that completes every
//   line makes the order RECEIVED. Answers `{ receipt, order, posted }` with
//   the order's money and receipt state recomputed. No PATCH, no DELETE: a
//   receipt is never edited. Refusals of scope are the FR-072 404.
// @spec ADR-066; BR-002; SEC-001; BR-012; FR-155
// @tested tests/unit/procurement-routes.test.js, tests/integration/fr165-goods-receipt.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return listGoodsReceipts(params?.id, { viewer })
  })
}

export async function POST(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return postGoodsReceipt(params?.id, body, { viewer })
  })
}
