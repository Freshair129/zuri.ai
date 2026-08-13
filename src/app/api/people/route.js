import { handle, queryParams } from '../_helpers'
// @req FR-046 — protected API identity comes from the trusted request session.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-api-ui-contract.test.js
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listPeople } from '@/modules/people/application/people-service'

// @req FR-042 - viewer-filtered Business People Directory.
// @spec ADR-013, BR-001 - HR / People is a peer domain, not Development.
// @tested tests/unit/people-route.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const { businessId } = queryParams(request)
    const viewer = await resolveRequestViewer(request)
    return listPeople(businessId, { visibleBusinessIds: viewer.visibleBusinessIds })
  })
}
