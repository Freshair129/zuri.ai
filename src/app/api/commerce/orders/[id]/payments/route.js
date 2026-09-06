import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listPayments, recordPayment } from '@/modules/commerce/application/payment-service'

// @req FR-163 — the payments of one order. GET lists them with the verified
//   and pending sums; POST records a payment or a refund as PENDING under
//   Business OWNER or SALES_REP authority — the bank reference must be free
//   in the Tenant, the slip must be a FileAsset of the same Business, and a
//   payment (not a refund) is refused on a cancelled order. Verifying is the
//   item route's job. Refusals of scope are the FR-072 404.
// @spec ADR-065; BR-002; SEC-001; BR-012
// @tested tests/unit/commerce-routes.test.js, tests/integration/fr163-payment.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return listPayments(params?.id, { viewer })
  })
}

export async function POST(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return recordPayment(params?.id, body, { viewer })
  })
}
