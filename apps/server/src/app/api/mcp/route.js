import { NextResponse } from 'next/server'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveKnowledgeRequestViewer } from '@/modules/knowledge/knowledge-http'
import { createProjectManagerMcpTransport, jsonRpcError } from '@/modules/project-manager/mcp/transport'

// @req FR-069 — expose the approved PlanEnvelope intake through MCP without a
// second business or persistence path.
// @req FR-071 — expose the approved data_pipeline tools through the same
// authenticated MCP session without a second persistence path.
// @req FR-172 — knowledge MCP queries/citations can recheck the original
// authenticated request before disclosing a slow result.
// @spec ADR-029, ADR-040, SEC-001, SEC-008
// @tested tests/unit/project-manager-mcp.test.js, tests/unit/pipeline-mcp-transport.test.js

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
    // Knowledge query/citation handlers may re-resolve the original request
    // after slow snapshot reads. This closure is transport context, never a
    // caller-supplied tool argument or authority token.
    resolveCurrentViewer: () => resolveKnowledgeRequestViewer(request),
  })
  const headers = result.sessionId ? { 'Mcp-Session-Id': result.sessionId } : undefined
  if (result.status === 204) return new NextResponse(null, { status: 204, headers })
  return NextResponse.json(result.body, { status: result.status, headers })
}
