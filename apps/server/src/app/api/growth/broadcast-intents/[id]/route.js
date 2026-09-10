import prisma from '@/lib/db'
import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  getMarketingBroadcastIntent,
  updateMarketingBroadcastIntent,
} from '@/modules/marketing/application/marketing-broadcast-service'

// @req FR-185 — read and CAS revise/archive one durable broadcast planning
// identity, with no dispatch action.
// @spec SDD-086, SEC-001, SEC-003
// @tested tests/unit/marketing/marketing-broadcast-route.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const { businessId } = queryParams(request)
    return getMarketingBroadcastIntent({ viewer, businessId, id: params.id }, { db: prisma })
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return updateMarketingBroadcastIntent(params.id, await request.json(), { viewer, db: prisma })
  })
}

