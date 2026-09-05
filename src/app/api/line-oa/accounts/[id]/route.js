import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { applyLineOaAccountAction, getLineOaAccount } from '@/modules/line-oa-studio/application/line-oa-account-service'

// @req FR-146 — one LINE OA Studio account. GET reads it with computed health
//   (Business visibility plus the `line-oa` domain, FR-061); PATCH applies one
//   versioned action — PAUSE, RESUME, ARCHIVE, SET_DEFAULT or
//   SWITCH_TRANSPORT_MODE — under publisher authority (Business OWNER or
//   LINE_OA_PUBLISHER), with the caller's `version` as the compare-and-swap.
//   There is no DELETE: archiving keeps the row and its history. An unknown id
//   and an account in a Business the viewer may not see answer identically
//   (FR-072), so this is not an enumeration oracle over account ids.
// @spec ADR-060 D2, D5, D11; SEC-001; BR-012
// @tested tests/unit/line-oa-account-routes.test.js,
//   tests/integration/fr146-line-oa-account.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return getLineOaAccount(params?.id, { viewer })
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return applyLineOaAccountAction(params?.id, body, { viewer })
  })
}
