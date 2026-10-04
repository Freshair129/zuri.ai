import prisma from '@/lib/db'
import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { getLineSalesExecutiveDashboard } from '@/modules/marketing/application/line-sales-dashboard-service'

// @req FR-278 — serve the Business-scoped executive read projection only.
// @spec SEC-001; SDD-086
// @tested tests/unit/marketing/line-sales-dashboard-route.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return getLineSalesExecutiveDashboard({
      businessId: query.businessId,
      ...(query.weekOf ? { weekOf: query.weekOf } : {}),
    }, { viewer, db: prisma })
  })
}
