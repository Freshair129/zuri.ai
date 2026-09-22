// @req FR-021, FR-069 — bind FUNG/Lalin AI source subjects to an existing
// canonical Person before meeting actions may cross into Project Manager.
// @spec BR-002, SEC-001, SEC-003 — owner-attested, tenant-scoped mapping;
// no first-contact identity minting and no display-name matching.
// @tested tests/unit/meeting-action-route-contract.test.js
import { handle, httpError } from '../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { linkMeetingIdentity } from '@/modules/project-manager/import/meeting-action-intake'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    const tenantId = body.tenantId ?? viewer.ownedTenantIds?.[0]
    const personId = body.personId ?? viewer.personId ?? viewer.principal?.id
    if (!tenantId || !personId) throw httpError(400, 'tenantId and personId are required')
    return linkMeetingIdentity({ ...body, tenantId, personId, viewer })
  })
}
