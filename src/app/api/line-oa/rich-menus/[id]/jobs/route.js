import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { acknowledgeUnknownRichMenuJob, listRichMenuJobs, queueRichMenuJob } from '@/modules/line-oa-studio/application/line-oa-rich-menu-jobs'

// @req FR-152 — the job ledger of one rich menu. GET lists it (Business
//   visibility plus the `line-oa` domain, FR-061); POST queues one job —
//   PUBLISH, SET_DEFAULT or SET_ALIAS — under publisher authority with the
//   menu's `version` as the compare-and-swap; PATCH lets a publisher
//   acknowledge an UNKNOWN job. Nothing here calls LINE: the worker does, on
//   its own tick. Refusals are the FR-072 404.
// @spec ADR-061 D1, D7; ADR-060 D11; SEC-001; BR-012
// @tested tests/unit/line-oa-rich-menu-jobs-routes.test.js,
//   tests/integration/fr152-line-oa-rich-menu-jobs.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return listRichMenuJobs(params?.id, { viewer })
  })
}

export async function POST(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return queueRichMenuJob(params?.id, body, { viewer })
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return acknowledgeUnknownRichMenuJob(params?.id, body, { viewer })
  })
}
