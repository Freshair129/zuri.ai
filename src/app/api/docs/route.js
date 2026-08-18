import { NextResponse } from 'next/server'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { buildOpenApiDocument } from '@/modules/project-manager/api-docs/openapi'

export const dynamic = 'force-dynamic'

// @req FR-019 — machine-readable API contract, generated from the live Zod
// schemas on every request so it can never fall behind the validation.
// @spec SEC-006 — exact loopback hosts may fetch the local contract without a
// session; every non-loopback request must resolve the trusted viewer (ADR-003).
// @tested tests/integration/openapi-docs.test.js
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(hostname.replace(/^\[|\]$/g, ''))
}

export async function GET(request) {
  const url = new URL(request.url)
  if (!isLoopbackHost(url.hostname)) {
    try {
      await resolveRequestViewer(request)
    } catch (error) {
      return NextResponse.json(
        { error: error?.message || 'AUTH_REQUIRED' },
        { status: Number(error?.status) || 500 },
      )
    }
  }

  const doc = buildOpenApiDocument({ serverUrl: url.origin })
  return NextResponse.json(doc, {
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' },
  })
}
