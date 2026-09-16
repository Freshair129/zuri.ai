import { handle, httpError } from '../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  setEmploymentOnLeave,
  reinstateEmployment,
  endEmployment,
} from '@/modules/people/application/employment-service'

// @req FR-193 — the three lifecycle transitions, as one PATCH taking an
// explicit `action` rather than three verbs invented from HTTP.
//
// They are one route because they are one decision — "what is this person's
// employment status now" — and because ENDED is terminal: routing `end` to a
// DELETE would say the row is removed, when the whole point of ADR-078 D1 is
// that an ended Employment stays as history and a re-hire is a NEW row.
//
// `end` demands a reason, enforced by the service, for the same reason ADR-077
// demands one when withdrawing access: the record has to say why, or the
// evidence is a date with no author's intent attached.
//
// None of these touch Membership. Ending employment does not revoke access —
// an owner who wants both performs both, each separately audited (BR-034).
// @spec ADR-078 D1, BR-034, SDD-093, ADR-017, SEC-008
// @tested tests/integration/fr193-employment-write-path.test.js

export const dynamic = 'force-dynamic'

const TRANSITIONS = {
  on_leave: (id, ctx) => setEmploymentOnLeave(id, ctx),
  reinstate: (id, ctx) => reinstateEmployment(id, ctx),
  end: (id, ctx, body) => endEmployment(id, { ...ctx, reason: body.reason, ...(body.endAt ? { endAt: body.endAt } : {}) }),
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const { employmentId } = await params
    const body = await request.json()
    const transition = TRANSITIONS[body.action]
    // Named actions only. An unknown one is a 400 rather than a silent no-op,
    // so a typo in a caller fails loudly instead of appearing to succeed.
    if (!transition) {
      throw httpError(400, `Unknown employment action: ${body.action ?? '(missing)'}`)
    }
    return transition(employmentId, { viewer }, body)
  })
}
