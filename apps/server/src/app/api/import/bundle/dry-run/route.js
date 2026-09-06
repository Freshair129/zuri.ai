// @req FR-108 — validate an ExecutionPlanBundle and preview the combined
// programme changes; read-only, and authorized identically to the commit
// (ADR-049 D5: previewing a scope you were not given is the same leak as
// writing to it — the FR-065 precedent, one package level up).
// @spec ADR-049, SDD-056, SEC-001, SEC-002, SEC-008
// @tested tests/integration/execution-plan-bundle.test.js
//
// Thin transport only (SDD-056): the trusted viewer is resolved FIRST —
// session, or a Tenant-bound `apik_` Enterprise API key ahead of the session
// seam (FR-106), exactly as the per-Project import routes do — and every
// decision lives in the bundle orchestrator, which refuses before parsing
// anything beyond the scope selector.
import { handle } from '../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveApiAccessViewer } from '@/modules/identity/api-access-auth'
import { dryRunBundle } from '@/modules/project-manager/import/bundle/bundle-dry-run'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = (await resolveApiAccessViewer(request)) ?? await resolveRequestViewer(request)
    const body = await request.json()
    return dryRunBundle(body.bundle, { viewer })
  })
}
