import { z } from 'zod'
import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  listWorkspaceCollaboration,
  removeWorkspaceMembership,
} from '@/modules/identity/workspace-membership-service'

// @req FR-067 — membership removal: owner authority over the Workspace, status
// flips to REMOVED, and the next protected read re-derives from the row —
// nothing relies on stale client state (AC-067.7). Audited (AC-067.8).
// The GET beside it is that same re-derivation: the owner's roster of ACTIVE
// members and still-PENDING invites, which is what makes revoke and remove
// reachable at all. Members and invites answer one request, not two, so the two
// halves of one panel can never disagree after a mutation. No token material.
// @spec BR-016, SEC-014, SDD-038
// @tested tests/unit/workspace-onboarding-routes.test.js
// @tested tests/integration/workspace-collaboration-roster.test.js

export const dynamic = 'force-dynamic'

const zRosterQuery = z.object({
  portfolioId: z.string().min(1),
}).strict()

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = zRosterQuery.parse(queryParams(request))
    return listWorkspaceCollaboration({ viewer, portfolioId: query.portfolioId })
  })
}

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
