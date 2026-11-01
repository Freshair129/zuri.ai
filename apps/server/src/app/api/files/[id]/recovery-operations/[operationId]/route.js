// @req FR-292 — live authorized recovery history, without provider IO or secrets.
// @spec ADR-115, SEC-008
// @tested tests/integration/managed-blob-recovery-http.test.js
import { resolveRequestViewerAndHandleRecovery } from '@/modules/project-manager/application/managed-blob-recovery-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function GET(request, { params }) {
  const { id, operationId } = await params
  return resolveRequestViewerAndHandleRecovery(request, { fileId: id, operationId, action: 'status' })
}
