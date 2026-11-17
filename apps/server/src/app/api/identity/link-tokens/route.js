// @req FR-022, FR-097 — self-only verified channel onboarding link token issuance
// @spec SEC-018, ADR-045 D1/D5, SDD-052, BR-020
// @tested tests/integration/fr097-line-channel-onboarding.test.js
import { handle, httpError } from '../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { canIssueLinkToken } from '@/modules/identity/link-token-authority'
import { issueLinkToken } from '@/modules/identity/link-line-identity'

export const dynamic = 'force-dynamic'

export async function POST(request, options = {}) {
  return handle(async () => {
    const viewer = options.viewer ?? await (options.resolveViewer ?? resolveRequestViewer)(request)
    const viewerPersonId = viewer?.personId ?? viewer?.principal?.id
    const body = await request.json().catch(() => ({}))
    const tenantId = body.tenantId ?? viewer?.tenantId ?? viewer?.ownedTenantIds?.[0]
    if (!viewerPersonId) {
      throw httpError(401, 'AUTHENTICATION_REQUIRED')
    }

    if (body.personId !== undefined && body.personId !== viewerPersonId) {
      throw httpError(403, 'LINK_TOKEN_FORBIDDEN')
    }
    if (!tenantId) throw httpError(400, 'tenantId is required')
    if (!(await canIssueLinkToken({ viewer, tenantId }))) {
      throw httpError(403, 'LINK_TOKEN_FORBIDDEN')
    }

    const ttlSeconds = body.ttlSeconds === undefined ? 900 : body.ttlSeconds

    const result = await issueLinkToken({
      tenantId,
      personId: viewerPersonId,
      ttlSeconds,
    })

    return {
      token: result.token,
      tokenId: result.tokenId,
      expiresAt: result.expiresAt,
    }
  })
}
