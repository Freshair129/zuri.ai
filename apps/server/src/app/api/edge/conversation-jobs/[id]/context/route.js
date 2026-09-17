import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveEdgeDeviceContext } from '@/modules/identity/edge-device-credential'
import { validateEdgeMemoryInvocation } from '@/modules/agent/edge-memory-invocation'

// @req FR-232, FR-234 — authenticate and fence each memory-bearing Edge invocation.
// @spec SEC-018, SEC-025, ADR-091 D7
// @tested tests/unit/edge-memory-invocation.test.js
export const dynamic = 'force-dynamic'
export async function POST(request, { params } = {}) {
  try {
    if (process.env.ZURI_LINE_SERVER_ENABLED !== 'true') return NextResponse.json({ error: 'LINE_SERVER_DISABLED' }, { status: 503 })
    const deviceContext = await resolveEdgeDeviceContext(request)
    if (!deviceContext) return NextResponse.json({ error: 'EDGE_CREDENTIAL_REQUIRED' }, { status: 401 })
    const raw = await request.text()
    if (Buffer.byteLength(raw, 'utf8') > 8192) return NextResponse.json({ error: 'CONTEXT_INVOCATION_REJECTED' }, { status: 413 })
    await validateEdgeMemoryInvocation(params?.id, JSON.parse(raw), { deviceContext })
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    const status = error instanceof z.ZodError || error instanceof SyntaxError ? 400
      : [401, 403, 409].includes(error?.status) ? error.status : 503
    return NextResponse.json({ error: 'CONTEXT_INVOCATION_REJECTED' }, { status })
  }
}
