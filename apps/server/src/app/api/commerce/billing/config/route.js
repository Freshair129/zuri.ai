import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { getBillingProfile, updateBillingProfile } from '@/modules/commerce/application/billing-invoice-service'

// @req FR-186 — Business OWNER reads and updates the issuer, tax, PromptPay,
// non-VAT and walk-in configuration. Missing or inactive values are returned
// as UNAVAILABLE; the route never accepts seller or recipient overrides at
// document/POS request time.
// @spec ADR-065; BR-001; SEC-001
// @tested tests/e2e/fr186-billing-pos.spec.js, tests/integration/fr186-billing.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const businessId = new URL(request.url).searchParams.get('businessId')
    return getBillingProfile(businessId, { viewer })
  })
}

export async function PATCH(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const businessId = new URL(request.url).searchParams.get('businessId')
    const body = await request.json().catch(() => ({}))
    return updateBillingProfile(businessId, body, { viewer })
  })
}
