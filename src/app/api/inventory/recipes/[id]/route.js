import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { applyRecipeAction, getRecipe } from '@/modules/inventory/application/inventory-recipe-service'

// @req FR-156 — one recipe. GET reads it exploded to `?quantity=` (default:
//   its batch size) with every component's on-hand recomputed from the ledger,
//   the shortage per line and the maximum quantity the current stock allows;
//   PATCH applies one versioned action — UPDATE the fields and, when given,
//   the whole line set, or ARCHIVE — under manager authority with the caller's
//   `version` as the compare-and-swap. No DELETE. An unknown id and a recipe
//   in a Business the viewer may not see answer identically (FR-072).
// @spec BR-002; SEC-001; BR-012
// @tested tests/unit/inventory-routes.test.js, tests/integration/fr156-inventory-recipe.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return getRecipe(params?.id, { quantity: query?.quantity, viewer })
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return applyRecipeAction(params?.id, body, { viewer })
  })
}
