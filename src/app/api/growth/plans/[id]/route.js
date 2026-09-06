import prisma from '@/lib/db'
import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  archiveMarketingPlan,
  decideMarketingPlan,
  getMarketingPlan,
  reviseMarketingPlan,
  reviewMarketingPlan,
} from '@/modules/marketing/application/marketing-plan-service'
import { zMarketingPlanActionInput } from '@/modules/marketing/domain/marketing-plan-contract'
import { createMarketingPlanRepository } from '@/modules/marketing/infrastructure/marketing-plan-repository'

// @req FR-155 — address one Strategy plan by its internal UUID, re-resolving
// Business visibility and ownership on every read or mutation.
// @spec SDD-086, BR-001, SEC-001, SEC-008
// @tested tests/unit/marketing/marketing-plan-route.test.js,
//   tests/integration/marketing-plan.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const { businessId } = queryParams(request)
    return getMarketingPlan(
      { viewer, businessId, planId: params.id },
      { db: prisma, createRepository: createMarketingPlanRepository },
    )
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const input = zMarketingPlanActionInput.parse(await request.json())
    const dependencies = {
      db: prisma,
      viewer,
      createRepository: createMarketingPlanRepository,
    }

    if (input.action === 'revise') return reviseMarketingPlan(params.id, input, dependencies)
    if (input.action === 'review') return reviewMarketingPlan(params.id, input, dependencies)
    if (input.action === 'decide') return decideMarketingPlan(params.id, input, dependencies)
    return archiveMarketingPlan(params.id, input, dependencies)
  })
}

