import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { exchangePluginAuthorizationCode } from '@/modules/identity/plugin-auth-service'

// @req FR-123 — exchange a one-time PKCE-bound code for a short-lived opaque
// session; never return refresh material or tenant/business authority.
// @spec ADR-052, SDD-074, SEC-022
// @tested tests/unit/fr123-plugin-auth-route.test.js

export const dynamic = 'force-dynamic'

const publicErrorCodes = new Set(['AUTH_REQUIRED', 'AUTH_UNAVAILABLE', 'INVALID_REQUEST', 'INVALID_GRANT', 'PLUGIN_AUTH_CONFIG_MISSING'])

function errorResponse(error) {
  const status = Number(error?.status) === 400 ? 400 : Number(error?.status) === 401 ? 401 : 503
  const code = publicErrorCodes.has(error?.code) ? error.code : 'AUTH_UNAVAILABLE'
  return NextResponse.json({ error: code }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request) {
  let input
  try {
    input = await request.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  try {
    const result = await exchangePluginAuthorizationCode({ db: prisma, input })
    return NextResponse.json({
      access_token: result.accessToken,
      token_type: result.tokenType,
      expires_in: result.expiresIn,
      expires_at: result.expiresAt,
      session_id: result.sessionId,
      principal_id: result.principalId,
      installation_id: result.installationId,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
