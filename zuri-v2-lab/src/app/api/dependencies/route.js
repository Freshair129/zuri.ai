import { handle, queryParams } from '../_helpers'
import { listDependencies, createDependency } from '@/modules/project-manager/application/dependency-service'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const q = queryParams(request)
  return handle(() => listDependencies({ projectId: q.projectId || undefined }))
}

export async function POST(request) {
  return handle(async () => createDependency(await request.json()))
}
