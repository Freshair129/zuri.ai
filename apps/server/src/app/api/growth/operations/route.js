import prisma from '@/lib/db'
import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  createMarketingOperationsIntake,
  listMarketingOperations,
} from '@/modules/marketing/application/marketing-operations-service'

// @req FR-162 — one Business-scoped Operations aggregate and the Intake create
// path; Calendar, Approvals and Handoffs remain owner projections.
// @spec SDD-089, SEC-001, SEC-003
// @tested tests/unit/marketing/marketing-operations-route.test.js,
//   tests/integration/marketing-operations.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const { businessId } = queryParams(request)
    return listMarketingOperations({ businessId, viewer })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return createMarketingOperationsIntake(await request.json(), { viewer }, { db: prisma })
  })
}
