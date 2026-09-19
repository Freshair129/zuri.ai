import { handle } from '@/app/api/_helpers'
// @req FR-046 — platform permission identity comes from the trusted request session.
// @spec ADR-017, SDD-024, SEC-008
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { offboardPerson } from '@/modules/identity/membership-lifecycle-service'

// @req FR-191 — withdraw every grant one person holds in a Tenant, in one
//   transaction, as one act with one author and one reason. This is the leaver
//   half of joiner–mover–leaver, and it did not exist: the only route out of a
//   grant was a hard delete on a project team screen, which destroyed the
//   evidence that the grant had been held at all.
//
//   Tenant-scoped authority (`ownsTenant`), because offboarding crosses every
//   Business beneath the Tenant. A Business owner revokes the grants they own
//   one at a time through the lifecycle route beside this one.
// @spec ADR-077 D2, SEC-003, SEC-026
// @tested tests/integration/fr191-access-grant-lifecycle.test.js

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const body = await request.json().catch(() => ({}))
    return offboardPerson(body, { resolve: () => resolveRequestViewer(request) })
  })
}
