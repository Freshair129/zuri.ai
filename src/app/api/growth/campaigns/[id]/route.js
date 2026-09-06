import prisma from '@/lib/db'
import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  getMarketingCampaign,
  updateMarketingCampaign,
} from '@/modules/marketing/application/marketing-campaign-service'
import { zMarketingCampaignActionInput } from '@/modules/marketing/domain/marketing-campaign-contract'
import { createMarketingCampaignRepository } from '@/modules/marketing/infrastructure/marketing-campaign-repository'

// @req FR-156 — address one Campaign initiative by UUID, re-resolving
// Business visibility and ownership on every mutation.
// @spec SDD-087, SEC-001, SEC-008
// @tested tests/unit/marketing/marketing-campaign-route.test.js,
//   tests/integration/marketing-campaign.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const { businessId } = queryParams(request)
    return getMarketingCampaign(
      { viewer, businessId, initiativeId: params.id },
      { db: prisma, createRepository: createMarketingCampaignRepository },
    )
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const input = zMarketingCampaignActionInput.parse(await request.json())
    return updateMarketingCampaign(params.id, input, {
      db: prisma,
      viewer,
      createRepository: createMarketingCampaignRepository,
    })
  })
}

