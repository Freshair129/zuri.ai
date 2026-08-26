import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { getOnboardingState } from '@/modules/identity/onboarding-service'

// @req FR-066 — the pre-Business onboarding state: Profile completion, the
// person's own pending invitations and joined Workspaces, and the routing
// answer (Profile setup → Waiting Room / Workspace Home / Business Routing).
// Exposes no scope inventory (AC-066.3, AC-066.4).
// @spec BR-016, SEC-014, SDD-038
// @tested tests/unit/workspace-onboarding-routes.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return getOnboardingState({ personId: viewer.principal.id })
  })
}
