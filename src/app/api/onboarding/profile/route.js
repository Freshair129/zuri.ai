import { z } from 'zod'
import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { completeProfile } from '@/modules/identity/onboarding-service'

// @req FR-066 — Profile completion over the session's own Person: the identity
// step every new person finishes before being asked for an operating scope.
// The target Person is always the trusted session principal — a body-supplied
// principal claim is rejected by the strict schema (SEC-014).
// @spec BR-016, SEC-014, SDD-038
// @tested tests/unit/workspace-onboarding-routes.test.js

export const dynamic = 'force-dynamic'

const zProfileBody = z.object({
  displayName: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320).optional(),
}).strict()

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = zProfileBody.parse(await request.json().catch(() => ({})))
    return completeProfile({
      personId: viewer.principal.id,
      displayName: body.displayName,
      email: body.email,
    })
  })
}
