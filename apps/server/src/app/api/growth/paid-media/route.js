import prisma from '@/lib/db'
import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { getMarketingPaidMedia } from '@/modules/marketing/application/marketing-insights-service'

// @req FR-185 — expose truthful Marketing paid-media source states without
// provider fixtures, fabricated zeros or an attribution writer.
// @spec SDD-086, ADR-065, SEC-001
// @tested tests/unit/marketing/marketing-insights-route.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return getMarketingPaidMedia({ businessId: query.businessId, viewer }, {
      db: prisma,
      from: query.from || null,
      to: query.to || null,
    })
  })
}

