import { handle, queryParams } from '../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  createPhase1Integration,
  listPhase1Integrations,
} from '@/modules/integration/application/integration-management-service'

// @req FR-080 — Platform Integration metadata is served through the trusted
// viewer boundary and never returns raw secret material.
// @spec ADR-032 D1-D3, SEC-016, SDD-044
// @tested tests/unit/fr080-ui-contract.test.js, tests/unit/fr080-integration-management.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(() => listPhase1Integrations({
    businessId: queryParams(request).businessId || null,
    resolve: () => resolveRequestViewer(request),
  }))
}

export async function POST(request) {
  return handle(async () => createPhase1Integration(await request.json(), {
    resolve: () => resolveRequestViewer(request),
  }))
}
