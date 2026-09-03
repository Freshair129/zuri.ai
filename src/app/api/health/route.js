import { NextResponse } from 'next/server'
import prisma from '@/lib/db'

// @req FR-142 — deployment liveness probe: `GET /api/health` answers without a
//   session, runs ONE trivial query against the configured application database,
//   and reports `{status:'ok', db:'ok'}` (200) or `{status:'degraded',
//   db:'unreachable'}` (503). It is what Docker Compose polls to decide the `web`
//   container is healthy and to start ngrok only after it (ADR-058).
// @spec SEC-009 — the body carries states and counts only: no error message, no
//   host, no provider name, no credential can leave through this route.
// @spec SEC-006 — read-only and side-effect free, so it may stay unauthenticated;
//   it discloses nothing an anonymous caller could not learn from a failing page.
// @tested tests/unit/fr142-health-route.test.js

export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' }

export function createHealthGet({
  db = prisma,
  uptime = () => process.uptime(),
  clock = () => Date.now(),
} = {}) {
  return async function healthGet() {
    const startedAt = clock()
    let dbState = 'ok'
    try {
      // `SELECT 1` is valid on SQLite and Postgres alike, so the probe follows
      // whichever provider src/lib/db.js selected.
      await db.$queryRaw`SELECT 1`
    } catch {
      dbState = 'unreachable'
    }
    const ok = dbState === 'ok'
    return NextResponse.json(
      {
        status: ok ? 'ok' : 'degraded',
        db: dbState,
        uptimeSeconds: Math.floor(uptime()),
        dbLatencyMs: clock() - startedAt,
        checkedAt: new Date(clock()).toISOString(),
      },
      { status: ok ? 200 : 503, headers: NO_STORE },
    )
  }
}

export const GET = createHealthGet()
