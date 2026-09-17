import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  getProjectFeature,
  toPublicFeatureReadError,
} from '@/modules/project-manager/application/project-feature-read-model'
import {
  resolveRequestViewerForFeatureMutation,
  deleteProjectFeature,
  ProjectFeatureMutationError,
  toPublicProjectFeatureMutationError,
  mutationResponseHeaders,
  updateProjectFeature,
  zMutationError,
} from '@/modules/project-manager/application/project-feature-service'

// @req FR-252 — a Feature detail read returns only the explicit ProjectFeature
// relationship and validated child records in the requested Project scope.
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

function mutationRefusal(error, requestId) {
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

function header(request, name) {
  return typeof request?.headers?.get === 'function' ? request.headers.get(name) : null
}

async function runMutationRequest(request, callback) {
  const requestId = randomUUID()
  try {
    const { viewer, session } = await resolveRequestViewerForFeatureMutation(request)
    const result = await callback({
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
    return mutationRefusal(error, requestId)
  }
}

export async function GET(request, { params }) {
  try {
    const { id: projectId, featureId } = await Promise.resolve(params)
    const viewer = await resolveRequestViewer(request)
    const result = await getProjectFeature(projectId, featureId, { viewer })
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store',
        ETag: `"PROJECT_FEATURE/${result.id}/v${result.version}"`,
      },
    })
  } catch (error) {
    return refusal(error)
  }
}

// @req FR-252 — owner-authorized Feature mutation uses strong ETag CAS and the
// shared transaction, audit and receipt pipeline.
// @spec ADR-097, docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md
// @tested tests/integration/project-feature-mutations.test.js
export async function PATCH(request, { params }) {
  const { id: projectId, featureId } = await Promise.resolve(params)
  return runMutationRequest(request, async ({ viewer, session, requestId, sessionId, idempotencyKey, ifMatch }) => updateProjectFeature(
    projectId,
    featureId,
    () => readJson(request),
    { viewer, session, requestId, sessionId, idempotencyKey, ifMatch },
  ))
}

// @req FR-252 — soft deletion preserves the Feature UUID and relationship
// deletion cohort for an atomic, CAS-protected restore.
// @spec ADR-097, docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md, docs/architecture/project-manager-system/26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md
// @tested tests/integration/project-feature-mutations.test.js
export async function DELETE(request, { params }) {
  const { id: projectId, featureId } = await Promise.resolve(params)
  return runMutationRequest(request, async ({ viewer, session, requestId, sessionId, idempotencyKey, ifMatch }) => deleteProjectFeature(
    projectId,
    featureId,
    { viewer, session, requestId, sessionId, idempotencyKey, ifMatch },
  ))
}
