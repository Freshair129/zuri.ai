// @req FR-045 - explicit dry-run/confirm ProjectFile migration.
// @spec SDD-023, ADR-016 D4, ZV2-CR-001
// @tested tests/unit/fr045-file-asset-service.test.js
import { handle } from '../../_helpers'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { migrateProjectFiles } from '@/modules/project-manager/application/file-asset-service'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveViewer()
    if (!['OWNER', 'DEV'].includes(viewer.role)) throw new Error('Migration is denied for this viewer')
    const body = await request.json()
    return migrateProjectFiles({ confirm: body.confirm === true })
  })
}
