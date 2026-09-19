import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { handleCredentialRequest } from '@/modules/integration/application/credential-route'
import { revokeLineChannelCredential } from '@/modules/integration/application/line-channel-credential-service'

// @req FR-223, FR-224 — revoke a LINE connection's credential: AAL2 step-up and
//   rate limit, a typed REVOKE confirmation, the account fenced first (server
//   ownership off, epoch +1), then every version's material purged.
// @spec ADR-089 D4, D5; ADR-061 D7; SEC-030
// @tested tests/integration/line-channel-credential-routes.test.js
export const dynamic = 'force-dynamic'

export async function POST(request, { params } = {}) {
  const { id } = await params
  return handleCredentialRequest(request, (body, { viewer, ports }) => revokeLineChannelCredential(id, body, { viewer, ports }), { resolveViewer: resolveRequestViewer })
}
