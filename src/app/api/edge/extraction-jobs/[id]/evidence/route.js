import { NextResponse } from 'next/server'
import { resolveEdgeDeviceContext } from '@/modules/identity/edge-device-credential'
import { readAssetExtractionJobEvidence } from '@/modules/asset-management/application/asset-extraction-job-service'
import { createConfiguredAssetObjectStoragePort } from '@/platform/storage/supabase-object-storage'

// @req FR-143 — the evidence bytes for a job this device currently holds. The
//   cloud serves the object itself: no bucket URL, no signed link and no storage
//   credential ever crosses to the device (ADR-041 D3, SEC-025). Access lasts
//   exactly as long as the lease — an expired lease, another device's job or
//   another Business's job all answer with the same 404 the unknown id gets.
// @req FR-144 — device authentication.
// @spec SEC-025, SEC-001, ADR-059 D4, ADR-041 D3
// @tested tests/integration/fr143-asset-extraction-job.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  try {
    const deviceContext = await resolveEdgeDeviceContext(request)
    if (!deviceContext) {
      return NextResponse.json({ error: 'An edge device credential is required' }, { status: 401 })
    }
    const { content, mime, name } = await readAssetExtractionJobEvidence(params?.id, {
      deviceContext,
      objectStoragePort: createConfiguredAssetObjectStoragePort(),
    })
    const safeName = String(name || 'evidence').replace(/["\r\n]/g, '_')
    return new Response(content, {
      headers: {
        'Content-Type': mime || 'application/octet-stream',
        'Content-Length': String(content.length),
        'Content-Disposition': `inline; filename="${safeName}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    const status = Number(error?.status) || (/not found/i.test(error?.message || '') ? 404 : 500)
    return NextResponse.json({ error: error?.message || 'Unable to read job evidence' }, { status })
  }
}
