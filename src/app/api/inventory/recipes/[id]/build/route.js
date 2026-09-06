import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { buildRecipe } from '@/modules/inventory/application/inventory-recipe-service'

// @req FR-156 — build `quantity` units from one recipe: one transaction that
//   issues every counted component through the ledger (FEFO for lot-tracked
//   ones, FR-155) and receives the output SKU when it is counted, or does
//   nothing at all — refused as a whole when any component is short (the
//   response names each shortage), when a component or the output is
//   SERIAL-tracked, or when a LOT-tracked output has no `outputLotCode`.
//   POST only, manager authority; refusals of scope are the FR-072 404.
// @spec BR-002; SEC-001; BR-012
// @tested tests/unit/inventory-routes.test.js, tests/integration/fr156-inventory-recipe.test.js

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return buildRecipe(params?.id, body, { viewer })
  })
}
