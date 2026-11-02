// @req FR-293 — export only through the reserved-ref operator transfer contract.
// @spec ADR-115, SEC-008
// @tested tests/integration/managed-blob-transfer.test.js
import { handleManagedBlobBackupTransfer } from '@/modules/project-manager/application/managed-blob-transfer-http'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function POST(request) { return handleManagedBlobBackupTransfer(request, { action: 'export', requestViewerResolver: resolveRequestViewer }) }
