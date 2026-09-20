import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { handleCredentialRequest } from '@/modules/integration/application/credential-route'
import { validateModelProviderCredential } from '@/modules/integration/application/model-provider-credential-service'

// @req FR-266 — re-prove the stored model provider key against its provider and
//   record the outcome, so the readiness journey reports a key that has stopped
//   working instead of an older success.
// @spec ADR-100 D4; ADR-089 D4; SEC-030
// @tested tests/integration/fr266-model-provider-credential.test.js
export const dynamic = 'force-dynamic'

export async function POST(request, { params } = {}) {
  const { id } = await params
  return handleCredentialRequest(request, (body, { viewer, ports }) => validateModelProviderCredential(id, body, { viewer, ports }), { resolveViewer: resolveRequestViewer })
}
