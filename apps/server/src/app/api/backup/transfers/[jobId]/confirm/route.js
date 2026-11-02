// @req FR-293 — only a current source-bound disposable TEST admission can confirm.
// @spec ADR-115, SEC-008
// @tested tests/integration/managed-blob-transfer.test.js
import { handleManagedBlobBackupTransfer } from '@/modules/project-manager/application/managed-blob-transfer-http'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function POST(request, { params }) {
  const { jobId } = await params
  return handleManagedBlobBackupTransfer(request, { action: 'confirm', jobId, requestViewerResolver: resolveRequestViewer })
}
