import { handle, queryParams } from '../_helpers'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { listPeople } from '@/modules/people/application/people-service'

// @req FR-042 - viewer-filtered Business People Directory.
// @spec ADR-013, BR-001 - HR / People is a peer domain, not Development.
// @tested tests/unit/people-route.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const { businessId } = queryParams(request)
    const viewer = await resolveViewer()
    return listPeople(businessId, { visibleBusinessIds: viewer.visibleBusinessIds })
  })
}
