import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { availableToPromiseFor, maxBuildableSets } from '@/modules/inventory/application/inventory-atp-service'

// @req FR-182, FR-180 — Available-to-Promise. With `?recipeId=` it answers how many
//   complete sets that bill of materials still allows — computed from ATP, not
//   on-hand, so two quotes cannot promise the same components — optionally at a
//   `?quantity=`. Without one it answers per product, narrowed by a repeated
//   `?productId=`. An uncounted product reports `available: null` rather than a
//   zero that would read as "measured and empty".
// @spec ADR-074 D8; BR-031; SEC-001
// @tested tests/unit/scm-console-routes.test.js, tests/integration/fr182-scm-console-actions.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const url = new URL(request.url)
    const query = queryParams(request)
    if (query?.recipeId) {
      return maxBuildableSets({
        businessId: query.businessId,
        recipeId: query.recipeId,
        quantity: query.quantity ? Number(query.quantity) : undefined,
        viewer,
      })
    }
    const productIds = url.searchParams.getAll('productId').filter(Boolean)
    return availableToPromiseFor({ businessId: query?.businessId, productIds, viewer })
  })
}
