// @req FR-038 — current profile is resolved through the same viewer gate as shell access.
// @spec SDD-017, docs/features/FR-038-profile-and-permissions.md
// @tested tests/unit/profile-permission-service.test.js
import { handle } from '../_helpers'
import { getMyProfile } from '@/modules/identity/profile-permission-service'
// @req FR-046 — profile identity comes from the trusted request session.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-api-ui-contract.test.js
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(() => getMyProfile({ resolve: () => resolveRequestViewer(request) }))
}
