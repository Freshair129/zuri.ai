import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveEdgeDeviceContext } from '@/modules/identity/edge-device-credential'
import { getModelResidencyDirective } from '@/modules/line-oa-studio/application/model-residency-service'

// @req FR-244 — the compute-owned edge worker's residency poll: one aggregate
//   boolean, never an account id, a schedule or anything ADR-061 keeps off this
//   wire. Authenticated the same way as every other /api/edge/* route.
// @spec ADR-061, ADR-094 D6 option A, SEC-001, SEC-025
// @tested tests/integration/fr244-line-oa-business-hours.test.js
export const dynamic = 'force-dynamic'
export async function POST(request) {
  try {
    if (process.env.ZURI_LINE_SERVER_ENABLED !== 'true') return NextResponse.json({ error: 'LINE_SERVER_DISABLED' }, { status: 503 })
    const deviceContext = await resolveEdgeDeviceContext(request)
    if (!deviceContext) return NextResponse.json({ error: 'EDGE_CREDENTIAL_REQUIRED' }, { status: 401 })
    const body = await request.json()
    z.object({}).strict().parse(body)
    return NextResponse.json(await getModelResidencyDirective({}))
  } catch (error) {
    const status = error instanceof z.ZodError || error instanceof SyntaxError ? 400 : [401].includes(error?.status) ? error.status : 503
    return NextResponse.json({ error: 'MODEL_RESIDENCY_REQUEST_REJECTED' }, { status })
  }
}
