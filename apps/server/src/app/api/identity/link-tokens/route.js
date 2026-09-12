// @req FR-022, FR-097 — verified channel onboarding link token issuance
// @spec ADR-045 D1, D5, SDD-052, BR-020, SEC-018
// @tested tests/integration/fr097-line-channel-onboarding.test.js
import { handle, httpError } from '../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { issueLinkToken } from '@/modules/identity/link-line-identity'

export const dynamic = 'force-dynamic'

export async function POST(request, options = {}) {
  return handle(async () => {
    const viewer = options.viewer ?? await (options.resolveViewer ?? resolveRequestViewer)(request)
    const viewerPersonId = viewer?.personId ?? viewer?.principal?.id
    const body = await request.json().catch(() => ({}))
    const tenantId = body.tenantId ?? viewer?.tenantId ?? viewer?.ownedTenantIds?.[0]
    if (!viewerPersonId || !tenantId) {
      throw httpError(401, 'AUTHENTICATION_REQUIRED')
    }

    const targetPersonId = body.personId || viewerPersonId
    const ttlSeconds = typeof body.ttlSeconds === 'number' ? body.ttlSeconds : 900

    const result = await issueLinkToken({
      tenantId,
      personId: targetPersonId,
      ttlSeconds,
    })

    return {
      token: result.token,
      tokenId: result.tokenId,
      expiresAt: result.expiresAt,
    }
  })
}
