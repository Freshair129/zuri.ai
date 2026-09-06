import prisma from '@/lib/db'
import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  getMarketingOperationsIntake,
  updateMarketingOperationsIntake,
} from '@/modules/marketing/application/marketing-operations-service'
import { zMarketingOperationsActionInput } from '@/modules/marketing/domain/marketing-operations-contract'

// @req FR-161 — Intake detail revalidates both the requested UUID and the
// active Business scope before returning or mutating the row.
// @spec SDD-089, SEC-001, SEC-003
// @tested tests/unit/marketing/marketing-operations-route.test.js,
//   tests/integration/marketing-operations.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const { businessId } = queryParams(request)
    return getMarketingOperationsIntake(params?.intakeId, { businessId, viewer }, { db: prisma })
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const input = zMarketingOperationsActionInput.parse(await request.json())
    return updateMarketingOperationsIntake(params?.intakeId, input, { viewer }, { db: prisma })
  })
}
