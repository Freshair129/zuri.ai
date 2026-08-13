// @req FR-038 — current profile is resolved through the same viewer gate as shell access.
// @spec SDD-017, docs/features/FR-038-profile-and-permissions.md
// @tested tests/unit/profile-permission-service.test.js
import { handle } from '../_helpers'
import { getMyProfile } from '@/modules/identity/profile-permission-service'

export const dynamic = 'force-dynamic'

export async function GET() {
  return handle(() => getMyProfile())
}
