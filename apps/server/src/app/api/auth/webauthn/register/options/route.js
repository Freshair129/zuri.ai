// @req FR-094, FR-095 — WebAuthn Passkey registration options endpoint
// @spec ADR-045 D2, D5, SDD-052, SEC-018
// @tested tests/integration/passkey-lifecycle.test.js

import { handle, httpError } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { startPasskeyRegistration } from '@/modules/identity/passkey-service'

export const dynamic = 'force-dynamic'

export async function POST(request, options = {}) {
  return handle(async () => {
    const viewer = options.viewer ?? await (options.resolveViewer ?? resolveRequestViewer)(request)
    const personId = viewer?.personId ?? viewer?.principal?.id
    if (!personId) throw httpError(401, 'AUTHENTICATION_REQUIRED')

    const host = request.headers.get('host') || 'localhost'
    const rpId = host.split(':')[0]

    const regOptions = await startPasskeyRegistration({ viewer: { ...viewer, personId }, rpId })
    return { success: true, options: regOptions }
  })
}
