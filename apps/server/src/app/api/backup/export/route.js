// @req FR-013, FR-045 - snapshot export with explicit optional local content.
// @req FR-046, FR-075 — the full snapshot is an installation-wide read and
// resolves the trusted request viewer before the snapshot service runs.
// @spec BR-008, SDD-023, ADR-016 D10
// @tested tests/integration/backup.test.js, tests/unit/fr045-backup-contract.test.js
// @tested tests/unit/authorization-seam-routes.test.js
import { handle } from '../../_helpers'
import { exportSnapshot } from '@/modules/project-manager/application/backup-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { assertOperatorAndRecordUse } from '@/modules/identity/operator-use'
import prisma from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const includeBinaryContent = new URL(request.url).searchParams.get('includeBinaryContent') === '1'
    // @req FR-197 — exporting a whole-installation snapshot is an operator
    // action recorded before it runs (ADR-017 D6 read as covering operator
    // reads — ADR-079).
    await assertOperatorAndRecordUse(viewer, {
      action: 'BACKUP_EXPORT',
      deniedMessage: 'Snapshot export is an installation-wide read and requires operator authority',
      payload: { includeBinaryContent },
    })
    try {
      return await exportSnapshot({ includeBinaryContent })
    } catch (error) {
      if (error?.code !== 'MANAGED_BLOB_TRANSFER_REQUIRED') throw error
      const fence = await prisma.managedBlobRecoveryInstallationFence.findUnique({ where: { id: 'installation' } })
      return Response.json({ code: 'MANAGED_BLOB_TRANSFER_REQUIRED',
        message: 'Managed-blob content requires the complete transfer package.',
        ...(fence?.mode === 'READY' && Number.isSafeInteger(fence.generation) ? { expectedGeneration: fence.generation } : {}),
        retryable: false }, { status: 409, headers: { 'Cache-Control': 'no-store' } })
    }
  })
}
