// @req FR-003 — project CRUD: list and create
import { handle, queryParams } from '../_helpers'
import { listProjects, createProject } from '@/modules/project-manager/application/project-service'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const q = queryParams(request)
  return handle(() =>
    listProjects({
      workspaceId: q.workspaceId || undefined,
      businessId: q.businessId || undefined,
      tenantId: q.tenantId || undefined,
      status: q.status || undefined,
      q: q.q || undefined,
    })
  )
}

export async function POST(request) {
  return handle(async () => createProject(await request.json()))
}
