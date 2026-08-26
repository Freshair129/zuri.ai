import { z } from 'zod'
import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { acceptWorkspaceInvite } from '@/modules/identity/workspace-membership-service'

// @req FR-067 — one-use acceptance: the trusted session principal plus the
// handed-over token become an ACTIVE WorkspaceMembership. This is NOT an
// auth-lifecycle endpoint — a viewer is resolved and the mutation fails closed
// without a trusted session (SEC-014); replayed, revoked and expired tokens all
// answer with one generic refusal.
// @spec BR-016, SEC-014, SDD-038
// @tested tests/unit/workspace-onboarding-routes.test.js

export const dynamic = 'force-dynamic'

const zAcceptBody = z.object({
  token: z.string().min(1),
}).strict()

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = zAcceptBody.parse(await request.json().catch(() => ({})))
    return acceptWorkspaceInvite({ token: body.token, personId: viewer.principal.id })
  })
}
