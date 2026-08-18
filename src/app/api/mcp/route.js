import { NextResponse } from 'next/server'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createProjectManagerMcpTransport, jsonRpcError } from '@/modules/project-manager/mcp/transport'

// @req FR-069 — expose the approved PlanEnvelope intake through MCP without a
// second business or persistence path.
// @spec ADR-029, SEC-001, SEC-008
// @tested tests/unit/project-manager-mcp.test.js

export const dynamic = 'force-dynamic'
const transport = createProjectManagerMcpTransport()

export async function POST(request) {
  let message
  try {
    message = await request.json()
  } catch {
    return NextResponse.json(jsonRpcError(null, -32700, 'Parse error'), { status: 400 })
  }

  let viewer
  try {
    viewer = await resolveRequestViewer(request)
  } catch (error) {
    const status = Number(error?.status) === 503 ? 503 : 401
    return NextResponse.json(jsonRpcError(null, -32001, 'Authenticated viewer is required'), { status })
  }

  const result = await transport.handle(message, {
    viewer,
    sessionId: request.headers.get('mcp-session-id') || undefined,
  })
  const headers = result.sessionId ? { 'Mcp-Session-Id': result.sessionId } : undefined
  if (result.status === 204) return new NextResponse(null, { status: 204, headers })
  return NextResponse.json(result.body, { status: result.status, headers })
}
