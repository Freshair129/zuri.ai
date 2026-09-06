import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { applyPaymentAction, getPayment } from '@/modules/commerce/application/payment-service'

// @req FR-159 — one payment. GET reads it; PATCH applies one versioned
//   action — VERIFY or REJECT (with a reason) — under Business OWNER or
//   PAYMENT_VERIFIER authority with the caller's `version` as the
//   compare-and-swap, and answers with the payment and the order's money
//   recomputed. Only a PENDING payment can be acted on; a refund may not be
//   verified beyond what was verifiably paid. No DELETE. Refusals of scope
//   are the FR-072 404.
// @spec ADR-065; SEC-001; BR-012
// @tested tests/unit/commerce-routes.test.js, tests/integration/fr159-payment.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return getPayment(params?.id, { viewer })
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return applyPaymentAction(params?.id, body, { viewer })
  })
}
