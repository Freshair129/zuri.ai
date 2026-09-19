// @req FR-014 — list immutable audit events filtered by entity type or id
// @req FR-046 — audit is an installation-wide read and resolves the trusted
// request viewer before touching the audit stream.
// @spec SEC-008, FR-075
// @tested tests/unit/authorization-seam-routes.test.js
import { handle, queryParams } from '../_helpers'
import prisma from '@/lib/db'
import { listAudit } from '@/modules/project-manager/application/audit'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { assertOperatorAndRecordUse } from '@/modules/identity/operator-use'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const q = queryParams(request)
    // @req FR-197 — reading the audit stream is itself an operator action
    // (ADR-017 D6, read as covering operator reads — ADR-079); recorded before
    // the read runs, never after, so a denied attempt writes nothing.
    await assertOperatorAndRecordUse(viewer, {
      action: 'AUDIT_READ',
      deniedMessage: 'Audit events are an installation-wide read and require operator authority',
      payload: { entityType: q.entityType || null, entityId: q.entityId || null },
    })
    return listAudit(prisma, {
      entityType: q.entityType || undefined,
      entityId: q.entityId || undefined,
      limit: q.limit ? Number(q.limit) : 100,
      // The filter's options come from the log itself. A hand-kept list on the
      // page offered 15 of the 57 entityTypes this codebase writes, so four of
      // the seven types actually present in production could not be filtered
      // for at all — including PERSON, the second most common.
      withEntityTypes: true,
    })
  })
}
