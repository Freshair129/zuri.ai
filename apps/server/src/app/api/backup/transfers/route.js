// @req FR-293 — authorized operators can recover durable transfer job IDs after a lost response.
// @spec ADR-115, SEC-008
// @tested tests/integration/managed-blob-transfer.test.js
import { handleManagedBlobBackupTransfer } from '@/modules/project-manager/application/managed-blob-transfer-http'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function GET(request) {
  return handleManagedBlobBackupTransfer(request, { action: 'current', requestViewerResolver: resolveRequestViewer })
}
