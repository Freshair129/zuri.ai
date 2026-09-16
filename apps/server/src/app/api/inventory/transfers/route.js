import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { transferStock } from '@/modules/inventory/application/location-transfer-service'

// @req FR-182, FR-174 — move stock between two locations. One POST is one ISSUE at the
//   source and one RECEIPT at the target inside a single transaction, so
//   Business-wide on-hand is unchanged by construction while the located
//   buckets move (BR-026). There is no GET: a transfer is not a record of its
//   own — it is two ledger rows, and `/api/inventory/stock-movements` already
//   reads those. Manager authority; the branded-stock refusal (BR-028) and the
//   shelf-life guard (FR-179) both apply through the ledger writer.
// @spec ADR-074 D2; BR-026; BR-028; SEC-001
// @tested tests/unit/scm-console-routes.test.js, tests/integration/fr182-scm-console-actions.test.js

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return transferStock(body, { viewer })
  })
}
