// @req FR-037 — Project Files list/create route.
// @spec SDD-016, SEC-003, docs/features/FR-037-project-files.md
// @tested tests/unit/project-file-service.test.js
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr072-project-file-authorization.test.js
import { handle } from '../../../_helpers'
import { createProjectFile, listProjectFiles } from '@/modules/project-manager/application/project-file-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(() => listProjectFiles(params.id))
}

export async function POST(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return createProjectFile(params.id, await request.json(), { viewer })
  })
}
