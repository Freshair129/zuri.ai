import { NextResponse } from 'next/server'
import { receiveNotionWebhook } from '@/modules/integration/application/notion-webhook-service'

// @public-provider-endpoint — Notion's verification challenge and event delivery
// have no browser session. The initial challenge is protocol setup; after its token
// is pinned, events authenticate with X-Notion-Signature over exact raw bytes. This
// public boundary is approved by ADR-109 D2 and covered by the webhook integration test.
// @req FR-274 — bounded Notion challenge/event endpoint verifies signatures over
//   raw bytes before persisting only a minimal idempotent receipt.
// @spec ADR-109 D2; SDD-109; SEC-037
// @tested tests/integration/notion-oauth-webhook.test.js
export const dynamic = 'force-dynamic'

function errorResponse(error) {
  const message = typeof error?.message === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message)
    ? error.message
    : 'NOTION_WEBHOOK_FAILED'
  const response = NextResponse.json({ error: message }, { status: Number(error?.status) || 500 })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function POST(request) {
  try {
    const result = await receiveNotionWebhook(request)
    const response = NextResponse.json(result)
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) {
    return errorResponse(error)
  }
}
