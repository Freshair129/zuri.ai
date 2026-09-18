import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  resolveRequestViewerForFeatureMutation,
  ProjectFeatureMutationError,
  replaceProjectFeatureRequirementBindings,
  toPublicProjectFeatureMutationError,
  mutationResponseHeaders,
  zMutationError,
} from '@/modules/project-manager/application/project-feature-service'

// @req FR-252 — requirement bindings are replaced only when an in-scope VALID
// snapshot and a server-provided immutable revision proof are available.
// @spec ADR-097, docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md, docs/architecture/project-manager-system/27-PHASE-B-COMMIT-PROVENANCE-CONTRACT.md
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
    const result = await replaceProjectFeatureRequirementBindings(projectId, featureId, () => readJson(request), {
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
