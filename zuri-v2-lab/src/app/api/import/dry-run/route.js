import { handle } from '../../_helpers'
import { dryRunPlan, resolveImportWorkspaceId } from '@/modules/project-manager/import/plan-import-service'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const body = await request.json()
    return dryRunPlan(body.plan, { workspaceId: await resolveImportWorkspaceId(body) })
  })
}
