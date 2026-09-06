import { handle, queryParams } from '../../../_helpers'
import {
  getProjectInventory,
  parseProjectInventoryQuery,
} from '@/modules/project-manager/application/project-inventory-read-model'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

// @req FR-077 — authorized Project Inventory read endpoint with an independent DTO contract.
// @spec SDD-045, ADR-034, ADR-017
// @tested tests/integration/project-inventory.test.js, tests/e2e/fr077-project-inventory.spec.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = parseProjectInventoryQuery(queryParams(request))
    return getProjectInventory(params.id, { viewer, ...query })
  })
}
