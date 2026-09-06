import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listLiffApps, registerLiffApp } from '@/modules/line-oa-studio/application/line-oa-liff-app-service'

// @req FR-153 — the LIFF app registry of one LINE OA Studio account. GET
//   lists it (Business visibility plus the `line-oa` domain, FR-061); POST
//   registers an app under publisher authority (Business OWNER or
//   LINE_OA_PUBLISHER). Both refuse an account the caller may not see with
//   the same 404 an unknown one gets (FR-072). `accountId` is a selector the
//   service validates against the trusted viewer, never the scope.
// @spec SRS LOS-RQ-070; ADR-060 D11; SEC-001; BR-012
// @tested tests/unit/line-oa-liff-app-routes.test.js,
//   tests/integration/fr153-line-oa-liff-app.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return listLiffApps({ accountId: query?.accountId, includeArchived: query?.includeArchived === 'true', viewer })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return registerLiffApp(body, { viewer })
  })
}
