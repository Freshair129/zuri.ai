import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { eraseCustomerPrincipal } from '@/modules/identity/erase-customer-principal'

// @req FR-022 — the production path for PDPA erasure. The function existed and was
//   correct; nothing in the running product could call it, so an erasure request had
//   no answer short of a database console.
// @req FR-103 — the authority shape: per-Business OWNER over a Business in the
//   Customer's tenant, resolved the way the consent writer resolves it.
// @spec SEC-001, SEC-003, SEC-005, BR-001
// @tested tests/integration/crm-customer-erasure.test.js
//
// POST, and only POST. There is no GET preview of an erasure — the thing a reader
// would want previewed is precisely the personal data the request exists to remove —
// and no DELETE, because the row is not what goes away: `Customer` survives as a
// redacted tombstone so the Business can still account for a conversation it had.
//
// The response carries counts and nothing else. A caller who has just erased a person
// must not be handed their name back in the receipt.

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => eraseCustomerPrincipal(params.customerId, await request.json(), {
    viewer: await resolveRequestViewer(request),
  }))
}
