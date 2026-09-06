import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveEdgeDeviceContext } from '@/modules/identity/edge-device-credential'
import { failEdgeConversation } from '@/modules/line-oa-studio/application/line-conversation-jobs'
// @req FR-150 — authenticated, tenant/business scoped compute contract.
// @spec ADR-061, SEC-001, SEC-025
// @tested tests/integration/server-line-jobs.test.js
export const dynamic = 'force-dynamic'
export async function POST(request, { params } = {}) {
  try {
    if (process.env.ZURI_LINE_SERVER_ENABLED !== 'true') return NextResponse.json({ error: 'LINE_SERVER_DISABLED' }, { status: 503 })
    const deviceContext = await resolveEdgeDeviceContext(request)
    if (!deviceContext) return NextResponse.json({ error: 'EDGE_CREDENTIAL_REQUIRED' }, { status: 401 })
    const body = await request.json()

    const result = await failEdgeConversation(params?.id, body, { deviceContext })
    return result ? NextResponse.json(result) : new NextResponse(null, { status: 204 })
  } catch (error) {
    const status = error instanceof z.ZodError || error instanceof SyntaxError ? 400 : [401,404,409].includes(error?.status) ? error.status : 503
    return NextResponse.json({ error: 'CONVERSATION_JOB_REQUEST_REJECTED' }, { status })
  }
}
