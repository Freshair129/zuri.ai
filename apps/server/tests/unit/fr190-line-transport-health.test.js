import { describe, expect, it, vi } from 'vitest'
import {
  classifySilence, classifyEndpoint, normalizeEndpoint, expectedWebhookEndpoint, monitoringExclusion,
} from '@/modules/line-oa-studio/domain/transport-health'
import { readLineTransportHealth, sweepLineTransportHealth } from '@/modules/line-oa-studio/application/line-transport-health'
import { makeViewer } from '../factories/viewer'

// @req FR-190 — silence classification, endpoint agreement, exclusion of paused
//   accounts, the hourly probe cache, and that no credential leaves the read.
// @spec ADR-061, SEC-001
// @tested tests/unit/fr190-line-transport-health.test.js

const NOW = new Date('2026-09-12T12:00:00.000Z')
const hoursAgo = h => new Date(NOW.getTime() - h * 3600_000)
const BUSINESS = 'business-1'
const ACCOUNT_ID = 'acc-1'
const ENV = {
  ZURI_LINE_SERVER_ENABLED: 'true',
  PUBLIC_BASE_URL: 'https://zuri.example.com',
  ZURI_LINE_SECRET_FILE: '/run/secrets/zuri-line.json',
}
const OURS = `https://zuri.example.com/api/line-oa/accounts/${ACCOUNT_ID}/webhook`

function fakeDb({ account = {}, lastInboundAt = hoursAgo(1), accounts } = {}) {
  const row = {
    id: ACCOUNT_ID, businessId: BUSINESS, status: 'CONNECTED', serverEnabled: true, archivedAt: null,
    integrationConnectionId: 'conn-1', createdAt: hoursAgo(100), updatedAt: hoursAgo(100), ...account,
  }
  return {
    row,
    lineOaAccount: {
      findUnique: vi.fn(async () => row),
      findMany: vi.fn(async () => accounts ?? [row]),
    },
    rawExternalRecord: { aggregate: vi.fn(async () => ({ _max: { receivedAt: lastInboundAt } })) },
  }
}

/** A probe result shaped like LINE's, without touching the network. */
function fakeFetch(body, { ok = true, status = 200 } = {}) {
  return vi.fn(async () => ({ ok, status, json: async () => body }))
}

// The service imports the Prisma singleton at module load; this unit test injects
// its own db object, so the real client must never be constructed here.
vi.mock('@/lib/db', () => ({ default: {} }))

/** The service resolves a token through the real transport module; stub that seam. */
vi.mock('@/platform/integrations/providers/line/server-line-transport', () => ({
  createServerLineSecretManagerFromEnv: () => ({ resolve: async () => ({ material: '{}' }) }),
  resolveServerLineAccount: async () => ({ channelAccessToken: 'token-never-logged' }),
}))

describe('classifySilence (owner thresholds: quiet 6h, silent 24h)', () => {
  it('is OK just under six hours and QUIET at six', () => {
    expect(classifySilence({ lastInboundAt: hoursAgo(5.9), now: NOW }).state).toBe('OK')
    expect(classifySilence({ lastInboundAt: hoursAgo(6), now: NOW }).state).toBe('QUIET')
  })

  it('is SILENT at twenty-four hours', () => {
    expect(classifySilence({ lastInboundAt: hoursAgo(23.9), now: NOW }).state).toBe('QUIET')
    expect(classifySilence({ lastInboundAt: hoursAgo(24), now: NOW }).state).toBe('SILENT')
  })

  it('measures from activeSince when nothing has ever arrived, so a new account is not SILENT', () => {
    const fresh = classifySilence({ lastInboundAt: null, activeSince: hoursAgo(0.1), now: NOW })
    expect(fresh).toMatchObject({ state: 'OK', lastInboundAt: null, measuredFrom: 'ACTIVE_SINCE' })
    expect(classifySilence({ lastInboundAt: null, activeSince: hoursAgo(30), now: NOW }).state).toBe('SILENT')
  })

  it('reports OK with no age when there is nothing at all to measure', () => {
    expect(classifySilence({ now: NOW })).toMatchObject({ state: 'OK', ageMs: null, measuredFrom: null })
  })
})

