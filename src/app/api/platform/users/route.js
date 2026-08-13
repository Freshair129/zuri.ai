// @req FR-038 — owner-only Membership role/domain permission administration.
// @spec SDD-017, SEC-003, docs/features/FR-038-profile-and-permissions.md
// @tested tests/unit/profile-permission-service.test.js
import { handle } from '../../_helpers'
import { listUserPermissions, updateUserPermissions } from '@/modules/identity/profile-permission-service'
// @req FR-046 — platform permission identity comes from the trusted request session.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-api-ui-contract.test.js
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(() => listUserPermissions({ resolve: () => resolveRequestViewer(request) }))
}

export async function PATCH(request) {
  return handle(async () => updateUserPermissions(await request.json(), {
    resolve: () => resolveRequestViewer(request),
  }))
}
