import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { revokeWorkspaceInvite } from '@/modules/identity/workspace-membership-service'

// @req FR-067 — revocation: the same owner authority that minted the invite
// retires it, and the revoked token fails the next acceptance closed with the
// generic refusal (AC-067.2). Audited (AC-067.8).
// @spec BR-016, SEC-014, SDD-038
// @tested tests/unit/workspace-onboarding-routes.test.js

export const dynamic = 'force-dynamic'

export async function DELETE(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return revokeWorkspaceInvite({ viewer, inviteId: params?.id })
  })
}
