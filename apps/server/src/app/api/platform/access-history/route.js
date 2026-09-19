// @req FR-199 — a Business owner can read the access history of their own
//   scope. Query by exactly one of `businessId`, `tenantId`, `personId`; a
//   personId with no scope match, or a business/tenant the caller does not
//   own, answers the same 404 as one that does not exist (SEC-001).
// @spec ADR-080 D3/D4, BR-036, SEC-001, SEC-028
// @tested tests/integration/fr198-fr199-audit-access-evidence.test.js
import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listAccessHistory } from '@/modules/identity/access-history-service'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const q = queryParams(request)
    return listAccessHistory(
      {
        businessId: q.businessId || undefined,
        tenantId: q.tenantId || undefined,
        personId: q.personId || undefined,
        limit: q.limit ? Number(q.limit) : undefined,
      },
      { resolve: () => resolveRequestViewer(request) },
    )
  })
}
