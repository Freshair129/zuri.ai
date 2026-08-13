// @req FR-013, FR-045 - snapshot export with explicit optional local content.
// @spec BR-008, SDD-023, ADR-016 D10
// @tested tests/integration/backup.test.js, tests/unit/fr045-backup-contract.test.js
import { handle } from '../../_helpers'
import { exportSnapshot } from '@/modules/project-manager/application/backup-service'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const includeBinaryContent = new URL(request.url).searchParams.get('includeBinaryContent') === '1'
  return handle(() => exportSnapshot({ includeBinaryContent }))
}
