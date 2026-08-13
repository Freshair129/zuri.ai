// @req FR-045 - managed FileAsset list/create API.
// @spec SDD-023, SEC-007, ADR-016
// @tested tests/unit/fr045-api-ui-contract.test.js
import prisma from '@/lib/db'
import { handle, queryParams } from '../_helpers'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { createManagedFileAsset, listManagedFileAssets } from '@/modules/project-manager/application/file-asset-service'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const { businessId: requestedBusinessId, projectId } = queryParams(request)
    const viewer = await resolveViewer()
    let businessId = requestedBusinessId
    if (!businessId && projectId) {
      businessId = (await prisma.project.findUnique({ where: { id: projectId }, select: { businessId: true } }))?.businessId
    }
    if (!businessId) throw new Error('businessId or an owned projectId is required')
    return listManagedFileAssets({ businessId, projectId: projectId || null }, { visibleBusinessIds: viewer.visibleBusinessIds })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveViewer()
    const body = await request.json()
    return createManagedFileAsset({ ...body, uploadedBy: viewer.principal.id }, { visibleBusinessIds: viewer.visibleBusinessIds })
  })
}
