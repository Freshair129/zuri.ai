import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { handleCredentialRequest } from '@/modules/integration/application/credential-route'
import {
  provisionModelProviderCredential,
  readModelProviderStatus,
} from '@/modules/integration/application/model-provider-credential-service'

// @req FR-266 — enter or replace the Business's model provider API key, write-only:
//   AAL2 step-up and rate limit, live validation against the provider, then a new
//   credential version through the SecretStorePort. GET returns the non-secret
//   status the Studio's readiness journey reads.
// @spec ADR-100 D4; ADR-089 D2, D4, D5; SEC-030; SDD-101
// @tested tests/integration/fr266-model-provider-credential.test.js
export const dynamic = 'force-dynamic'

export async function GET(request) {
  // A read, so it does not take the write gate — requiring a step-up to *look at*
  // whether a key exists would make the readiness journey unreadable without one.
  // It is still `no-store`: the status says which provider a Business pays for.
  const response = await handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const businessId = new URL(request.url).searchParams.get('businessId')
    return readModelProviderStatus(businessId, { viewer })
  })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function POST(request) {
  return handleCredentialRequest(request, (body, { viewer, ports }) => provisionModelProviderCredential(body, { viewer, ports }), { resolveViewer: resolveRequestViewer })
}
