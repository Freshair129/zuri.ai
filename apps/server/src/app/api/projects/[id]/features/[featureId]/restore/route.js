import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  resolveRequestViewerForFeatureMutation,
  restoreProjectFeature,
  toPublicProjectFeatureMutationError,
  mutationResponseHeaders,
  zMutationError,
} from '@/modules/project-manager/application/project-feature-service'

// @req FR-252 — restore revives only the exact Feature deletion cohort under
// CAS, capacity and allocation checks, preserving immutable child identities.
// @spec ADR-097, docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md, docs/architecture/project-manager-system/26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md
// @tested tests/integration/project-feature-mutations.test.js

export const dynamic = 'force-dynamic'

function header(request, name) {
  return typeof request?.headers?.get === 'function' ? request.headers.get(name) : null
}

function refusal(error, requestId) {
  const safe = toPublicProjectFeatureMutationError(error)
  const publicError = { ...safe }
  delete publicError.status
  const body = zMutationError.parse({ ...publicError, requestId })
  return NextResponse.json(body, {
    status: safe.status,
    headers: { 'X-Request-ID': requestId, 'Cache-Control': 'no-store' },
  })
}

export async function POST(request, { params }) {
  const { id: projectId, featureId } = await Promise.resolve(params)
  const requestId = randomUUID()
  try {
    const { viewer, session } = await resolveRequestViewerForFeatureMutation(request)
    const result = await restoreProjectFeature(projectId, featureId, {
      viewer,
      session,
      requestId,
      sessionId: session?.sessionId ?? null,
      idempotencyKey: header(request, 'idempotency-key'),
      ifMatch: header(request, 'if-match'),
    })
    return NextResponse.json(result.receipt, {
      status: result.httpStatus,
      headers: mutationResponseHeaders(result.receipt, requestId),
    })
  } catch (error) {
    return refusal(error, requestId)
  }
}
