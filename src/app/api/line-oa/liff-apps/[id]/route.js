import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { applyLiffAppAction, getLiffApp } from '@/modules/line-oa-studio/application/line-oa-liff-app-service'

// @req FR-153 — one registered LIFF app. GET reads it; PATCH applies one
//   versioned action — UPDATE, RECORD_LIFF_ID or ARCHIVE — under publisher
//   authority with the caller's `version` as the compare-and-swap. No DELETE:
//   archiving keeps the row. An unknown id and an app in a Business the viewer
//   may not see answer identically (FR-072).
// @spec SRS LOS-RQ-070; ADR-060 D11; SEC-001; BR-012
// @tested tests/unit/line-oa-liff-app-routes.test.js,
//   tests/integration/fr153-line-oa-liff-app.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return getLiffApp(params?.id, { viewer })
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return applyLiffAppAction(params?.id, body, { viewer })
  })
}
