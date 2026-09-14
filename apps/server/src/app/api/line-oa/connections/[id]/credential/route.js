import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { handleCredentialRequest } from '@/modules/integration/application/credential-route'
import { rotateLineChannelCredential } from '@/modules/integration/application/line-channel-credential-service'

// @req FR-223, FR-224 — rotate a LINE connection's credential write-only: AAL2
//   step-up and rate limit, live validation with LINE against this connection's
//   bot, a new version that replaces the old only after it validates. No epoch bump.
// @spec ADR-089 D2, D4, D5; SEC-030
// @tested tests/integration/line-channel-credential-routes.test.js
export const dynamic = 'force-dynamic'

export async function POST(request, { params } = {}) {
  const { id } = await params
  return handleCredentialRequest(request, (body, { viewer, ports }) => rotateLineChannelCredential(id, body, { viewer, ports }), { resolveViewer: resolveRequestViewer })
}
