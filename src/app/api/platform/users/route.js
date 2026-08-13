// @req FR-038 — owner-only Membership role/domain permission administration.
// @spec SDD-017, SEC-003, docs/features/FR-038-profile-and-permissions.md
// @tested tests/unit/profile-permission-service.test.js
import { handle } from '../../_helpers'
import { listUserPermissions, updateUserPermissions } from '@/modules/identity/profile-permission-service'

export const dynamic = 'force-dynamic'

export async function GET() {
  return handle(() => listUserPermissions())
}

export async function PATCH(request) {
  return handle(async () => updateUserPermissions(await request.json()))
}
