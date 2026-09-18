import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  listProjectFeatures,
  toPublicFeatureReadError,
} from '@/modules/project-manager/application/project-feature-read-model'
import {
  resolveRequestViewerForFeatureMutation,
  createProjectFeature,
  ProjectFeatureMutationError,
  toPublicProjectFeatureMutationError,
  mutationResponseHeaders,
  zMutationError,
} from '@/modules/project-manager/application/project-feature-service'

// @req FR-252 — bounded Project Feature collection reads preserve explicit
// lifecycle/tombstone visibility and signed scope-bound cursors.
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
    const { id: projectId } = await Promise.resolve(params)
    const viewer = await resolveRequestViewer(request)
    const result = await listProjectFeatures(projectId, {
      viewer,
      query: new URL(request.url).searchParams,
    })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return refusal(error)
  }
}

// @req FR-252 — owner-authorized creation of one Project-local Feature draft
// uses the shared locked mutation, audit and receipt pipeline.
// @spec ADR-097, docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md
// @tested tests/integration/project-feature-mutations.test.js
export async function POST(request, { params }) {
  const { id: projectId } = await Promise.resolve(params)
  return runMutationRequest(request, async ({ viewer, session, requestId, sessionId, idempotencyKey }) => createProjectFeature(
    projectId,
    () => readJson(request),
    { viewer, session, requestId, sessionId, idempotencyKey },
  ))
}
