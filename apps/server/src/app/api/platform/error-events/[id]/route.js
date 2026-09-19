// @req FR-247 — an operator marks one fingerprint resolved; it stops counting as active.
// @spec ADR-095 D1, FR-075
// @tested tests/unit/error-events.test.js
import { handle } from '@/app/api/_helpers'
import prisma from '@/lib/db'
import { resolveErrorEvent } from '@/modules/platform-control/application/error-events'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { assertOperatorAndRecordUse } from '@/modules/identity/operator-use'

export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    await assertOperatorAndRecordUse(viewer, {
      action: 'ERROR_EVENT_RESOLVED',
      deniedMessage: 'Resolving an error event requires operator authority',
      payload: { id: params.id },
    })
    const event = await resolveErrorEvent(prisma, params.id, viewer.principal.id)
    return { event }
  })
}
