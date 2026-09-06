import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createRichMenu, listRichMenus } from '@/modules/line-oa-studio/application/line-oa-rich-menu-service'

// @req FR-151 — the rich menu collection of one LINE OA Studio account. GET
//   lists the account's menus with their versions (Business visibility plus
//   the `line-oa` domain, FR-061); POST creates a menu with its first draft
//   under publisher authority (Business OWNER or LINE_OA_PUBLISHER). Both
//   refuse an account the caller may not see with the same 404 an unknown one
//   gets (FR-072). The handler stays thin: `accountId` is a selector the
//   service validates against the trusted viewer, never the scope.
// @spec ADR-060 D3, D11; SEC-001; BR-012
// @tested tests/unit/line-oa-rich-menu-routes.test.js,
//   tests/integration/fr151-line-oa-rich-menu.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return listRichMenus({
      accountId: query?.accountId,
      includeArchived: query?.includeArchived === 'true',
      viewer,
    })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return createRichMenu(body, { viewer })
  })
}
