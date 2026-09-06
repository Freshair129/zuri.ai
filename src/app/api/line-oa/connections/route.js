import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { provisionLineServerConnection } from '@/modules/integration/application/line-server-provisioning-service'

// @req FR-149 — owner-only LINE connection provisioning without browser secret entry.
// @spec ADR-061, SEC-001, SEC-016
// @tested tests/integration/fr149-line-server-configuration.test.js
export const dynamic = 'force-dynamic'
export async function POST(request) {
  return handle(async () => provisionLineServerConnection(await request.json(), { viewer: await resolveRequestViewer(request) }))
}
