import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { previewCatalogIntake } from '@/modules/inventory/application/catalog-intake-service'

// @req FR-208 — preview a catalogue intake envelope (JSON surface). Every item
//   is resolved against the catalogue before a create is planned; the plan and
//   its `planHash` are persisted and returned. Idempotent on
//   (businessId, source.channel, source.correlationId). Nothing in the
//   catalogue is written. Needs Inventory write authority; refusals are 404.
// @spec ADR-084 D1, D2; BR-009, BR-041; SEC-001
// @tested tests/unit/inventory-routes.test.js, tests/integration/fr208-inventory-catalog-intake.test.js

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return previewCatalogIntake(body, { viewer })
  })
}
