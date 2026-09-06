import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createSalesTask, listSalesTasks } from '@/modules/crm/sales-task-service'

// @req FR-161 — sales tasks of one Business: the follow-ups a salesperson
//   owes customers. GET lists open ones (closed on request) with the due
//   state recomputed against today and the dashboard summary; filters:
//   `status`, `assigneePersonId` (or `me`), `customerId`, `conversationId`,
//   `due` (OVERDUE / TODAY / UPCOMING). POST creates one under Business OWNER
//   or SALES_REP authority. Both need the `customer` domain (FR-061); a viewer
//   without it gets the FR-072 404. `businessId` is a selector the service
//   validates against the trusted viewer, never the scope.
// @spec ADR-064; BR-001; SEC-001; BR-012
// @tested tests/unit/sales-task-routes.test.js, tests/integration/fr161-sales-task.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const q = queryParams(request)
    return listSalesTasks({
      businessId: q?.businessId,
      ...(q?.status ? { status: q.status } : {}),
      ...(q?.assigneePersonId ? { assigneePersonId: q.assigneePersonId } : {}),
      ...(q?.customerId ? { customerId: q.customerId } : {}),
      ...(q?.conversationId ? { conversationId: q.conversationId } : {}),
      ...(q?.due ? { due: q.due } : {}),
      ...(q?.includeClosed === 'true' ? { includeClosed: true } : {}),
      ...(q?.limit ? { limit: Number(q.limit) } : {}),
    }, { viewer })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return createSalesTask(body, { viewer })
  })
}
