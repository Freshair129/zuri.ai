import { NextResponse } from 'next/server'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createCredentialWriteGuard } from '@/modules/identity/credential-write-gate'
import { beginNotionOAuth } from '@/modules/integration/application/notion-oauth-service'

// @req FR-273 — begin a Business-owned Notion OAuth install at AAL2.
// @spec ADR-109 D1; SDD-108; SEC-037
// @tested tests/integration/notion-oauth-webhook.test.js
export const dynamic = 'force-dynamic'

function errorResponse(error) {
  const message = typeof error?.message === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message)
    ? error.message
    : 'NOTION_OAUTH_CONNECT_FAILED'
  const response = NextResponse.json({ error: message }, { status: Number(error?.status) || 500 })
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

export async function GET(request) {
  try {
    const businessId = new URL(request.url).searchParams.get('businessId')
    const viewer = await resolveRequestViewer(request)
    const authorizationUrl = await beginNotionOAuth({
      businessId,
      viewer,
      guard: createCredentialWriteGuard({ request, env: {} }),
    })
    const response = NextResponse.redirect(authorizationUrl, 302)
    response.headers.set('Cache-Control', 'no-store')
    response.headers.set('Referrer-Policy', 'no-referrer')
    return response
  } catch (error) {
    return errorResponse(error)
  }
}
