import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { revokeCustomerRetentionConsent } from '@/modules/crm/customer-retention-consent-service'

// @req FR-022 — revoke a Customer's retention consent (ADR-093 1.2.0). In the
//   same transaction every legal-hold re-seal key held for that Customer is
//   destroyed. POST only, audited, same authority as recording.
// @spec ADR-093 1.2.0; BR-001
// @tested tests/unit/crm-retention-consent-routes.test.js

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => revokeCustomerRetentionConsent(params.customerId, await request.json(), {
    viewer: await resolveRequestViewer(request),
  }))
}
