// @req FR-094, FR-095 — WebAuthn Passkey login options endpoint
// @spec ADR-045 D2, D5, SDD-052, SEC-018
// @tested tests/integration/passkey-lifecycle.test.js

import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { startPasskeyLogin } from '@/modules/identity/passkey-service'

export const dynamic = 'force-dynamic'

export async function POST(request, options = {}) {
  return handle(async () => {
    // Authenticated or guest viewer at boundary
    await (options.resolveViewer ?? resolveRequestViewer)(request).catch(() => null)

    const body = await request.json().catch(() => ({}))
    const host = request.headers.get('host') || 'localhost'
    const rpId = host.split(':')[0]

    const loginOptions = await startPasskeyLogin({ email: body.email, rpId })
    return { success: true, options: loginOptions }
  })
}
