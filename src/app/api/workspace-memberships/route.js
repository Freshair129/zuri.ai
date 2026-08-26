import { z } from 'zod'
import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { removeWorkspaceMembership } from '@/modules/identity/workspace-membership-service'

// @req FR-067 — membership removal: owner authority over the Workspace, status
// flips to REMOVED, and the next protected read re-derives from the row —
// nothing relies on stale client state (AC-067.7). Audited (AC-067.8).
// @spec BR-016, SEC-014, SDD-038
// @tested tests/unit/workspace-onboarding-routes.test.js

export const dynamic = 'force-dynamic'

const zRemoveQuery = z.object({
  portfolioId: z.string().min(1),
  personId: z.string().min(1),
}).strict()

export async function DELETE(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = zRemoveQuery.parse(queryParams(request))
    return removeWorkspaceMembership({
      viewer,
      portfolioId: query.portfolioId,
      personId: query.personId,
    })
  })
}
