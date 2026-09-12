import { handle } from '../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createEmployment } from '@/modules/people/application/employment-service'

// @req FR-193 — the write path `employment-service.js` was built for and never
// given. ADR-078 D1 moved the People Directory off `Membership` and onto
// `Employment`, and the service shipped all four lifecycle operations — but no
// route called any of them and the page had no control that wrote. So on a
// production installation the directory read zero rows and said "Add an
// Employment record when workforce data is ready", with no way to add one:
// the roster could only ever be empty, and the migration's backfill was the
// single opportunity to populate it (production had no `employeeRef` values,
// so it populated nothing).
//
// Authority is the service's own `ownsBusiness`, not this file's. The route
// stays thin (CLAUDE.md): resolve the viewer, hand over the body, let the
// service refuse.
// @spec ADR-078 D1, BR-034, SDD-093, ADR-017, SEC-008
// @tested tests/integration/fr193-employment-write-path.test.js

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    // Viewer first, body second — an unauthenticated caller learns nothing
    // about the shape this endpoint accepts (the convention `scope/route.js`
    // established).
    const viewer = await resolveRequestViewer(request)
    const body = await request.json()
    return createEmployment(body, { viewer })
  })
}
