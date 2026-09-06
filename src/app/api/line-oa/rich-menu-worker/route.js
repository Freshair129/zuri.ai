import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { serverLineRichMenuPorts } from '@/modules/line-oa-studio/application/server-line-rich-menu-runtime'
import { runLineRichMenuWorker } from '@/modules/line-oa-studio/application/line-oa-rich-menu-jobs'

// @req FR-152 — one deployment-authenticated tick of the rich menu worker,
//   the same bearer as the conversation worker (FR-149) and the same
//   bounded-work contract: at most one job per call, nothing kept in RAM.
// @spec ADR-061 D6, SEC-001
// @tested tests/unit/line-oa-rich-menu-jobs-routes.test.js

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
    const result = await runLineRichMenuWorker(serverLineRichMenuPorts())
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'LINE_WORKER_UNAVAILABLE' }, { status: 503 })
  }
}
