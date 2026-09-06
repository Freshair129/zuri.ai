import { handle, queryParams } from '../../_helpers'
import {
  getProjectsDashboard,
  parseProjectsDashboardQuery,
} from '@/modules/project-manager/application/projects-dashboard-read-model'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

// @req FR-086 — the Projects Dashboard read endpoint: the KPI band, the enriched
// list and the Top-5-by-priority panel in one authorized response.
// @spec SDD-047, ADR-036, SEC-001
// @tested tests/integration/projects-dashboard.test.js
//
// Additive, and deliberately a sibling rather than a `view=` mode on
// `/api/projects`: SDD-047 says the existing list contract stays untouched so
// its consumers do not move
// (`.brain/rca/2026-08-18-project-list-envelope-broke-relation-consumers.md`).
//
// The viewer is resolved BEFORE the query is even read, and the read model
// authorizes the scope before composing anything — so an unauthenticated or
// out-of-scope request is refused rather than answered with a filtered page.

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = parseProjectsDashboardQuery(queryParams(request))
    return getProjectsDashboard({ viewer, ...query })
  })
}
