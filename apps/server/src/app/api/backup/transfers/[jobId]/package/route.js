// @req FR-293 — serve only a complete, unexpired sealed transfer package.
// @spec ADR-115, SEC-008
// @tested tests/integration/managed-blob-transfer.test.js
import { handleManagedBlobBackupTransfer } from '@/modules/project-manager/application/managed-blob-transfer-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function GET(request, { params }) {
  const { jobId } = await params
  return handleManagedBlobBackupTransfer(request, { action: 'package', jobId })
}
