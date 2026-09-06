import prisma from '@/lib/db'
import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listMarketingContentReferences } from '@/modules/marketing/application/marketing-content-references'

// @req FR-157 — expose bounded, read-only owner references for Content forms
// without copying Files bytes or mutating Project Manager records.
// @spec SDD-088, SEC-001, SEC-008
// @tested tests/integration/marketing-content-references.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return listMarketingContentReferences(
      { viewer, businessId: query.businessId, projectId: query.projectId || null },
      { db: prisma },
    )
  })
}
