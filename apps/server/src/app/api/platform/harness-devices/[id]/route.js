import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { decideHarnessCredential } from '@/modules/identity/harness-credential'

// @req FR-220 — the installation operator activates a pending device or revokes one; effective on its next use.
// @spec ADR-087 D2, D3, SEC-001
// @tested tests/unit/harness-credential.test.js
export const dynamic = 'force-dynamic'
export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return decideHarnessCredential({ viewer, id: params.id, action: body?.action, version: body?.version, reason: body?.reason })
  })
}