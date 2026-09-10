import prisma from '@/lib/db'
import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  createMarketingBroadcastIntent,
  listMarketingBroadcastIntents,
} from '@/modules/marketing/application/marketing-broadcast-service'

// @req FR-185 — expose durable Business-scoped broadcast planning identities;
// this route has no send or recipient expansion operation.
// @spec SDD-086, SEC-001, SEC-003
// @tested tests/unit/marketing/marketing-broadcast-route.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const { businessId } = queryParams(request)
    return listMarketingBroadcastIntents({ viewer, businessId }, { db: prisma })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return createMarketingBroadcastIntent(await request.json(), { viewer, db: prisma })
  })
}

