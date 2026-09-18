import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  resolveRequestViewerForFeatureMutation,
  ProjectFeatureMutationError,
  replaceProjectFeatureWorkLinks,
  toPublicProjectFeatureMutationError,
  mutationResponseHeaders,
  zMutationError,
} from '@/modules/project-manager/application/project-feature-service'

// @req FR-252 — a complete WorkItem link replacement validates the whole
// per-WorkItem allocation in the locked Project scope without writing progress.
// @spec ADR-097, docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md
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

async function readJson(request) {
  try {
    return await request.json()
  } catch {
    throw new ProjectFeatureMutationError('MALFORMED_REQUEST', 400)
  }
}

export async function PUT(request, { params }) {
  const { id: projectId, featureId } = await Promise.resolve(params)
  const requestId = randomUUID()
  try {
    const { viewer, session } = await resolveRequestViewerForFeatureMutation(request)
    const result = await replaceProjectFeatureWorkLinks(projectId, featureId, () => readJson(request), {
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
