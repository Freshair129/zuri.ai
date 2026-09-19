import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getProjectDomainView } from '@/modules/project-manager/application/project-domain-read-model'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

// @req FR-251 — authorized Project Execution Domains read surface.
// @spec FR-070, SDD-039, ADR-025
// @tested tests/integration/project-domain-view.test.js

export const dynamic = 'force-dynamic'

function typedError(status, code, message, retryable) {
  const requestId = randomUUID()
  return NextResponse.json(
    { code, message, requestId, retryable },
    { status, headers: { 'X-Request-ID': requestId } },
  )
}

function refusal(error) {
  if (error?.status === 401 || error?.message === 'AUTH_REQUIRED') {
    return typedError(401, 'AUTH_REQUIRED', 'Authentication is required.', false)
  }
  if (error?.status === 404 || error?.message === 'Project not found') {
    return typedError(404, 'RESOURCE_NOT_FOUND', 'Resource not found.', false)
  }
  if (error?.status === 503) {
    return typedError(503, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable.', true)
  }
  return typedError(500, 'INTERNAL_ERROR', 'Internal server error.', false)
}

export async function GET(request, { params }) {
  try {
    const viewer = await resolveRequestViewer(request)
    const result = await getProjectDomainView(params.id, { viewer })
    return NextResponse.json(result)
  } catch (error) {
    // This route owns the candidate's typed refusal contract. The shared
    // `handle` helper still serves legacy routes whose body is `{ error }`;
    // using it here would leak that incompatible shape and internal messages.
    return refusal(error)
  }
}
