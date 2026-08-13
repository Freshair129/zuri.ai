// @req FR-013, FR-045 - preview/confirm restore with explicit device remounts.
// @spec BR-008, SDD-023, ADR-016 D10
// @tested tests/integration/backup.test.js, tests/unit/fr045-backup-contract.test.js
import { handle } from '../../_helpers'
import { previewImport, importSnapshot } from '@/modules/project-manager/application/backup-service'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const body = await request.json()
    if (body.confirm === true) {
      return importSnapshot(body.snapshot, { confirm: true, remounts: body.remounts || [] })
    }
    return previewImport(body.snapshot, { remounts: body.remounts || [] })
  })
}
