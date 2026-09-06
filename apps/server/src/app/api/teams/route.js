// @req FR-089 — Team as an organisational grouping: list the Teams of one
// Business, and create one inside a Business the viewer owns.
// @req FR-046 — every request resolves one trusted viewer and fails closed.
// @spec BR-018, SEC-001, SEC-008,
//   docs/decisions/ADR-037-TEAM-IS-AN-ORGANISATIONAL-GROUPING-NOT-AN-AUTHORITY.md
// @tested tests/integration/fr089-team-scope.test.js
//
// Thin on purpose: the handler resolves a viewer and delegates. Every scope
// decision, every refusal message and the audit event live in the service, so
// there is no second place where a Team could be written without them.
import { handle, queryParams } from '../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createTeam, listTeams } from '@/modules/project-manager/application/team-service'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    // `businessId` is required by the service, not defaulted here: a list with
    // no scope is the shape that returned other tenants' rows on 2026-08-17.
    return listTeams(queryParams(request), { viewer })
  })
}

export async function POST(request) {
  return handle(async () => {
    // Resolved before the body is read, so an unauthenticated caller learns
    // nothing — not even whether their payload parses.
    const viewer = await resolveRequestViewer(request)
    return createTeam(await request.json(), { viewer })
  })
}
