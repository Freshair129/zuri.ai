import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { serverLinePorts } from '@/modules/line-oa-studio/application/server-line-runtime'
import { runLineConversationWorker } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { reconcileAbandonedLineAdmissions } from '@/modules/line-oa-studio/application/line-admission-reconciler'
import { sweepLineTransportHealth } from '@/modules/line-oa-studio/application/line-transport-health'
import { createServerLineAnswer } from '@/modules/agent/server-line-answer'
// @req FR-149, FR-150 — deployment-authenticated bounded durable worker tick.
// @req FR-190 — the same tick carries the hourly transport-health sweep, so a
//   silent or misrouted channel produces a log line without a second process.
// @spec ADR-061, SEC-001
// @tested tests/integration/server-line-jobs.test.js, tests/integration/line-admission-reconciler.test.js
export const dynamic = 'force-dynamic'

const HEALTH_SWEEP_INTERVAL_MS = 60 * 60 * 1000
let lastHealthSweepAt = 0
export async function POST(request) {
  const secret = process.env.ZURI_LINE_WORKER_TOKEN
  const supplied = request.headers.get('authorization') || ''
  const expected = `Bearer ${secret}`
  if (!secret || secret.length < 32 || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return NextResponse.json({ error: 'WORKER_CREDENTIAL_REQUIRED' }, { status: 401 })
  }
  // Reconcile before the send tick, not after: a row recovered here becomes an
  // eligible QUEUED/READY job this same tick, but at a ~1s cadence there is no
  // observable difference between "sent this tick" and "sent next tick" — so
  // ordering is chosen for the read, not for latency. This also means a
  // recovered job never races the send half of the very tick that revived it.
  //
  // Its failure must never surface as this route's failure: the reconciler
  // covers a rare crash-recovery path, and the existing worker tick (which
  // already carries its own 503) must keep running even on a bad reconciler
  // sweep. Reported as a `reconciled` count of `0` with a boolean error flag,
  // rather than thrown, so a monitoring reader sees "did not run" distinctly
  // from "ran and found nothing".
  // No `serverLinePorts()` here: the reconciler only needs `db`/`admit`/`env`
  // (all defaulted), not the reply/push transports that call carries — this
  // sweep re-admits into the queue, it never sends.
  // FR-190 — at most hourly (owner decision 2026-09-12) and never fatal: this is a
  // report ABOUT the transport, so a failed sweep must not fail the tick that carries
  // the work. It rides this tick because a second process to say "nothing arrived" is
  // exactly the kind of thing nobody restarts after a reboot.
  if (Date.now() - lastHealthSweepAt >= HEALTH_SWEEP_INTERVAL_MS) {
    lastHealthSweepAt = Date.now()
    // The counts stay out of the response on purpose: this body is a contract the
    // ticker and its tests read, and a health sweep is not part of the work it
    // reports. The finding leaves as a log line instead.
    try { await sweepLineTransportHealth({}) } catch { /* reported by its own log line, never fatal */ }
  }
  let reconciled
  try {
    reconciled = await reconcileAbandonedLineAdmissions({})
  } catch {
    reconciled = { scanned: 0, admitted: 0, skipped: 0, failed: 0, error: true }
  }
  try {
    const ports = serverLinePorts()
    const result = await runLineConversationWorker({ ...ports,
      answer: createServerLineAnswer({ threadMemory: ports.threadMemory }) })
    return NextResponse.json({ ...result, reconciled })
  } catch { return NextResponse.json({ error: 'LINE_WORKER_UNAVAILABLE' }, { status: 503 }) }
}