describe('classifyEndpoint', () => {
  it('MATCHED ignores a trailing slash and host case', () => {
    expect(classifyEndpoint({ configured: `${OURS}/`, expected: OURS, active: true })).toBe('MATCHED')
    expect(classifyEndpoint({ configured: OURS.replace('zuri.example.com', 'Zuri.Example.COM'), expected: OURS, active: true })).toBe('MATCHED')
  })

  it('MISMATCHED for another host — the 2026-09-12 failure', () => {
    const other = 'https://desktop-vetatmq.tail71c7d1.ts.net:10000/webhook/line'
    expect(classifyEndpoint({ configured: other, expected: OURS, active: true })).toBe('MISMATCHED')
  })

  it('MISMATCHED for the right host but another account id', () => {
    const otherAccount = OURS.replace(ACCOUNT_ID, 'acc-2')
    expect(classifyEndpoint({ configured: otherAccount, expected: OURS, active: true })).toBe('MISMATCHED')
  })

  it('DISABLED beats a matching URL, and a failed probe is UNKNOWN', () => {
    expect(classifyEndpoint({ configured: OURS, expected: OURS, active: false })).toBe('DISABLED')
    expect(classifyEndpoint({ configured: OURS, expected: OURS, active: true, probeFailed: true })).toBe('UNKNOWN')
  })

  it('UNKNOWN rather than MISMATCHED when a value is unusable', () => {
    expect(classifyEndpoint({ configured: 'not a url', expected: OURS, active: true })).toBe('UNKNOWN')
    expect(classifyEndpoint({ configured: OURS, expected: null, active: true })).toBe('UNKNOWN')
    expect(normalizeEndpoint('ftp://example.com/x')).toBeNull()
  })
})

describe('monitoringExclusion (owner decision: paused accounts are excluded)', () => {
  it.each([
    [{ status: 'PAUSED', serverEnabled: true }, 'PAUSED'],
    [{ status: 'CONNECTED', serverEnabled: false }, 'NOT_SERVER_ENABLED'],
    [{ status: 'DRAFT', serverEnabled: true }, 'NOT_CONNECTED'],
    [{ status: 'CONNECTED', serverEnabled: true, archivedAt: new Date() }, 'ARCHIVED'],
  ])('%o is excluded as %s', (account, reason) => {
    expect(monitoringExclusion(account)).toBe(reason)
  })

  it('monitors a connected, server-enabled account', () => {
    expect(monitoringExclusion({ status: 'CONNECTED', serverEnabled: true })).toBeNull()
  })
})

