import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { connectLineOaAccount, listLineOaAccounts } from '@/modules/line-oa-studio/application/line-oa-account-service'

// @req FR-146 — the LINE OA Studio account collection. GET lists the accounts
//   of one Business the viewer may see (Business visibility plus the `line-oa`
//   domain, FR-061), each with computed health; POST connects an existing
//   LINE_OA connection as a new account and needs publisher authority
//   (Business OWNER or LINE_OA_PUBLISHER). Both refuse a Business the caller
//   may not see with the same 404 an unknown Business gets (FR-072). The
//   handler stays thin: `businessId` is a selector the service validates
//   against the trusted viewer, never the scope.
// @spec ADR-060 D2, D3, D11; SEC-001; BR-012
// @tested tests/unit/line-oa-account-routes.test.js,
//   tests/integration/fr146-line-oa-account.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return listLineOaAccounts({
      businessId: query?.businessId,
      includeArchived: query?.includeArchived === 'true',
      viewer,
    })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return connectLineOaAccount(body, { viewer })
  })
}
