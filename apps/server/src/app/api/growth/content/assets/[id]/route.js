import prisma from '@/lib/db'
import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { getMarketingContentAsset } from '@/modules/marketing/application/marketing-content-service'
import { createMarketingContentRepository } from '@/modules/marketing/infrastructure/marketing-content-repository'

// @req FR-157 — Asset detail is addressed by immutable MarketingContentVersion
// identity and revalidates current approval/file rights without exposing owner
// storage locators.
// @spec SDD-088, SEC-001, SEC-008
// @tested tests/unit/marketing/marketing-content-route.test.js,
//   tests/integration/marketing-content.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const { businessId } = queryParams(request)
    return getMarketingContentAsset(
      { viewer, businessId, assetId: params.id },
      { db: prisma, createRepository: createMarketingContentRepository },
    )
  })
}
