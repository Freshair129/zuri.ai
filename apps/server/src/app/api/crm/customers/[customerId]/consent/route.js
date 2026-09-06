import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { recordCustomerConsent } from '@/modules/crm/customer-consent-service'

// @req FR-103 — SEC-005: record a Business owner's PDPA consent attestation for
//   one Customer.
// @spec SDD-053, BR-001, SEC-005
// @tested tests/unit/crm-customer-consent-route.test.js
//
// POST only, by design: this writes one narrow field set on Customer and nothing
// else on the conversation it appears next to in the console — the reply owner is
// still the edge runtime alone (BR-011), and this route cannot touch a Message.

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => recordCustomerConsent(params.customerId, await request.json(), {
    viewer: await resolveRequestViewer(request),
  }))
}
