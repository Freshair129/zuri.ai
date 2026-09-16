import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { addUnitConversion, applyUnitConversionAction, listUnitConversions } from '@/modules/inventory/application/inventory-identity-service'

// @req FR-204 — the unit conversions of one SKU: GET lists them with the base
//   unit; POST declares one (a pack size as an integer factor, never a second
//   SKU — BR-037) under manager authority; PATCH updates or retires one with
//   the caller's `version` as the compare-and-swap. No DELETE.
// @spec BR-002; SEC-001; BR-012
// @tested tests/unit/inventory-routes.test.js, tests/integration/fr201-inventory-sku-governance.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return listUnitConversions(params?.id, { includeRetired: query?.includeRetired === 'true', viewer })
  })
}

export async function POST(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return addUnitConversion(params?.id, body, { viewer })
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return applyUnitConversionAction(params?.id, body, { viewer })
  })
}
