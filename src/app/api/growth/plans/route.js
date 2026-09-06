import prisma from '@/lib/db'
import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  createMarketingPlan,
  listMarketingPlans,
} from '@/modules/marketing/application/marketing-plan-service'
import { createMarketingPlanRepository } from '@/modules/marketing/infrastructure/marketing-plan-repository'

// @req FR-153 — expose the Business-scoped Strategy plan collection through
// one authenticated route and the Marketing application service.
// @spec SDD-086, BR-001, SEC-001, SEC-008
// @tested tests/unit/marketing/marketing-plan-route.test.js,
//   tests/integration/marketing-plan.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const { businessId } = queryParams(request)
    return listMarketingPlans(
      { viewer, businessId },
      { db: prisma, createRepository: createMarketingPlanRepository },
    )
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json()
    return createMarketingPlan(body, {
      db: prisma,
      viewer,
      createRepository: createMarketingPlanRepository,
    })
  })
}

