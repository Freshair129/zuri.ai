// @req FR-005 — list or create work items in the neutral WorkContainer/WorkItem model
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr072-work-service-authorization.test.js
// @req FR-046 — a work list resolves a trusted viewer and requires a Project
// or Workstream scope before the unscoped compatibility read runs.
// @tested tests/unit/authorization-seam-routes.test.js
import { handle, httpError, queryParams } from '../_helpers'
import { listWork, createItem } from '@/modules/project-manager/application/work-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { isInstallationOperator } from '@/modules/identity/viewer-authority'
import {
  assertProjectVisibleForWorkRead,
  assertWorkstreamVisibleForWorkRead,
} from '@/modules/project-manager/application/work-read-service'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const q = queryParams(request)
    if (q.projectId) await assertProjectVisibleForWorkRead(q.projectId, viewer)
    if (q.workstreamId) await assertWorkstreamVisibleForWorkRead(q.workstreamId, viewer)
    const allowedBusinessIds = q.businessId
      ? [q.businessId]
      : (isInstallationOperator(viewer)
          ? undefined
          : (viewer.visibleBusinessIds?.length ? viewer.visibleBusinessIds : undefined))
    if (!q.projectId && !q.workstreamId && !isInstallationOperator(viewer) && !allowedBusinessIds) {
      throw httpError(403, 'A Project or Workstream scope is required')
    }
    return listWork({
      workstreamId: q.workstreamId || undefined,
      projectId: q.projectId || undefined,
      executionMode: q.executionMode || undefined,
      subtype: q.subtype || undefined,
      status: q.status || undefined,
      q: q.q || undefined,
      businessIds: allowedBusinessIds,
    })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return createItem(await request.json(), { viewer })
  })
}
