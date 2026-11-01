// @req FR-292, FR-293 — bounded preview and explicit recovery transitions.
// @spec ADR-115, SEC-008
// @tested tests/integration/managed-blob-recovery-http.test.js
import { resolveRequestViewerAndHandleRecovery } from '@/modules/project-manager/application/managed-blob-recovery-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function POST(request, { params }) {
  const { id, operationId, action } = await params
  // The collection and status have their own method/path, never aliases here.
  return resolveRequestViewerAndHandleRecovery(request, { fileId: id, operationId,
    action: ['preview', 'stage', 'confirm', 'inspect', 'abandon'].includes(action) ? action : null })
}
