import { handle, queryParams } from '../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  listLineRegistry,
  saveLineGroup,
  saveLineUser,
} from '@/modules/integration/application/line-registry-service'

// @req FR-080 — Platform LINE Registry endpoint
// @spec ADR-032, SEC-016, SDD-044
// @tested tests/unit/line-registry-service.test.js

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
