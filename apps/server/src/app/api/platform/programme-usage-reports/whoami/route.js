import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authenticateHarnessCredential } from '@/modules/identity/harness-credential'

// @req FR-220 — the one read a harness credential allows: its own person, device and status, nothing else.
// @spec ADR-087 D3, SEC-001
// @tested tests/unit/harness-credential.test.js
export const dynamic = 'force-dynamic'
export async function GET(request) {
  try {
    const credential = await authenticateHarnessCredential({ authorization: request.headers.get('authorization'), db: prisma })
    if (!credential) return NextResponse.json({ error: 'HARNESS_CREDENTIAL_REQUIRED' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
    const { installationId, personDisplayName, deviceLabel, harness, status } = credential
    return NextResponse.json({ installationId, personDisplayName, deviceLabel, harness, status }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'USAGE_REPORT_UNAVAILABLE' }, { status: 503 })
  }
}