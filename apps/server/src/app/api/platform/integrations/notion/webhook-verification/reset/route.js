import { NextResponse } from 'next/server'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resetNotionWebhookVerificationToken } from '@/modules/integration/application/notion-webhook-service'

// @req FR-274 — AAL2 installation-operator reset is audited before a new Notion
//   verification challenge can be accepted.
// @spec ADR-109 D2; SDD-109; SEC-037
// @tested tests/integration/notion-oauth-webhook.test.js
export const dynamic = 'force-dynamic'

export async function POST(request) {
  try {
    const viewer = await resolveRequestViewer(request)
    const result = await resetNotionWebhookVerificationToken({ viewer, request })
    const response = NextResponse.json(result)
    response.headers.set('Cache-Control', 'no-store')
    response.headers.set('Referrer-Policy', 'no-referrer')
    return response
  } catch (error) {
    const message = typeof error?.message === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message)
      ? error.message
      : 'NOTION_WEBHOOK_TOKEN_RESET_FAILED'
    const response = NextResponse.json({ error: message }, { status: Number(error?.status) || 500 })
    response.headers.set('Cache-Control', 'no-store')
    response.headers.set('Referrer-Policy', 'no-referrer')
    return response
  }
}
