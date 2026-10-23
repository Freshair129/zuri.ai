import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { setLineStockDisclosurePolicy } from '@/modules/inventory/application/line-stock-disclosure-policy-service'

// @req FR-291 — authenticated Business OWNERs may version a per-LINE-account,
// per-SKU stock disclosure grant; the default state is disabled.
// @tested tests/integration/line-stock-disclosure-policy.test.js

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return setLineStockDisclosurePolicy(body, { viewer })
  })
}
