// @req FR-007 — list or create dependencies with self/cycle rejection and blocked evaluation
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr072-dependency-authorization.test.js
import { handle, queryParams } from '../_helpers'
import { listDependencies, createDependency } from '@/modules/project-manager/application/dependency-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const q = queryParams(request)
  return handle(() => listDependencies({ projectId: q.projectId || undefined }))
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return createDependency(await request.json(), { viewer })
  })
}
