// @req FR-045 - explicit local filesystem reconciliation.
// @spec SDD-023, ADR-016 D6
// @tested tests/unit/fr045-reconcile-cache.test.js
import { handle } from '../../_helpers'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { reconcileLocalFiles } from '@/modules/project-manager/application/file-reconcile-cache-service'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveViewer()
    return reconcileLocalFiles(await request.json(), { visibleBusinessIds: viewer.visibleBusinessIds })
  })
}
