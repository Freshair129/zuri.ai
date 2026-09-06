import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { applyRichMenuAction, getRichMenu } from '@/modules/line-oa-studio/application/line-oa-rich-menu-service'

// @req FR-151 — one rich menu with its versions. GET reads it (Business
//   visibility plus the `line-oa` domain, FR-061); PATCH applies one versioned
//   action — SAVE_DRAFT, FREEZE or ARCHIVE — under publisher authority, with
//   the caller's `version` as the compare-and-swap. There is no DELETE:
//   archiving keeps the menu and every frozen version. An unknown id and a
//   menu in a Business the viewer may not see answer identically (FR-072).
// @spec ADR-060 D3, D11; SEC-001; BR-012
// @tested tests/unit/line-oa-rich-menu-routes.test.js,
//   tests/integration/fr151-line-oa-rich-menu.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return getRichMenu(params?.id, { viewer })
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return applyRichMenuAction(params?.id, body, { viewer })
  })
}
