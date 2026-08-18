import { handle, httpError } from '../../_helpers'
import { computePortfolioProgress } from '@/modules/project-manager/application/progress-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { isInstallationOperator } from '@/modules/identity/viewer-authority'

export const dynamic = 'force-dynamic'

// @req FR-020 — group landing data: one health card per business + group-level work.
// @tested tests/integration/adaptive-shell.test.js
// @tested tests/unit/authorization-seam-routes.test.js
export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    if (!isInstallationOperator(viewer)) {
      throw httpError(403, 'Portfolio progress reporting is an installation-wide read and requires operator authority')
    }
    return computePortfolioProgress()
  })
}
