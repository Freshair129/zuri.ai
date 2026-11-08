// @req FR-022, FR-097 — query only self, scoped owners, tenant-wide owners or operators
// @spec SEC-018, ADR-045 D1/D5, SDD-052, BR-020
// @tested tests/integration/fr097-line-channel-onboarding.test.js
import { handle, httpError, queryParams } from '../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { canReadChannelIdentity } from '@/modules/identity/link-token-authority'
import { findChannelIdentity, channelIdentityIsVerified } from '@/modules/identity/channel-identity'

export const dynamic = 'force-dynamic'

function notFoundChannelIdentity() {
  return {
    found: false,
    status: null,
    verified: false,
    verifiedAt: null,
    linkedAt: null,
  }
}

export async function GET(request, options = {}) {
  return handle(async () => {
    const viewer = options.viewer ?? await (options.resolveViewer ?? resolveRequestViewer)(request)
    const viewerPersonId = viewer?.personId ?? viewer?.principal?.id
    if (!viewerPersonId) throw httpError(401, 'AUTHENTICATION_REQUIRED')

    const params = queryParams(request)
    const { tenantId, channelAccountId, providerSubject, channel = 'LINE' } = params

    if (!tenantId || !providerSubject) {
      throw httpError(400, 'tenantId and providerSubject are required query parameters')
    }

    const row = await findChannelIdentity({
      tenantId,
      channel,
      channelAccountId,
      providerSubject,
    })

    if (!row) return notFoundChannelIdentity()
    if (!(await canReadChannelIdentity({ viewer, tenantId, rowPersonId: row.personId }))) {
      return notFoundChannelIdentity()
    }

    return {
      found: true,
      id: row.id,
      personId: row.personId,
      status: row.status,
      verified: channelIdentityIsVerified(row),
      verifiedAt: row.verifiedAt,
      linkedAt: row.linkedAt,
      revokedAt: row.revokedAt,
    }
  })
}
