import { handle, queryParams } from '../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  listLineRegistry,
  saveLineGroup,
  saveLineUser,
} from '@/modules/integration/application/line-registry-service'

// @req FR-080 — Platform LINE Registry endpoint
// @spec ADR-032, SEC-016, SDD-044, SEC-001
// @tested tests/unit/line-registry-service.test.js, tests/integration/line-registry-scope.test.js
//
// The handler stays thin on purpose: `businessId` is an optional filter, never
// the scope. Omitting it used to mean "no filter at all" inside the service, so
// a plain GET returned every tenant's LINE registry; the service now scopes to
// the viewer's owned Businesses whether or not this route passes one.

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(() => {
    const params = queryParams(request)
    return listLineRegistry({
      businessId: params.businessId || null,
      type: params.type || 'ALL',
      resolve: () => resolveRequestViewer(request),
    })
  })
}

export async function POST(request) {
  return handle(async () => {
    const body = await request.json()
    const resolve = () => resolveRequestViewer(request)
    if (body.kind === 'USER' || body.userId) {
      return saveLineUser(body, { resolve })
    }
    return saveLineGroup(body, { resolve })
  })
}
