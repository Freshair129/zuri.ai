import prisma from '@/lib/db'
import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  getMarketingContent,
  updateMarketingContent,
} from '@/modules/marketing/application/marketing-content-service'
import { zMarketingContentActionInput } from '@/modules/marketing/domain/marketing-content-contract'
import { createMarketingContentRepository } from '@/modules/marketing/infrastructure/marketing-content-repository'

// @req FR-157 — Content brief detail re-resolves Business scope on reads and
// dispatches only the strict immutable revision/review/decision/archive actions.
// @spec SDD-088, SEC-001, SEC-008
// @tested tests/unit/marketing/marketing-content-route.test.js,
//   tests/integration/marketing-content.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const { businessId } = queryParams(request)
    return getMarketingContent(
      { viewer, businessId, briefId: params.id },
      { db: prisma, createRepository: createMarketingContentRepository },
    )
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const input = zMarketingContentActionInput.parse(await request.json())
    return updateMarketingContent(params.id, input, {
      db: prisma,
      viewer,
      createRepository: createMarketingContentRepository,
    })
  })
}
