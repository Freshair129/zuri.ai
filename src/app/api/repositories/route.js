// @req FR-008 — repository records and many-to-many project links: list and create
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-073 — a Repository is owned by a Business; the list is scoped to what
// the viewer may see and the create is refused unless they own the Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr073-repository-scope.test.js
import { handle } from '../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listRepositories, createRepository } from '@/modules/project-manager/application/repository-service'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => listRepositories({ viewer: await resolveRequestViewer(request) }))
}

export async function POST(request) {
  return handle(async () => {
    // Resolved before the body is read, so an unauthenticated caller learns
    // nothing — not even whether their payload parses.
    const viewer = await resolveRequestViewer(request)
    return createRepository(await request.json(), { viewer })
  })
}
