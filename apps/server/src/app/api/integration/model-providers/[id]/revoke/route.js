import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { handleCredentialRequest } from '@/modules/integration/application/credential-route'
import { revokeModelProviderCredential } from '@/modules/integration/application/model-provider-credential-service'

// @req FR-266 — revoke the Business's model provider key: AAL2 step-up and rate
//   limit, a typed REVOKE confirmation, then every version's material purged. The
//   next answer fails closed rather than falling back to another key (SDD-106).
// @spec ADR-100 D4, D5; ADR-089 D4, D5; SEC-030
// @tested tests/integration/fr266-model-provider-credential.test.js
export const dynamic = 'force-dynamic'

export async function POST(request, { params } = {}) {
  const { id } = await params
  return handleCredentialRequest(request, (body, { viewer, ports }) => revokeModelProviderCredential(id, body, { viewer, ports }), { resolveViewer: resolveRequestViewer })
}
