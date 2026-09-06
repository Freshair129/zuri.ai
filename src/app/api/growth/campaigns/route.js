import prisma from '@/lib/db'
import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  createMarketingCampaign,
  listMarketingCampaigns,
} from '@/modules/marketing/application/marketing-campaign-service'
import { createMarketingCampaignRepository } from '@/modules/marketing/infrastructure/marketing-campaign-repository'

// @req FR-156 — expose the bounded, Business-scoped Campaign collection and
// atomically create its Strategy plan and initiative through the service.
// @spec SDD-087, SEC-001, SEC-008
// @tested tests/unit/marketing/marketing-campaign-route.test.js,
//   tests/integration/marketing-campaign.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const { businessId } = queryParams(request)
    return listMarketingCampaigns(
      { viewer, businessId },
      { db: prisma, createRepository: createMarketingCampaignRepository },
    )
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json()
    return createMarketingCampaign(body, {
      db: prisma,
      viewer,
      createRepository: createMarketingCampaignRepository,
    })
  })
}

