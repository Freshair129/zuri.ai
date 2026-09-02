// @req FR-045 - explicit dry-run/confirm ProjectFile migration.
// @spec SDD-023, ADR-016 D4, ZV2-CR-001
// @tested tests/unit/fr045-file-asset-service.test.js
import { handle } from '../../_helpers'
// @req FR-046 — protected API identity comes from the trusted request session.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-api-ui-contract.test.js
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { migrateProjectFiles } from '@/modules/project-manager/application/file-asset-service'

// @req FR-072, FR-075 — this is a global, cross-tenant operation (every
// Business's legacy ProjectFile rows, not one the caller owns), so the
// authority it requires is the installation operator, not the per-principal
// `role` label this route used to check (`['OWNER', 'DEV'].includes(role)`
// admitted every DEV, who resolveViewer never lets own a Business, and any
// OWNER anywhere, not just one who administers the installation). The check
// itself lives in `migrateProjectFiles` beside the other FR-072 predicates in
// `project-authorization.js`, refusing 404-shaped like they do.
// @spec ADR-016 D10, SEC-001, SEC-008
// @tested tests/integration/fr072-files-migrate-authorization.test.js

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json()
    return migrateProjectFiles({ confirm: body.confirm === true }, { viewer })
  })
}
