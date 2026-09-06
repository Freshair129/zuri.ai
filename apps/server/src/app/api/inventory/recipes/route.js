import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createRecipe, listRecipes } from '@/modules/inventory/application/inventory-recipe-service'

// @req FR-156 — recipes (recipe_id) of one Business: the bill of materials of
//   an output SKU at one batch size. GET lists them, optionally by `productId`,
//   archived rows on request only (Business visibility plus the `inventory`
//   domain); POST creates one under manager authority with its lines. One
//   recipe per (product, batchSize). Refusals of scope are the FR-072 404.
// @spec BR-002; SEC-001; BR-012
// @tested tests/unit/inventory-routes.test.js, tests/integration/fr156-inventory-recipe.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return listRecipes({ businessId: query?.businessId, productId: query?.productId || undefined, includeArchived: query?.includeArchived === 'true', viewer })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return createRecipe(body, { viewer })
  })
}
