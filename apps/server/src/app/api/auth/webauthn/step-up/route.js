// @req FR-094, FR-095, FR-096 — WebAuthn Passkey step-up elevation endpoint
// @spec ADR-045 D2, D4, D5, SDD-052, SEC-018
// @tested tests/integration/passkey-lifecycle.test.js

import { handle, httpError } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { stepUpWithPasskey } from '@/modules/identity/passkey-service'
import { resolveSessionTokenHash } from '@/modules/identity/credential-write-gate'

export const dynamic = 'force-dynamic'

export async function POST(request, options = {}) {
  return handle(async () => {
    const viewer = options.viewer ?? await (options.resolveViewer ?? resolveRequestViewer)(request)
    const personId = viewer?.personId ?? viewer?.principal?.id
    const sessionTokenHash = resolveSessionTokenHash({ request, tokenHash: options.tokenHash, viewer })
    if (!personId || !sessionTokenHash) throw httpError(401, 'AUTHENTICATION_REQUIRED')

    const body = await request.json().catch(() => ({}))
    const { credential } = body

    const host = request.headers.get('host') || 'localhost'
    const rpId = host.split(':')[0]
    const origin = request.headers.get('origin') || `http://${host}`

    return await stepUpWithPasskey({
      viewer: { ...viewer, personId, sessionTokenHash },
      credential,
      rpId,
      origin,
    })
  })
}
