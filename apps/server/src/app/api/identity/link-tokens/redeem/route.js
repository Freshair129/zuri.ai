// @req FR-022, FR-097 — public redemption refuses unverified LINE subjects
// @spec SEC-018, ADR-045 D1/D5, SDD-052, BR-020
// @tested tests/integration/fr097-line-channel-onboarding.test.js
import { handle, httpError } from '../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function POST(request, options = {}) {
  return handle(async () => {
    // The viewer is resolved so that this mutating route follows the shared
    // route-viewer rule, but no session can make a client-supplied lineUserId
    // trustworthy: a browser session proves the Person, never the LINE subject.
    // Redemption must come from a signature-verified LINE webhook or a verified
    // LIFF ID token (redeemLinkToken, server-internal), so every request here
    // fails closed with or without a session.
    await (options.resolveViewer ?? resolveRequestViewer)(request).catch(() => null)
    throw httpError(403, 'LINK_REDEMPTION_REQUIRES_VERIFIED_LINE_SUBJECT')
  })
}
