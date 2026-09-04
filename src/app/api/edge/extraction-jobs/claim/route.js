import { NextResponse } from 'next/server'
import { resolveEdgeDeviceContext } from '@/modules/identity/edge-device-credential'
import { claimAssetExtractionJob } from '@/modules/asset-management/application/asset-extraction-job-service'

// @req FR-143 — a Zuri Edge Device claims the oldest waiting extraction job of
//   the Business its credential is bound to. The request body is empty by
//   design: everything that decides which job this is comes from the credential,
//   so a device cannot name a Business, a device id or a job and reach work that
//   is not its own (ADR-059 D2).
// @req FR-144 — device authentication; no session, no Person.
// @spec SEC-025, SEC-001, ADR-059 D1/D3, ADR-041 D3
// @tested tests/integration/fr143-asset-extraction-job.test.js
//
// This route does not use the shared `handle` helper: an empty queue answers
// 204 with no body, and `handle` always writes a JSON body.

export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    const deviceContext = await resolveEdgeDeviceContext(request)
    if (!deviceContext) {
      return NextResponse.json({ error: 'An edge device credential is required' }, { status: 401 })
    }
    const body = await request.json().catch(() => ({}))
    if (body && typeof body === 'object' && Object.keys(body).length > 0) {
      return NextResponse.json({ error: 'The claim request takes no body — scope comes from the credential' }, { status: 400 })
    }
    const { job } = await claimAssetExtractionJob({ deviceContext })
    if (!job) return new NextResponse(null, { status: 204 })
    return NextResponse.json({ job })
  } catch (error) {
    const status = Number(error?.status) || 500
    return NextResponse.json({ error: error?.message || 'Unable to claim an extraction job' }, { status })
  }
}
