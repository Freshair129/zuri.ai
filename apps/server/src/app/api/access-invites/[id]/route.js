// @req FR-195
// @spec BR-016, SEC-014, SDD-094, ADR-079
// @tested tests/unit/access-invite-routes.test.js, tests/integration/fr195-access-invite-http.test.js
import { handle, httpError } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createSessionPort } from '@/modules/identity/session-port'
import { assertApiWriteCsrfToken } from '@/modules/identity/api-write-csrf'
import { revokeAccessInvite } from '@/modules/identity/access-invite-service'

export const dynamic = 'force-dynamic'

export async function DELETE(request, { params }) {
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
    const { id } = (await params) ?? {}
    return revokeAccessInvite({ viewer, inviteId: id })
  })
}
