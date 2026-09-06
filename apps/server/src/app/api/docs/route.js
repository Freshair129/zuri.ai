import { NextResponse } from 'next/server'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveApiAccessViewer } from '@/modules/identity/api-access-auth'
import { buildOpenApiDocument } from '@/modules/project-manager/api-docs/openapi'

export const dynamic = 'force-dynamic'

// @req FR-019 — machine-readable API contract, generated from the live Zod
// schemas on every request so it can never fall behind the validation.
// @req FR-106 — a non-loopback request may now authenticate with an Enterprise
// API access key (any Tenant's — the contract carries no tenant data) instead
// of a session, so an integrator can fetch the spec with the same credential
// they call the API with; an invalid or revoked key falls through to the
// session seam and gets the identical refusal an unauthenticated caller gets.
// @spec SEC-006 — exact loopback hosts may fetch the local contract without a
// session; every non-loopback request must resolve a trusted identity (ADR-003).
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(hostname.replace(/^\[|\]$/g, ''))
}

export async function GET(request) {
  const url = new URL(request.url)
  if (!isLoopbackHost(url.hostname)) {
    const keyViewer = await resolveApiAccessViewer(request)
    if (!keyViewer) {
      try {
        await resolveRequestViewer(request)
      } catch (error) {
        return NextResponse.json(
          { error: error?.message || 'AUTH_REQUIRED' },
          { status: Number(error?.status) || 500 },
        )
      }
    }
  }

  const doc = buildOpenApiDocument({ serverUrl: url.origin })
  return NextResponse.json(doc, {
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' },
  })
}
