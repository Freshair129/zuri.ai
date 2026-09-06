import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { serverLinePorts } from '@/modules/line-oa-studio/application/server-line-runtime'
import { runLineConversationWorker } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { createServerLineAnswer } from '@/modules/agent/server-line-answer'
// @req FR-149, FR-150 — deployment-authenticated bounded durable worker tick.
// @spec ADR-061, SEC-001
// @tested tests/integration/server-line-jobs.test.js
export const dynamic = 'force-dynamic'
export async function POST(request) {
  const secret = process.env.ZURI_LINE_WORKER_TOKEN
  const supplied = request.headers.get('authorization') || ''
  const expected = `Bearer ${secret}`
  if (!secret || secret.length < 32 || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return NextResponse.json({ error: 'WORKER_CREDENTIAL_REQUIRED' }, { status: 401 })
  }
  try {
    const result = await runLineConversationWorker({ ...serverLinePorts(), answer: createServerLineAnswer() })
    return NextResponse.json(result)
  } catch { return NextResponse.json({ error: 'LINE_WORKER_UNAVAILABLE' }, { status: 503 }) }
}
