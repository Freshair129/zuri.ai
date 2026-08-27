// @req FR-108 — commit a confirmed ExecutionPlanBundle: one transaction over
// strategy + N Projects + cross-Project dependencies, with an idempotent
// bundle receipt (ADR-049 D7/D8/D9). Calling this endpoint is the single
// explicit confirmation; the orchestrator re-runs the combined dry-run and
// refuses on any conflict.
// @spec ADR-049, SDD-056, BR-007, BR-009, SEC-001, SEC-002
// @tested tests/integration/execution-plan-bundle.test.js
//
// Thin transport only (SDD-056): viewer resolved FIRST (session, or the
// FR-106 `apik_` key ahead of the session seam, as on the per-Project import
// routes); all authorization and write decisions live in the orchestrator.
import { handle } from '../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveApiAccessViewer } from '@/modules/identity/api-access-auth'
import { commitBundle } from '@/modules/project-manager/import/bundle/bundle-commit-service'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = (await resolveApiAccessViewer(request)) ?? await resolveRequestViewer(request)
    const body = await request.json()
    return commitBundle(body.bundle, { viewer })
  })
}
