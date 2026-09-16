import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { handleCredentialRequest } from '@/modules/integration/application/credential-route'
import { provisionLineServerConnection } from '@/modules/integration/application/line-server-provisioning-service'
import { connectLineChannelWithSecret } from '@/modules/integration/application/line-channel-connection-service'

// @req FR-149 — owner-only LINE connection provisioning from a deployment-secret
//   reference (the operator's mount path, unchanged).
// @req FR-226, FR-223, FR-224 — or, when the body carries a Channel ID and secret,
//   a write-only connection: AAL2 step-up and rate limit, live validation with LINE,
//   the installation-wide claim, and storage through the credential vault. The
//   response carries connection, masked credential and bot metadata only.
// @req FR-225 — this is the exact call the Thai self-serve wizard makes; the
//   Studio's connect wizard (`LineOaConnectWizard.jsx`) posts here and then, on
//   success, calls `POST /api/line-oa/accounts` to create the DRAFT account —
//   this route stays unaware of that second call (ADR-089 D7).
// @spec ADR-061, ADR-089 D2, D4, D6, D7, SEC-001, SEC-016, SEC-030
// @tested tests/integration/fr149-line-server-configuration.test.js, tests/integration/line-channel-credential-routes.test.js, tests/integration/fr225-line-oa-self-serve-onboarding.test.js
export const dynamic = 'force-dynamic'

const carriesSecret = body => body && typeof body === 'object' && ('channelSecret' in body || 'channelId' in body || 'channelAccessToken' in body)

export async function POST(request) {
  return handleCredentialRequest(request, async (body, { viewer, ports }) => (
    carriesSecret(body)
      ? connectLineChannelWithSecret(body, { viewer, ports })
      : provisionLineServerConnection(body, { viewer })
  ), { resolveViewer: resolveRequestViewer })
}
