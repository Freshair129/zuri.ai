import { NextResponse } from 'next/server'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { readLineConversationTrace } from '@/modules/line-oa-studio/application/line-conversation-jobs'

// @req FR-171 — authenticated read-only inspection of a durable job's execution.
// @spec SEC-001, ADR-070 — derives scope from job and requires Business ownership.
// @tested tests/integration/server-line-trace.test.js
export const dynamic = 'force-dynamic'
export async function GET(request, { params }) {
  const headers = { 'Cache-Control': 'private, no-store' }
  try {
    const data = await readLineConversationTrace(params?.id, { viewer: await resolveRequestViewer(request) })
    return NextResponse.json(data, { headers })
  } catch (error) {
    const status = [401, 403, 404].includes(error?.status) ? error.status : 503
    return NextResponse.json({ error: status === 404 ? 'TRACE_NOT_FOUND' : 'TRACE_UNAVAILABLE' }, { status, headers })
  }
}
