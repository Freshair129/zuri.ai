// @req FR-292, FR-293 — supported recovery preparation; activation remains gated.
// @spec ADR-115, SEC-008
// @tested tests/integration/managed-blob-recovery-http.test.js
import { resolveRequestViewerAndHandleRecovery } from '@/modules/project-manager/application/managed-blob-recovery-http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function POST(request, { params }) {
  const { id } = await params
  return resolveRequestViewerAndHandleRecovery(request, { fileId: id, action: 'prepare' })
}
