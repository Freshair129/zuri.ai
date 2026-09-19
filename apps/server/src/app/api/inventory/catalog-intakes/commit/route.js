import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { commitCatalogIntake } from '@/modules/inventory/application/catalog-intake-service'

// @req FR-208 — commit a previewed catalogue intake: `{ businessId, intakeId,
//   planHash }`. The plan is recomputed in the writing transaction and must
//   hash to what the caller saw; any CONFLICT or INVALID item, an expired or
//   cancelled preview, or a refusal from a catalogue writer rolls the whole
//   batch back. A committed intake replays. Needs Inventory write authority.
// @spec ADR-084 D2; BR-009, BR-041; SEC-001
// @tested tests/unit/inventory-routes.test.js, tests/integration/fr208-inventory-catalog-intake.test.js

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return commitCatalogIntake(body, { viewer })
  })
}
