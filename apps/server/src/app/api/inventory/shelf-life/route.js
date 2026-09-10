import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { recordLotMaintenance, shelfLifeAudit } from '@/modules/inventory/application/inventory-shelf-life-service'

// @req FR-182, FR-179 — the storage-ageing audit and the one write that resets a batch's
//   clock. GET reports every lot of every product that declares a storage limit
//   as OK, DUE (surfaced, still issuable) or EXPIRED (refused for issue and for
//   kitting), narrowed by `?thresholdDays=` and including empty lots with
//   `?includeEmpty=true`. POST records that a batch was actually restored — a
//   deliberate, audited act, never a side effect of reading the report — and
//   touches no stock quantity, because maintenance changes what a lot may do,
//   not how many of it there are.
// @spec ADR-074 D7; BR-030; SEC-001
// @tested tests/unit/scm-console-routes.test.js, tests/integration/fr182-scm-console-actions.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return shelfLifeAudit({
      businessId: query?.businessId,
      thresholdDays: query?.thresholdDays ? Number(query.thresholdDays) : undefined,
      includeEmpty: query?.includeEmpty === 'true',
      viewer,
    })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return recordLotMaintenance(body, { viewer })
  })
}
