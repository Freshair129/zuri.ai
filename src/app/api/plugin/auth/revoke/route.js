import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { revokePluginToken } from '@/modules/identity/plugin-auth-service'

// @req FR-094 — revocation is idempotent and does not disclose token existence.
// @spec ADR-045, SDD-052, SEC-018
// @tested tests/unit/fr094-plugin-auth-route.test.js

export const dynamic = 'force-dynamic'

const publicErrorCodes = new Set(['AUTH_REQUIRED', 'AUTH_UNAVAILABLE', 'INVALID_REQUEST'])

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
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.token !== 'string' || !input.token.trim()) {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  try {
    return NextResponse.json(await revokePluginToken({ db: prisma, token: input.token }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
