import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { previewBillingDocument } from '@/modules/commerce/application/billing-invoice-service'

// @req FR-186 — POST performs a scoped, non-persistent invoice/receipt/tax
// document preview. It has no number, issued timestamp or audit event.
// @spec ADR-065; BR-001; BR-002; SEC-001
// @tested tests/e2e/fr186-billing-pos.spec.js, tests/integration/fr186-billing.test.js

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return previewBillingDocument(body, { viewer })
  })
}
