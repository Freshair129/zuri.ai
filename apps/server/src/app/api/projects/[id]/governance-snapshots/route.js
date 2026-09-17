import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  listProjectGovernanceSnapshots,
  toPublicFeatureReadError,
} from '@/modules/project-manager/application/project-feature-read-model'
import {
  resolveRequestViewerForFeatureMutation,
  ProjectFeatureMutationError,
  mutationResponseHeaders,
  toPublicProjectFeatureMutationError,
  zMutationError,
} from '@/modules/project-manager/application/project-feature-service'
import {
  captureGovernanceSnapshot,
  toPublicGovernanceSnapshotError,
  zSnapshotCaptureResult,
} from '@/modules/project-manager/application/governance-snapshot-service'

// @req FR-252 — governance snapshot metadata is a bounded owner-capability
// read; source manifests, proof payloads and mutation receipts stay private.
// @spec ADR-097, docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md
// @tested tests/integration/project-feature-read-routes.test.js, tests/integration/governance-snapshot-capture.test.js

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
  const safe = toPublicGovernanceSnapshotError(error) || toPublicProjectFeatureMutationError(error)
  const publicError = { ...safe }
  delete publicError.status
  const body = zMutationError.parse({ ...publicError, requestId })
  return NextResponse.json(body, {
    status: safe.status,
    headers: { 'X-Request-ID': requestId, 'Cache-Control': 'no-store' },
  })
}

function header(request, name) {
  return typeof request?.headers?.get === 'function' ? request.headers.get(name) : null
}

async function readJson(request) {
  try {
    return await request.json()
  } catch {
    throw new ProjectFeatureMutationError('MALFORMED_REQUEST', 400)
  }
}

export async function GET(request, { params }) {
  try {
    const { id: projectId } = await Promise.resolve(params)
    const viewer = await resolveRequestViewer(request)
    const result = await listProjectGovernanceSnapshots(projectId, {
      viewer,
      query: new URL(request.url).searchParams,
    })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return refusal(error)
  }
}

// @req FR-252 — owner-authorized capture persists only a server-verified
// GovernanceSnapshot and its scoped mutation receipt.
// @spec ADR-097, docs/architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md, docs/architecture/project-manager-system/27-PHASE-B-COMMIT-PROVENANCE-CONTRACT.md
// @tested tests/integration/governance-snapshot-capture.test.js
export async function POST(request, { params }) {
  const requestId = randomUUID()
  try {
    const { id: projectId } = await Promise.resolve(params)
    const { viewer, session } = await resolveRequestViewerForFeatureMutation(request)
    const result = await captureGovernanceSnapshot(projectId, () => readJson(request), {
      viewer,
      requestId,
      sessionId: session?.sessionId ?? null,
      session,
      idempotencyKey: header(request, 'idempotency-key'),
    })
    const body = zSnapshotCaptureResult.parse({ snapshot: result.snapshot, receipt: result.receipt })
    return NextResponse.json(body, {
      status: result.httpStatus,
      headers: mutationResponseHeaders(result.receipt, requestId),
    })
  } catch (error) {
    return mutationRefusal(error, requestId)
  }
}
