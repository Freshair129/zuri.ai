import { NextResponse } from 'next/server'
import { buildOpenApiDocument } from '@/modules/project-manager/api-docs/openapi'

export const dynamic = 'force-dynamic'

// @req FR-019 — machine-readable API contract, generated from the live Zod
// schemas on every request so it can never fall behind the validation.
// @spec SEC-006 — this surface is unauthenticated in the MVP; per-tenant token
// auth is required before it is exposed outside localhost (ADR-003).
// @tested tests/integration/openapi-docs.test.js
export async function GET(request) {
  const url = new URL(request.url)
  const doc = buildOpenApiDocument({ serverUrl: url.origin })
  return NextResponse.json(doc, {
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' },
  })
}
