import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { getBillingDocument } from '@/modules/commerce/application/billing-invoice-service'

// @req FR-186 — reads one immutable durable issuance in the Business scope;
// the snapshot is the local record and carries no statutory e-tax claim.
// @spec ADR-065; BR-001; SEC-001
// @tested tests/e2e/fr186-billing-pos.spec.js, tests/integration/fr186-billing.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return getBillingDocument(params?.id, { viewer })
  })
}
