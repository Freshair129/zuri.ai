import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  assertApiWriteCsrfConfiguration,
  issueApiWriteCsrfToken,
  zApiWriteCsrfError,
  zApiWriteCsrfToken,
} from '@/modules/identity/api-write-csrf'
import { createSessionPort } from '@/modules/identity/session-port'

// @req FR-252 — P2 authenticated, no-store API-write CSRF delivery.
// @spec ADR-097
// @tested tests/unit/identity/api-write-csrf-route.test.js

export const dynamic = 'force-dynamic'

function typedError(status, code, message, retryable) {
  const requestId = randomUUID()
  const body = zApiWriteCsrfError.parse({ code, message, requestId, retryable })
  return NextResponse.json(
    body,
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Request-ID': requestId,
      },
    },
  )
}

function refusal(error) {
  const code = error?.code || error?.message
  if (error?.status === 401 || code === 'AUTH_REQUIRED') {
    return typedError(401, 'AUTH_REQUIRED', 'Authentication is required.', false)
  }
  if (error?.status === 403 || code === 'CSRF_INVALID') {
    return typedError(403, 'CSRF_INVALID', 'CSRF validation failed.', false)
  }
  if (error?.status === 503 || code === 'SESSION_UNAVAILABLE') {
    return typedError(503, 'SESSION_UNAVAILABLE', 'Session service temporarily unavailable.', true)
  }
  return typedError(503, 'SESSION_UNAVAILABLE', 'Session service temporarily unavailable.', true)
}

export async function GET(request) {
  try {
    assertApiWriteCsrfConfiguration()
  } catch (error) {
    return refusal(error)
  }

  let session
  try {
    session = await createSessionPort().read(request)
  } catch {
    return refusal({ status: 503, code: 'SESSION_UNAVAILABLE' })
  }

  if (!session || session.state !== 'AUTHENTICATED') {
    return refusal({ status: 401, code: 'AUTH_REQUIRED' })
  }

  try {
    const token = issueApiWriteCsrfToken({ request, session })
    return NextResponse.json(zApiWriteCsrfToken.parse(token), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return refusal(error)
  }
}
