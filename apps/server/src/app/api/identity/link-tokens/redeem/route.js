// @req FR-022, FR-097 — verified channel onboarding link token redemption
// @spec ADR-045 D1, D5, SDD-052, BR-020, SEC-018
// @tested tests/integration/fr097-line-channel-onboarding.test.js
import { handle, httpError } from '../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { redeemLinkToken } from '@/modules/identity/link-line-identity'

export const dynamic = 'force-dynamic'

export async function POST(request, options = {}) {
  return handle(async () => {
    // Single-use link token is the bearer credential (FR-097, SEC-018);
    // resolve viewer if a session is present (e.g. web console redemption).
    const viewer = options.viewer ?? await (options.resolveViewer ?? resolveRequestViewer)(request).catch(() => null)
    const body = await request.json()
    try {
      const result = await redeemLinkToken({
        ...body,
        ...(viewer?.personId ? { redeemedByPersonId: viewer.personId } : {}),
      })
      return {
        personId: result.personId,
        externalIdentityId: result.externalIdentityId,
        linked: result.linked,
        reactivated: result.reactivated,
        merged: result.merged,
        channelIdentity: result.channelIdentity,
      }
    } catch (err) {
      if (err.status) throw err
      throw httpError(400, err.message)
    }
  })
}
