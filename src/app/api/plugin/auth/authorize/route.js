import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { createPluginAuthorizationCode } from '@/modules/identity/plugin-auth-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

// @req FR-094 — only an existing trusted browser viewer may authorize a plugin.
// @spec ADR-045, SDD-052, SEC-018
// @tested tests/unit/fr094-plugin-auth-route.test.js

export const dynamic = 'force-dynamic'

const publicErrorCodes = new Set(['AUTH_REQUIRED', 'AUTH_UNAVAILABLE', 'INVALID_REQUEST', 'INVALID_GRANT', 'PLUGIN_AUTH_CONFIG_MISSING'])

function errorResponse(error, fallback = 'AUTH_UNAVAILABLE') {
  const status = Number(error?.status) === 401 ? 401 : Number(error?.status) === 400 ? 400 : 503
  const code = publicErrorCodes.has(error?.code) ? error.code : fallback
  return NextResponse.json({ error: code }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request) {
  let viewer
  try {
    viewer = await resolveRequestViewer(request)
  } catch (error) {
    return errorResponse(error, 'AUTH_REQUIRED')
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
    const redirect = new URL(input.redirect_uri)
    redirect.searchParams.set('code', result.code)
    redirect.searchParams.set('state', input.state)
    return NextResponse.redirect(redirect, { status: 302, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
