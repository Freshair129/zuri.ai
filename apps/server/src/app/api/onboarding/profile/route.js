import { z } from 'zod'
import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { completeProfile } from '@/modules/identity/onboarding-service'

// @req FR-066 — Profile completion over the session's own Person: the identity
// step every new person finishes before being asked for an operating scope.
// The target Person is always the trusted session principal — a body-supplied
// principal claim is rejected by the strict schema (SEC-014).
// @req FR-122 — and what that Profile carries: given name, family name and
// telephone number, required here rather than on the column (see the service).
// @spec BR-016, SEC-014, SDD-038
// @tested tests/unit/workspace-onboarding-routes.test.js

export const dynamic = 'force-dynamic'

const zProfileBody = z.object({
  // @req FR-122 — display name becomes optional at the contract, and only here:
  // the service still never writes an empty one, it composes it from the two
  // names below when the caller omits it. Optional so nobody types their name
  // twice; never absent in storage, because every surface renders it.
  displayName: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email().max(320).optional(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(1).max(32),
}).strict()

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = zProfileBody.parse(await request.json().catch(() => ({})))
    return completeProfile({
      personId: viewer.principal.id,
      displayName: body.displayName,
      email: body.email,
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone,
    })
  })
}
