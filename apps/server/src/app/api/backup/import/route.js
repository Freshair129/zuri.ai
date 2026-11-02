// @req FR-013, FR-045 - preview/confirm restore with explicit device remounts.
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-075 — both the preview and the restore require installation-operator
// authority. Guarding only the confirmed restore would leave the preview handing
// out a row count for every table across every tenant.
// @spec BR-008, SDD-023, ADR-016 D10
// @spec SEC-008
// @tested tests/integration/backup.test.js, tests/unit/fr045-backup-contract.test.js
// @tested tests/integration/fr075-restore-authorization.test.js
import { handle } from '../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { previewImport, importSnapshot } from '@/modules/project-manager/application/backup-service'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json()
    try {
      if (body.confirm === true) {
        return await importSnapshot(body.snapshot, { confirm: true, remounts: body.remounts || [], viewer })
      }
      return await previewImport(body.snapshot, { remounts: body.remounts || [], viewer })
    } catch (error) {
      if (error?.code !== 'MANAGED_BLOB_TRANSFER_REQUIRED') throw error
      return Response.json({ code: 'MANAGED_BLOB_TRANSFER_REQUIRED',
        message: 'Managed-blob content requires the complete transfer package.', retryable: false },
      { status: 409, headers: { 'Cache-Control': 'no-store' } })
    }
  })
}
