// @req FR-169 — an OWNER turns one Business capability on or off. PATCH only:
//   capabilities are read everywhere through /api/scope's Business rows, so
//   there is no separate GET here.
// @spec BR-001, SEC-003
// @tested tests/integration/fr169-business-capability.test.js
import { handle } from '../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { updateBusinessCapability } from '@/modules/business/application/business-capability-service'

export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return updateBusinessCapability(params.id, await request.json(), { viewer })
  })
}
