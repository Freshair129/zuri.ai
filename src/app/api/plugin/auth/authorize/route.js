import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { createPluginAuthorizationCode } from '@/modules/identity/plugin-auth-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

// @req FR-123 — only an existing trusted browser viewer may authorize a plugin.
// @spec ADR-052, SDD-074, SEC-022
// @tested tests/unit/fr123-plugin-auth-route.test.js

export const dynamic = 'force-dynamic'

const publicErrorCodes = new Set(['AUTH_REQUIRED', 'AUTH_UNAVAILABLE', 'INVALID_REQUEST', 'INVALID_GRANT', 'PLUGIN_AUTH_CONFIG_MISSING'])

// `resolveRequestViewer` throws `httpError`, which carries a status but no
// `code`, so the fallback is chosen by status rather than fixed. Reporting a
// 503 session outage as `AUTH_REQUIRED` would tell a caller to re-authenticate
// against a boundary that is merely unavailable.
function errorResponse(error) {
  const status = Number(error?.status) === 401 ? 401 : Number(error?.status) === 400 ? 400 : 503
  const fallback = status === 401 ? 'AUTH_REQUIRED' : status === 400 ? 'INVALID_REQUEST' : 'AUTH_UNAVAILABLE'
  const code = publicErrorCodes.has(error?.code) ? error.code : fallback
  return NextResponse.json({ error: code }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request) {
  let viewer
  try {
    viewer = await resolveRequestViewer(request)
  } catch (error) {
    return errorResponse(error)
  }

  const url = new URL(request.url)
  const input = Object.fromEntries(url.searchParams.entries())
  try {
    if (!viewer?.principal?.id) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
    const result = await createPluginAuthorizationCode({
      db: prisma,
      principalId: viewer.principal.id,
      input,
    })
    // Safe only because the service already refused any redirect_uri outside
    // the configured allowlist — this URL is a registered target, not caller
    // input, by the time it is constructed.
    const redirect = new URL(input.redirect_uri)
    redirect.searchParams.set('code', result.code)
    redirect.searchParams.set('state', input.state)
    return NextResponse.redirect(redirect, { status: 302, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
