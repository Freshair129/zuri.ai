import { handle } from '@/app/api/_helpers'
// @req FR-046 — platform permission identity comes from the trusted request session.
// @spec ADR-017, SDD-024, SEC-008
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  suspendMembership,
  reinstateMembership,
  revokeMembership,
} from '@/modules/identity/membership-lifecycle-service'

// @req FR-191 — the withdrawal half of a grant's life, which had no surface at
//   all: `membership.update` existed twice in the repository and neither call
//   wrote `status`, so an owner who needed to remove someone's access had to ask
//   for SQL against production
//   (.brain/rca/2026-09-12-a-grant-that-cannot-be-withdrawn.md).
//
//   One route taking an `action` rather than three routes, because the three
//   share their authority check, their last-owner guard, their cascade to
//   dependent role bindings and their refusal vocabulary. Splitting them would
//   be three copies of one decision, which is how two rules for one row start to
//   disagree.
//
//   Refusals: 404 both for a scope the caller does not own and for a membership
//   that does not exist, byte-identical (SEC-001 — the pair must be
//   indistinguishable or the route is an id oracle); 409 `LAST_OWNER`,
//   `ALREADY_*` and `REVOKED_IS_TERMINAL` once authority is proven; 400
//   `REASON_REQUIRED` from the schema.
// @spec ADR-077 D2, BR-033, SEC-001, SEC-003
// @tested tests/integration/fr191-access-grant-lifecycle.test.js

export const dynamic = 'force-dynamic'

const ACTIONS = {
  SUSPEND: suspendMembership,
  REINSTATE: reinstateMembership,
  REVOKE: revokeMembership,
}

export async function POST(request, { params }) {
  return handle(async () => {
    const body = await request.json().catch(() => ({}))
    const run = ACTIONS[String(body?.action || '').toUpperCase()]
    if (!run) {
      const error = new Error('UNKNOWN_ACTION')
      error.status = 400
      throw error
    }
    // `membershipId` comes from the path, never the body — a body that could
    // name a different row than the URL is a route with two answers to "which
    // grant is this".
    return run(
      { ...body, membershipId: params.id },
      { resolve: () => resolveRequestViewer(request) },
    )
  })
}
