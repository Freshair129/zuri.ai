import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { recordCustomerRetentionConsent } from '@/modules/crm/customer-retention-consent-service'

// @req FR-022 — a sales user (SALES_REP or the Business OWNER) records that a
//   Customer agreed in advance to have their chat evidence retained
//   (ADR-093 1.2.0). POST only: each recording is an audited history row.
// @spec ADR-093 1.2.0; BR-001
// @tested tests/unit/crm-retention-consent-routes.test.js

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => recordCustomerRetentionConsent(params.customerId, await request.json(), {
    viewer: await resolveRequestViewer(request),
  }))
}
