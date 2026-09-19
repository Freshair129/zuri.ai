// @req FR-094, FR-095 — WebAuthn Passkey credential management endpoint
// @spec ADR-045 D2, D5, SDD-052, SEC-018
// @tested tests/integration/passkey-lifecycle.test.js

import { handle, httpError } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listPasskeys, revokePasskey } from '@/modules/identity/passkey-service'

export const dynamic = 'force-dynamic'

export async function GET(request, options = {}) {
  return handle(async () => {
    const viewer = options.viewer ?? await (options.resolveViewer ?? resolveRequestViewer)(request)
    const personId = viewer?.personId ?? viewer?.principal?.id
    if (!personId) throw httpError(401, 'AUTHENTICATION_REQUIRED')

    const passkeys = await listPasskeys({ personId })
    return { success: true, passkeys }
  })
}

export async function DELETE(request, options = {}) {
  return handle(async () => {
    const viewer = options.viewer ?? await (options.resolveViewer ?? resolveRequestViewer)(request)
    const personId = viewer?.personId ?? viewer?.principal?.id
    if (!personId) throw httpError(401, 'AUTHENTICATION_REQUIRED')

    const { searchParams } = new URL(request.url)
    let passkeyId = searchParams.get('id')

    if (!passkeyId) {
      const body = await request.json().catch(() => ({}))
      passkeyId = body?.passkeyId || body?.id
    }

    if (!passkeyId) {
      throw httpError(400, 'passkeyId is required')
    }

    const result = await revokePasskey({ personId, passkeyId })
    return { success: true, ...result }
  })
}
