import prisma from '@/lib/db'
import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { getMarketingOperationsHandoff } from '@/modules/marketing/application/marketing-operations-service'

// @req FR-162 — Handoff detail exposes only a validated owner receipt and
// PM-owned roadmap projection; Marketing cannot acknowledge or rewrite it.
// @spec SDD-089, FR-158, SEC-001, SEC-003
// @tested tests/unit/marketing/marketing-operations-route.test.js,
//   tests/integration/marketing-operations.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const { businessId } = queryParams(request)
    return getMarketingOperationsHandoff(params?.handoffId, { businessId, viewer }, { db: prisma })
  })
}
