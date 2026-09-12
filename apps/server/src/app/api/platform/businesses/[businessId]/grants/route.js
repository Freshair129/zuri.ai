// @req FR-199 — the current state a Business owner could not see before: every
//   grant in this Business, in every status, with who granted or revoked it
//   and why. Read-only; no write path lives here.
// @spec ADR-080 D3/D4, BR-036, SEC-001, SEC-028
// @tested tests/integration/fr198-fr199-audit-access-evidence.test.js
import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listBusinessAccess } from '@/modules/identity/access-history-service'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(() => listBusinessAccess(
    { businessId: params.businessId },
    { resolve: () => resolveRequestViewer(request) },
  ))
}
