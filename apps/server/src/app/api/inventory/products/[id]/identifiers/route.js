import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { addIdentifier, applyIdentifierAction, listIdentifiers } from '@/modules/inventory/application/inventory-identity-service'

// @req FR-203 — the identifiers of one SKU. GET lists the active ones (retired
//   on request); POST adds one under manager authority — a GTIN with a valid
//   check digit, a barcode, a supplier code, a manufacturer part or a legacy
//   code, unique per Tenant per kind and never a key (BR-002); PATCH retires
//   one with the caller's `version` as the compare-and-swap. No DELETE.
// @spec BR-002; SEC-001; BR-012
// @tested tests/unit/inventory-routes.test.js, tests/integration/fr201-inventory-sku-governance.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return listIdentifiers(params?.id, { includeRetired: query?.includeRetired === 'true', viewer })
  })
}

export async function POST(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return addIdentifier(params?.id, body, { viewer })
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return applyIdentifierAction(params?.id, body, { viewer })
  })
}
