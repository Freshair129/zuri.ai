import { NextResponse } from 'next/server'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createCredentialWriteGuard } from '@/modules/identity/credential-write-gate'
import { completeNotionOAuth, notionIntegrationRedirect } from '@/modules/integration/application/notion-oauth-service'

// @req FR-273 — consume Notion's code/state callback, exchange server-side and
//   immediately redirect without retaining code or token query parameters.
// @spec ADR-109 D1; SDD-108; SEC-037
// @tested tests/integration/notion-oauth-webhook.test.js
export const dynamic = 'force-dynamic'

function safeFailureRedirect(error) {
  const message = typeof error?.message === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message)
    ? error.message
    : 'NOTION_OAUTH_FAILED'
  try {
    return NextResponse.redirect(notionIntegrationRedirect(process.env, 'error', message), 302)
  } catch {
    return NextResponse.json({ error: 'NOTION_OAUTH_CALLBACK_FAILED' }, { status: 503 })
  }
}

function harden(response) {
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

export async function GET(request) {
  const params = new URL(request.url).searchParams
  try {
    const viewer = await resolveRequestViewer(request)
    await completeNotionOAuth({
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
      providerError: params.has('error') ? 'DENIED' : undefined,
      viewer,
      guard: createCredentialWriteGuard({ request, env: {} }),
    })
    return harden(NextResponse.redirect(notionIntegrationRedirect(process.env, 'connected'), 302))
  } catch (error) {
    return harden(safeFailureRedirect(error))
  }
}
