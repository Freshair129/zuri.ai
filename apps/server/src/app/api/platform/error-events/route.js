// @req FR-247 — operator reads the deduplicated error list.
// @spec ADR-095 D1, FR-075
// @tested tests/unit/error-events.test.js
import { handle, queryParams } from '@/app/api/_helpers'
import prisma from '@/lib/db'
import { listErrorEvents } from '@/modules/platform-control/application/error-events'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { assertOperatorAndRecordUse } from '@/modules/identity/operator-use'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const q = queryParams(request)
    await assertOperatorAndRecordUse(viewer, {
      action: 'ERROR_EVENTS_READ',
      deniedMessage: 'The error list is an installation-wide read and requires operator authority',
      payload: { includeResolved: q.includeResolved === 'true' },
    })
    const events = await listErrorEvents(prisma, {
      limit: q.limit ? Number(q.limit) : undefined,
      includeResolved: q.includeResolved === 'true',
    })
    return { events }
  })
}
