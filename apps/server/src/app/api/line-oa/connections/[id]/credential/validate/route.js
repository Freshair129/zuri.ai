import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { handleCredentialRequest } from '@/modules/integration/application/credential-route'
import { validateLineChannelCredential } from '@/modules/integration/application/line-channel-credential-service'

// @req FR-223, FR-224 — re-run the live check of a LINE connection's stored
//   credential: AAL2 step-up and rate limit (a rejected validation counts twice),
//   then LINE bot information for this connection's bot; the outcome is recorded.
// @spec ADR-089 D4, D7; SEC-030
// @tested tests/integration/line-channel-credential-routes.test.js
export const dynamic = 'force-dynamic'

export async function POST(request, { params } = {}) {
  const { id } = await params
  return handleCredentialRequest(request, (body, { viewer, ports }) => validateLineChannelCredential(id, body, { viewer, ports }), { resolveViewer: resolveRequestViewer })
}
