import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveProduct } from '@/modules/inventory/application/inventory-identity-service'

// @req FR-203 — which SKU an identifier names: the `code`, the FlowAccount
//   code or any active barcode / partner code, followed through a merge to
//   the survivor. The call every intake makes before it creates a product
//   (ADR-083 D3). A miss is `{ product: null }` with 200 — "not known yet" is
//   the answer an intake acts on; an unseen Business is the FR-072 404.
// @spec BR-002; SEC-001
// @tested tests/unit/inventory-routes.test.js, tests/integration/fr201-inventory-sku-governance.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return resolveProduct({ businessId: query?.businessId, identifier: query?.identifier }, { viewer })
  })
}
