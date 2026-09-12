// @req FR-094, FR-095 — TOTP MFA enrollment initiation
// @spec ADR-045 D2, D5, SDD-052, SEC-018
// @tested tests/integration/mfa-totp-lifecycle.test.js

import { handle, httpError } from '../../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { startTotpEnrollment } from '@/modules/identity/mfa-service'

export const dynamic = 'force-dynamic'

export async function POST(request, options = {}) {
  return handle(async () => {
    const viewer = options.viewer ?? await (options.resolveViewer ?? resolveRequestViewer)(request)
    const personId = viewer?.personId ?? viewer?.principal?.id
    if (!personId) throw httpError(401, 'AUTHENTICATION_REQUIRED')

    const body = await request.json().catch(() => ({}))
    return await startTotpEnrollment({
      personId,
      label: body.label,
      issuer: body.issuer,
    })
  })
}
