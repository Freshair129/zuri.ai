import { handle, queryParams } from '../_helpers'
import { listMilestonesAndGates, createMilestone } from '@/modules/project-manager/application/milestone-gate-service'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const q = queryParams(request)
  return handle(() =>
    listMilestonesAndGates({ projectId: q.projectId || undefined, workstreamId: q.workstreamId || undefined })
  )
}

export async function POST(request) {
  return handle(async () => createMilestone(await request.json()))
}
