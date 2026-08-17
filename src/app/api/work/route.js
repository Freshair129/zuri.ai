// @req FR-005 — list or create work items in the neutral WorkContainer/WorkItem model
import { handle, queryParams } from '../_helpers'
import { listWork, createItem } from '@/modules/project-manager/application/work-service'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const q = queryParams(request)
  return handle(() =>
    listWork({
      workstreamId: q.workstreamId || undefined,
      projectId: q.projectId || undefined,
      executionMode: q.executionMode || undefined,
      subtype: q.subtype || undefined,
      status: q.status || undefined,
      q: q.q || undefined,
    })
  )
}

export async function POST(request) {
  return handle(async () => createItem(await request.json()))
}
