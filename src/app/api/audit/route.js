// @req FR-014 — list immutable audit events filtered by entity type or id
// @req FR-046 — audit is an installation-wide read and resolves the trusted
// request viewer before touching the audit stream.
// @spec SEC-008, FR-075
// @tested tests/unit/authorization-seam-routes.test.js
import { handle, httpError, queryParams } from '../_helpers'
import prisma from '@/lib/db'
import { listAudit } from '@/modules/project-manager/application/audit'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { isInstallationOperator } from '@/modules/identity/viewer-authority'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    if (!isInstallationOperator(viewer)) {
      throw httpError(403, 'Audit events are an installation-wide read and require operator authority')
    }
    const q = queryParams(request)
    return listAudit(prisma, {
      entityType: q.entityType || undefined,
      entityId: q.entityId || undefined,
      limit: q.limit ? Number(q.limit) : 100,
    })
  })
}
