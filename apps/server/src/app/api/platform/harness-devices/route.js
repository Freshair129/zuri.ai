import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listHarnessCredentials } from '@/modules/identity/harness-credential'

// @req FR-220 — the installation operator lists paired harness devices: person, label, status, last use. No key material.
// @spec ADR-087 D3, SEC-001
// @tested tests/unit/harness-credential.test.js
export const dynamic = 'force-dynamic'
export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return listHarnessCredentials({ viewer })
  })
}