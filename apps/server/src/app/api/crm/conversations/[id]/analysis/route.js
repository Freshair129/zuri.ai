import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { queryParams } from '../../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { getConversationAnalyses } from '@/modules/crm/conversation-analysis-service'
import { parseConversationThreadQuery } from '@/modules/crm/conversation-read-model'

// @req FR-127 — bounded read-only analysis projection for an Inbox thread.
// @req FR-091 — the conversation identifier is internal and the selected
//   Business scope is explicit; the CRM analysis reader applies Inbox scope,
//   customer-domain visibility, and the live consent/erasure gate.
// @spec ADR-054 D3-D6, BR-001, SEC-001, SEC-005
// @tested tests/unit/conversation-analysis-inbox-route.test.js
export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  try {
    const viewer = await resolveRequestViewer(request)
    const { businessId } = parseConversationThreadQuery(queryParams(request))
    const data = await getConversationAnalyses({ viewer, businessId, conversationId: params.id })
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', issues: err.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) },
        { status: 400 },
      )
    }

    const requestedStatus = Number(err?.status)
    const status = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus < 500
      ? requestedStatus
      : 500
    const error = status === 401
      ? 'AUTH_REQUIRED'
      : status === 403
        ? 'ACCESS_DENIED'
        : status === 404
          ? 'ANALYSIS_NOT_FOUND'
          : status === 400
            ? 'REQUEST_REFUSED'
            : status < 500
              ? 'REQUEST_REFUSED'
              : 'ANALYSIS_UNAVAILABLE'

    return NextResponse.json({ error }, { status })
  }
}