describe('readLineTransportHealth', () => {
  // Viewing LINE OA state needs Business visibility AND the line-oa domain (FR-061).
  const viewer = () => makeViewer({ visibleBusinessIds: [BUSINESS], ownedBusinessIds: [BUSINESS], visibleDomains: ['line-oa'] })

  it('reports a silent, misrouted account without leaking the token or the other endpoint', async () => {
    const db = fakeDb({ lastInboundAt: hoursAgo(30) })
    const fetchImpl = fakeFetch({ endpoint: 'https://elsewhere.example/webhook/line', active: true })
    const result = await readLineTransportHealth(ACCOUNT_ID, {
      viewer: viewer(), db, env: ENV, now: NOW, fetchImpl, cache: new Map(),
    })
    expect(result).toMatchObject({
      monitored: true, transportEnabled: true,
      silence: { state: 'SILENT', ageMinutes: 30 * 60 },
      endpoint: { state: 'MISMATCHED', expectedEndpoint: OURS },
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('token-never-logged')
    expect(serialized).not.toContain('elsewhere.example')
  })

  it('reports MATCHED and OK for a healthy account', async () => {
    const db = fakeDb({ lastInboundAt: hoursAgo(0.5) })
    const result = await readLineTransportHealth(ACCOUNT_ID, {
      viewer: viewer(), db, env: ENV, now: NOW, fetchImpl: fakeFetch({ endpoint: OURS, active: true }), cache: new Map(),
    })
    expect(result.silence.state).toBe('OK')
    expect(result.endpoint.state).toBe('MATCHED')
  })

  it('says the transport is off instead of guessing, when the deployment flag is missing', async () => {
    const db = fakeDb()
    const fetchImpl = fakeFetch({ endpoint: OURS, active: true })
    const result = await readLineTransportHealth(ACCOUNT_ID, {
      viewer: viewer(), db, env: { ...ENV, ZURI_LINE_SERVER_ENABLED: undefined }, now: NOW, fetchImpl, cache: new Map(),
    })
    expect(result.transportEnabled).toBe(false)
    expect(result.endpoint).toMatchObject({ state: 'UNKNOWN', reason: 'TRANSPORT_DISABLED' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('excludes a paused account and says so', async () => {
    const db = fakeDb({ account: { status: 'PAUSED' } })
    const result = await readLineTransportHealth(ACCOUNT_ID, { viewer: viewer(), db, env: ENV, now: NOW, cache: new Map() })
    expect(result).toMatchObject({ monitored: false, reason: 'PAUSED', accountStatus: 'PAUSED' })
  })

  it('asks LINE once an hour, not once a read', async () => {
    const db = fakeDb()
    const fetchImpl = fakeFetch({ endpoint: OURS, active: true })
    const cache = new Map()
    const call = at => readLineTransportHealth(ACCOUNT_ID, { viewer: viewer(), db, env: ENV, now: at, fetchImpl, cache })
    await call(NOW)
    await call(new Date(NOW.getTime() + 59 * 60_000))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await call(new Date(NOW.getTime() + 61 * 60_000))
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('degrades to UNKNOWN when the provider answers badly, instead of failing the read', async () => {
    const db = fakeDb()
    const result = await readLineTransportHealth(ACCOUNT_ID, {
      viewer: viewer(), db, env: ENV, now: NOW, cache: new Map(),
      fetchImpl: fakeFetch(null, { ok: false, status: 429 }),
    })
    expect(result.endpoint).toMatchObject({ state: 'UNKNOWN', reason: 'PROVIDER_429' })
  })

  it('refuses a viewer who cannot see the Business', async () => {
    const db = fakeDb()
    await expect(readLineTransportHealth(ACCOUNT_ID, {
      viewer: makeViewer({ visibleBusinessIds: ['other'], ownedBusinessIds: ['other'], visibleDomains: ['line-oa'] }),
      db, env: ENV, now: NOW, cache: new Map(), fetchImpl: fakeFetch({ endpoint: OURS, active: true }),
    })).rejects.toThrow()
  })

  it('is not found for an unknown account', async () => {
    const db = fakeDb()
    db.lineOaAccount.findUnique = vi.fn(async () => null)
    await expect(readLineTransportHealth('missing', { viewer: viewer(), db, env: ENV, now: NOW })).rejects.toThrow()
  })
})

describe('sweepLineTransportHealth', () => {
  it('logs one warning line per account that is not OK, and nothing for a healthy one', async () => {
    const db = fakeDb({ lastInboundAt: hoursAgo(30) })
    const lines = []
    const result = await sweepLineTransportHealth({
      db, env: ENV, now: NOW, cache: new Map(),
      fetchImpl: fakeFetch({ endpoint: 'https://elsewhere.example/webhook/line', active: true }),
      log: line => lines.push(line),
    })
    expect(result).toEqual({ scanned: 1, warned: 1 })
    expect(lines[0]).toMatchObject({
      event: 'line.transport.health', level: 'warning', accountId: ACCOUNT_ID,
      silence: 'SILENT', endpoint: 'MISMATCHED', silentForMinutes: 1800,
    })

    const healthy = fakeDb({ lastInboundAt: hoursAgo(0.2) })
    const quiet = []
    const second = await sweepLineTransportHealth({
      db: healthy, env: ENV, now: NOW, cache: new Map(),
      fetchImpl: fakeFetch({ endpoint: OURS, active: true }), log: line => quiet.push(line),
    })
    expect(second).toEqual({ scanned: 1, warned: 0 })
    expect(quiet).toHaveLength(0)
  })
})
