// @req FR-037 — Project Files list/create route.
// @spec SDD-016, SEC-003, docs/features/FR-037-project-files.md
// @tested tests/unit/project-file-service.test.js
import { handle } from '../../../_helpers'
import { createProjectFile, listProjectFiles } from '@/modules/project-manager/application/project-file-service'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(() => listProjectFiles(params.id))
}

export async function POST(request, { params }) {
  return handle(async () => createProjectFile(params.id, await request.json()))
}
