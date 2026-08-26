import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { mintPasswordReset } from '@/modules/identity/auth-service'

// @req FR-104 — an owner (over a Business the target belongs to) or the
//   installation operator mints a single-use reset token for one Person. The raw
//   token appears exactly once, in this authenticated response, for out-of-band
//   handover — no public route ever returns one.
// @spec SDD-054, SEC-008, SEC-014
// @tested tests/unit/password-reset-routes.test.js

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return mintPasswordReset({ targetPersonId: body?.personId, viewer })
  })
}
