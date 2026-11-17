// @req FR-195
// @spec BR-016, SEC-014, SDD-094, ADR-079
// @tested tests/unit/access-invite-routes.test.js, tests/integration/fr195-access-invite-http.test.js
import { z } from 'zod'
import { handle, httpError, ok } from '@/app/api/_helpers'
import { ACCESS_INVITE_SCOPE_TYPES } from '@/lib/validation/enums'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createSessionPort } from '@/modules/identity/session-port'
import { assertApiWriteCsrfToken } from '@/modules/identity/api-write-csrf'
import { mintAccessInvite } from '@/modules/identity/access-invite-service'

export const dynamic = 'force-dynamic'

const zOptionalId = z.string().uuid().optional()
const mintAccessInviteBody = z.object({
  scopeType: z.enum(ACCESS_INVITE_SCOPE_TYPES),
  portfolioId: zOptionalId,
  tenantId: zOptionalId,
  businessId: zOptionalId,
  // OWNER must reach the service so every scope keeps its declared refusal.
  role: z.string().default('MEMBER'),
  targetPersonId: zOptionalId,
  invitedEmail: z.string().trim().email().optional(),
  invitedLineUserId: z.string().trim().min(1).optional(),
  reason: z.string().trim().max(500).optional(),
  domainKeys: z.array(z.string().trim()).optional(),
}).strict()

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
    const input = mintAccessInviteBody.parse(rawBody)
    const result = await mintAccessInvite({ viewer, ...input })
    return ok(result, { headers: { 'Cache-Control': 'no-store' } })
  })
}
