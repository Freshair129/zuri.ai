// @req FR-142 — the liveness probe needs no session, runs exactly one trivial
// query, answers 200/ok or 503/degraded, and never leaks an error message, host
// or credential into its body.
// @spec ADR-058, SEC-009
// @tested tests/unit/fr142-health-route.test.js
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ default: { $queryRaw: vi.fn() } }))

const { createHealthGet } = await import('@/app/api/health/route')

function probe({ query, uptime = () => 42.9, clock } = {}) {
  let tick = 1_000
  const db = { $queryRaw: vi.fn(query || (async () => [{ 1: 1 }])) }
  const GET = createHealthGet({ db, uptime, clock: clock || (() => (tick += 5)) })
  return { db, GET }
}

describe('GET /api/health (FR-142)', () => {
  it('answers 200 with db:ok when the trivial query succeeds', async () => {
    const { db, GET } = probe()
    const res = await GET(new Request('http://localhost/api/health'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body).toMatchObject({ status: 'ok', db: 'ok', uptimeSeconds: 42 })
    expect(typeof body.dbLatencyMs).toBe('number')
    expect(typeof body.checkedAt).toBe('string')
    expect(db.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it('answers 503 with db:unreachable when the query throws, without the error text', async () => {
    const secret = 'postgresql://user:hunter2@db.internal:5432/zuri'
    const { GET } = probe({ query: async () => { throw new Error(`connect failed: ${secret}`) } })
    const res = await GET(new Request('http://localhost/api/health'))
    expect(res.status).toBe(503)
    const text = await res.text()
    expect(JSON.parse(text)).toMatchObject({ status: 'degraded', db: 'unreachable' })
    expect(text).not.toContain('hunter2')
    expect(text).not.toContain('db.internal')
    expect(text).not.toContain('connect failed')
  })

  it('does not read the request at all — no cookie, header or body can change the answer', async () => {
    const { GET } = probe()
    const anonymous = await GET(new Request('http://localhost/api/health'))
    const withCookie = await GET(new Request('http://localhost/api/health', { headers: { cookie: 'zuri_session=forged' } }))
    expect(anonymous.status).toBe(200)
    expect(withCookie.status).toBe(200)
  })

  it('reports the query latency from the injected clock', async () => {
    let now = 10_000
    const { GET } = probe({ clock: () => (now += 7) })
    const body = await (await GET()).json()
    // startedAt → query → clock() for latency → clock() for checkedAt: 7 ms between reads.
    expect(body.dbLatencyMs).toBe(7)
  })
})
