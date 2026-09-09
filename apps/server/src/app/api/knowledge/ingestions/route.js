import { handle, queryParams } from '../../_helpers'
import { resolveKnowledgeRequestViewer as resolveRequestViewer } from '@/modules/knowledge/knowledge-http'
import {
  admitKnowledge,
  listKnowledgeIngestions,
} from '@/modules/knowledge/knowledge-admission-service'

// @req FR-173 — Files/API admission and scoped ingestion status use the same
// durable knowledge service and explicit viewer/API grant.
// @spec ADR-072, SEC-001, SEC-006, SEC-008
// @tested tests/unit/knowledge-admission-routes.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const params = queryParams(request)
    const viewer = await resolveRequestViewer(request)
    return listKnowledgeIngestions({
      businessId: params.businessId,
      projectId: params.projectId || null,
      limit: params.limit === undefined ? undefined : Number(params.limit),
    }, { viewer })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json()
    return admitKnowledge(body, { viewer })
  })
}
