// @req FR-248, FR-249 — any signed-in person records their own page view or
//   named action; an operator reads the breakdown. Recording is not
//   operator-gated on purpose: usage is a fact about whoever is using the
//   product, not an installation-operator action.
// @spec ADR-095 D2, FR-046
// @tested tests/unit/usage-events.test.js
import { handle, queryParams } from '@/app/api/_helpers'
import prisma from '@/lib/db'
import { recordUsageEvent, listUsageBreakdown } from '@/modules/platform-control/application/usage-events'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { assertOperatorAndRecordUse } from '@/modules/identity/operator-use'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    const event = await recordUsageEvent(prisma, {
      kind: body?.kind, route: body?.route ?? null, actionName: body?.actionName ?? null,
      personId: viewer.principal.id, sessionId: body?.sessionId ?? null,
    })
    return { id: event.id }
  })
}

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const q = queryParams(request)
    await assertOperatorAndRecordUse(viewer, {
      action: 'USAGE_EVENTS_READ',
      deniedMessage: 'Usage breakdown is an installation-wide read and requires operator authority',
      payload: { kind: q.kind || null },
    })
    const pageViews = await listUsageBreakdown(prisma, { kind: 'PAGE_VIEW' })
    const actions = await listUsageBreakdown(prisma, { kind: 'ACTION' })
    return { pageViews, actions }
  })
}
