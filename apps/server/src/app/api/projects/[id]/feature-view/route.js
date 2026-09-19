import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  getProjectFeatureViewResponse,
  toPublicFeatureReadError,
} from '@/modules/project-manager/application/project-feature-read-model'

// @req FR-252 — the Project Feature view reads explicit Feature authority
// after full hierarchy proof and exposes no mutation or inferred Feature data.
// @spec ADR-097, docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md
// @tested tests/integration/project-feature-read-routes.test.js

export const dynamic = 'force-dynamic'

function refusal(error) {
  const safe = toPublicFeatureReadError(error)
  const requestId = randomUUID()
  return NextResponse.json(
    { code: safe.code, message: safe.message, requestId, retryable: safe.retryable },
    {
      status: safe.status,
      headers: { 'X-Request-ID': requestId, 'Cache-Control': 'no-store' },
    },
  )
}

export async function GET(request, { params }) {
  try {
    const { id: projectId } = await Promise.resolve(params)
    const viewer = await resolveRequestViewer(request)
    const result = await getProjectFeatureViewResponse(projectId, { viewer })
    return NextResponse.json(result.view, {
      headers: { 'Cache-Control': 'no-store', ...(result.graphEtag ? { ETag: result.graphEtag } : {}) },
    })
  } catch (error) {
    return refusal(error)
  }
}
