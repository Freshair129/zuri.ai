// @req FR-014 — list immutable audit events filtered by entity type or id
import { handle, queryParams } from '../_helpers'
import prisma from '@/lib/db'
import { listAudit } from '@/modules/project-manager/application/audit'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const q = queryParams(request)
  return handle(() =>
    listAudit(prisma, {
      entityType: q.entityType || undefined,
      entityId: q.entityId || undefined,
      limit: q.limit ? Number(q.limit) : 100,
    })
  )
}
