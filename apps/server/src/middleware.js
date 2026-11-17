import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { evaluateSameOriginWrite } from './modules/identity/same-origin-write.js'

// @req FR-252 — apply a uniform Origin check to every API write route.
// @spec ADR-097
// @tested tests/unit/identity/same-origin-write.test.js, tests/unit/identity/write-route-coverage.test.js

export function middleware(request) {
  const result = evaluateSameOriginWrite({
    method: request.method,
    pathname: request.nextUrl.pathname,
    headers: request.headers,
    env: process.env,
  })
  if (result.allowed) return NextResponse.next()

  const requestId = randomUUID()
  return NextResponse.json({
    code: 'CSRF_INVALID',
    message: 'CSRF validation failed.',
    requestId,
    retryable: false,
  }, {
    status: result.status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Request-ID': requestId,
    },
  })
}

export const config = {
  runtime: 'nodejs',
  matcher: ['/api/:path*'],
}
