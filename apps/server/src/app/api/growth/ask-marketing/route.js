import prisma from '@/lib/db'
import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { askMarketing } from '@/modules/marketing/application/marketing-insights-service'

// @req FR-185 — deterministic, read-only AskMarketing owner projection.
// @spec SDD-086, SEC-001, SEC-003
// @tested tests/unit/marketing/marketing-insights-route.test.js

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return askMarketing(await request.json(), { viewer, db: prisma })
  })
}

