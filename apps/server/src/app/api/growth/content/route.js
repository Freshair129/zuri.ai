import prisma from '@/lib/db'
import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  createMarketingContent,
  listMarketingContent,
} from '@/modules/marketing/application/marketing-content-service'
import { createMarketingContentRepository } from '@/modules/marketing/infrastructure/marketing-content-repository'

// @req FR-157 — Content collection resolves trusted viewer scope and delegates
// all persistence and reference validation to the Marketing owner service.
// @spec SDD-088, SEC-001, SEC-008
// @tested tests/unit/marketing/marketing-content-route.test.js,
//   tests/integration/marketing-content.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const { businessId } = queryParams(request)
    return listMarketingContent(
      { viewer, businessId },
      { db: prisma, createRepository: createMarketingContentRepository },
    )
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return createMarketingContent(await request.json(), {
      db: prisma,
      viewer,
      createRepository: createMarketingContentRepository,
    })
  })
}
