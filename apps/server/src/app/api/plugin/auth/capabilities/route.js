import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getPluginCapabilities } from '@/modules/identity/plugin-auth-service'

// @req FR-123 — capabilities are a bounded UX snapshot derived from the
// server-resolved viewer, not a client-supplied scope or mutation grant.
// @spec ADR-052, SDD-074, SEC-022
// @tested tests/unit/fr123-plugin-auth-route.test.js

export const dynamic = 'force-dynamic'

const publicErrorCodes = new Set(['AUTH_REQUIRED', 'AUTH_UNAVAILABLE', 'INVALID_REQUEST', 'PLUGIN_AUTH_CONFIG_MISSING'])

function errorResponse(error) {
  const status = Number(error?.status) === 401 ? 401 : Number(error?.status) === 400 ? 400 : 503
  const code = publicErrorCodes.has(error?.code) ? error.code : 'AUTH_UNAVAILABLE'
  return NextResponse.json({ error: code }, { status, headers: { 'Cache-Control': 'no-store' } })
}

function readBearer(request) {
  const header = request.headers.get('authorization') || ''
  const match = /^Bearer[ \t]+([^ \t]+)$/i.exec(header)
  if (!match) return null
  return match[1]
}

export async function GET(request) {
  const token = readBearer(request)
  if (!token) return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })

  try {
    const result = await getPluginCapabilities({ db: prisma, token })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
