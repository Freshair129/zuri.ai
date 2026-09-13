import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { applyProductAction, getProduct } from '@/modules/inventory/application/inventory-catalog-service'

// @req FR-154 — one product (SKU). GET reads it with its recomputed on-hand
//   (null for an UNTRACKED product); PATCH applies one versioned action —
//   UPDATE the descriptive fields and safety stock, or ARCHIVE — under manager
//   authority with the caller's `version` as the compare-and-swap. No DELETE:
//   archiving keeps the row. An unknown id and a product in a Business the
//   viewer may not see answer identically (FR-072).
// @req FR-205 — since ADR-083 the action vocabulary is five: UPDATE, ARCHIVE
//   (refused while stock or a live promise remains), PHASE_OUT, REACTIVATE and
//   MERGE `{ into }`, the anti-bloat repair that never deletes.
// @spec BR-002; SEC-001; BR-012; BR-040
// @tested tests/unit/inventory-routes.test.js, tests/integration/fr154-inventory-catalog.test.js,
//   tests/integration/fr201-inventory-sku-governance.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return getProduct(params?.id, { viewer })
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return applyProductAction(params?.id, body, { viewer })
  })
}
