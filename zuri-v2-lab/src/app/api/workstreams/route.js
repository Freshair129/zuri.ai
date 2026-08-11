import { handle, queryParams } from '../_helpers'
import { listWorkstreams, createWorkstream } from '@/modules/project-manager/application/project-service'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const q = queryParams(request)
  return handle(() =>
    listWorkstreams({ projectId: q.projectId || undefined, executionMode: q.executionMode || undefined })
  )
}

export async function POST(request) {
  return handle(async () => createWorkstream(await request.json()))
}
