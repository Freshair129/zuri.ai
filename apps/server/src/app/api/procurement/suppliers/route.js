import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createSupplier, listSuppliers } from '@/modules/procurement/application/supplier-service'

// @req FR-164 — the suppliers of one Business. GET lists the ACTIVE ones
//   (archived on request) with their purchase-order count; POST creates one
//   under Business OWNER or PROCUREMENT_BUYER authority with a `code` unique
//   per Tenant. Both need the `procurement` domain (FR-061) and answer the
//   FR-072 404 without it. `businessId` is a selector the service validates
//   against the trusted viewer, never the scope.
// @spec ADR-066; BR-002; SEC-001; BR-012
// @tested tests/unit/procurement-routes.test.js, tests/integration/fr164-procurement.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const q = queryParams(request)
    return listSuppliers({ businessId: q?.businessId, ...(q?.includeArchived === 'true' ? { includeArchived: true } : {}) }, { viewer })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return createSupplier(body, { viewer })
  })
}
