import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveEdgeDeviceContext } from '@/modules/identity/edge-device-credential'
import { executeEdgeProjectWorkTool } from '@/modules/agent/edge-project-work-tools'

// @req FR-026, FR-072, FR-150 — bounded authenticated Project/Work tools for an active Edge claim.
// @spec SEC-001, SEC-025, ADR-061
// @tested tests/unit/line-project-work-tool-route.test.js, tests/integration/line-project-work-tools.test.js
export const dynamic = 'force-dynamic'
export async function POST(request, { params } = {}) {
  try {
    if (process.env.ZURI_LINE_SERVER_ENABLED !== 'true') return NextResponse.json({ error: 'LINE_SERVER_DISABLED' }, { status: 503 })
    const deviceContext = await resolveEdgeDeviceContext(request)
    if (!deviceContext) return NextResponse.json({ error: 'EDGE_CREDENTIAL_REQUIRED' }, { status: 401 })
    const raw = await request.text()
    if (Buffer.byteLength(raw, 'utf8') > 8192) return NextResponse.json({ error: 'CONVERSATION_TOOL_REQUEST_REJECTED' }, { status: 413 })
    const result = await executeEdgeProjectWorkTool(params?.id, JSON.parse(raw), { deviceContext })
    return NextResponse.json(result)
  } catch (error) {
    const status = error instanceof z.ZodError || error instanceof SyntaxError ? 400
      : [400, 401, 403, 404, 409, 413].includes(error?.status) ? error.status : 503
    return NextResponse.json({ error: 'CONVERSATION_TOOL_REQUEST_REJECTED' }, { status })
  }
}
