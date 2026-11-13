// @req FR-195
// @spec BR-016, SEC-014, SDD-094, ADR-079
// @tested tests/unit/access-invite-routes.test.js, tests/integration/fr195-access-invite-http.test.js
import { z } from 'zod'
import { handle, httpError } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createSessionPort } from '@/modules/identity/session-port'
import { assertApiWriteCsrfToken } from '@/modules/identity/api-write-csrf'
import { declineAccessInvite } from '@/modules/identity/access-invite-service'

export const dynamic = 'force-dynamic'

const declineAccessInviteBody = z.object({ token: z.string().min(1) }).strict()

export async function POST(request) {
  return handle(async () => {
    const sessionPort = createSessionPort()
    let session
    try {
      session = await sessionPort.read(request)
    } catch {
      throw httpError(503, 'SESSION_UNAVAILABLE')
    }
    const viewer = await resolveRequestViewer(request, { sessionPort: { read: async () => session } })
    assertApiWriteCsrfToken({
      request,
      token: request.headers.get('x-csrf-token'),
      session,
    })

    let rawBody
    try {
      rawBody = await request.json()
    } catch {
      throw httpError(400, 'ACCESS_INVITE_BODY_INVALID')
    }
    const { token } = declineAccessInviteBody.parse(rawBody)
    return declineAccessInvite({ token, personId: viewer.principal.id })
  })
}
