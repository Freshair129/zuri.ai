// @req FR-097 — query channel identity verification status
// @spec ADR-045 D1, D5, SDD-052, BR-020, SEC-018
// @tested tests/integration/fr097-line-channel-onboarding.test.js
import { handle, httpError, queryParams } from '../../_helpers'
import { findChannelIdentity, channelIdentityIsVerified } from '@/modules/identity/channel-identity'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
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

    if (!row) {
      return {
        found: false,
        status: null,
        verified: false,
        verifiedAt: null,
        linkedAt: null,
      }
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
