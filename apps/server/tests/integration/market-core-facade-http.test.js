import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'
import { ingestRawExternalRecord } from '@/platform/integrations/core/raw-ingest-service'
import { createPrismaRawRecordRepository } from '@/platform/integrations/core/raw-record-repository'
import { RAW_RECORD_FIELDS } from '@/modules/market-intelligence/application/market-core-facade'
import { GET, POST } from '@/app/api/internal/market-intelligence/v1/[operation]/route'
// The consumer under test is the Market service's own code, imported from its package
// (test-only; nothing under src/ imports services/). CI installs only apps/server's
// dependencies for this job; the service's `zod` import still resolves (Vite falls
// back to this project's install, same zod@3.23.8), checked by running this file with
// services/market-intelligence/node_modules removed.
import { createCoreClient } from '../../../../services/market-intelligence/src/adapters/core-client.js'
import { createMarketHttpServer } from '../../../../services/market-intelligence/src/http/server.js'

// @req FR-092 — the committed consumer-to-real-façade HTTP test S1 asked for in its
//   review of #544 (evidence gap recorded in MARKET-INTELLIGENCE-HANDOFF.md). The
//   Market service's CoreClient and its HTTP server talk over real HTTP to core's
//   real market-core.v1 route handler, backed by the real test database. Only the
//   session port is swapped (as in market-intelligence-translation-run.test.js):
//   the façade still re-resolves the subject through resolveRequestViewer, so the
//   authorization order, Business lookup, raw-candidate projection and bounds, and
//   the audit writer are all the production code.
// @spec BR-001, SEC-001, SEC-017, SDD-049, ADR-108

const subjects = new Map()
vi.mock('@/modules/identity/request-viewer', () => ({
  resolveRequestViewer: async (request) => {
    const token = (request.headers.get('cookie') || '').replace(/^zuri_session=/, '')
    const viewer = subjects.get(token)
    if (!viewer) throw Object.assign(new Error('AUTH_REQUIRED'), { status: 401 })
    return viewer
  },
}))

const CORE_TOKEN = 'c'.repeat(48)
const API_TOKEN = 'a'.repeat(48)
const OWNER = 'subject-owner'
const MEMBER = 'subject-member'
const suffix = () => randomUUID().slice(0, 8).toUpperCase()

let tenant, business, connection, providerCode
let facadeServer, facadeUrl, core
const savedEnv = { token: process.env.MARKET_CORE_TOKEN, executor: process.env.MARKET_EXECUTOR }

// A minimal Node HTTP bridge in front of the Next route handler, so the consumer
// crosses a real socket exactly as it would in production. It buffers the request
// body before building the Request, so it does NOT prove the route's pre-buffer
// 16 KiB cap; readBoundedBody's streaming behaviour is proven in
// tests/unit/market-intelligence/market-core-facade.test.js.
function startFacade() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const match = url.pathname.match(/^\/api\/internal\/market-intelligence\/v1\/([^/]+)$/)
    if (!match) {
      res.writeHead(404).end()
      return
    }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const headers = new Headers()
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers.set(name, value)
    }
    const request = new Request(url, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
    })
    try {
      const handler = req.method === 'GET' ? GET : POST
      const response = await handler(request, { params: Promise.resolve({ operation: decodeURIComponent(match[1]) }) })
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch {
      // A thrown handler must answer, not leave the consumer waiting for its timeout.
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
      res.end('{"error":"bridge: handler threw"}')
    }
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(server)
    })
  })
}

// Settles whether or not the server ever started, so a failed beforeAll cannot hang
// the teardown or skip the env restore that follows it.
function closeServer(server) {
  if (!server?.listening) return Promise.resolve()
  return new Promise((resolve) => server.close(() => resolve()))
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function memoryStoreFactory() {
  const scopes = new Map()
  return {
    kind: 'memory',
    async open({ tenantId, businessId }) {
      const key = `${tenantId}/${businessId}`
      if (!scopes.has(key)) scopes.set(key, new Map())
      const rows = scopes.get(key)
      return {
        async insertIfAbsent(draft) {
          const existing = rows.get(draft.lineageKey)
          if (existing) return { status: 'UNCHANGED', observation: existing }
          const observation = { id: randomUUID(), ...draft }
          rows.set(draft.lineageKey, observation)
          return { status: 'CREATED', observation }
        },
        async findExistingLineageKeys(keys) {
          return keys.filter((key) => rows.has(key))
        },
        async listRecent({ limit } = {}) {
          return [...rows.values()].slice(-(limit ?? 50)).reverse()
        },
      }
    },
    async ping() {
      return true
    },
  }
}

async function seedRaw(payload) {
  const token = suffix()
  const repository = createPrismaRawRecordRepository(prisma, { tenantId: tenant.id, connectionId: connection.id })
  const { rawRecord } = await ingestRawExternalRecord(
    {
      tenantId: tenant.id,
      businessId: business.id,
      connectionId: connection.id,
      provider: providerCode,
      lane: 'MARKET_INTELLIGENCE',
      entityType: 'listing',
      externalId: `listing-${token}`,
      sourceType: 'PULL',
      sourceUri: `https://market.example/listing/${token}`,
      schemaVersion: 'market.test.listing.v1',
      payload,
    },
    { repository },
  )
  return rawRecord
}

describe('market-core.v1: Market service consumer against the real façade over HTTP', () => {
  beforeAll(async () => {
    process.env.MARKET_CORE_TOKEN = CORE_TOKEN
    process.env.MARKET_EXECUTOR = 'legacy'

    const token = suffix()
    const portfolio = await createPortfolio({ name: `Market Facade PF ${token}`, code: `PF-MFH-${token}` })
    tenant = await createTenant({ portfolioId: portfolio.id, name: `Market Facade TNT ${token}`, code: `TNT-MFH-${token}` })
    business = await createBusiness({ tenantId: tenant.id, name: 'Market façade HTTP test', code: `BUS-MFH-${token}` })
    const provider = await prisma.integrationProvider.create({
      data: { code: `MARKET_FACADE_${token}`, name: 'Market façade test source', status: 'ACTIVE' },
    })
    connection = await prisma.integrationConnection.create({
      data: {
        tenantId: tenant.id,
        businessId: business.id,
        providerId: provider.id,
        name: 'Market façade connection',
        authorizationType: 'NONE',
        status: 'ACTIVE',
      },
    })
    providerCode = provider.code

    subjects.set(OWNER, makeViewer({ visibleDomains: [...VIEWER_DOMAINS], visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] }))
    subjects.set(MEMBER, makeViewer({ visibleDomains: [...VIEWER_DOMAINS], visibleBusinessIds: [business.id] }))

    facadeServer = await startFacade()
    facadeUrl = `http://127.0.0.1:${facadeServer.address().port}`
    core = createCoreClient({ baseUrl: facadeUrl, token: CORE_TOKEN, retries: 0, timeoutMs: 10000 })
  })

  afterEach(() => {
    process.env.MARKET_EXECUTOR = 'legacy'
  })

  afterAll(async () => {
    try {
      await closeServer(facadeServer)
    } finally {
      restoreEnv('MARKET_CORE_TOKEN', savedEnv.token)
      restoreEnv('MARKET_EXECUTOR', savedEnv.executor)
    }
  })

  it('health, execution ownership and the service credential', async () => {
    expect(await core.health()).toEqual({ ok: true, mode: 'remote' })
    expect(await core.executionOwnership()).toEqual({ ownsTranslation: false })
    process.env.MARKET_EXECUTOR = 'service'
    expect(await core.executionOwnership()).toEqual({ ownsTranslation: true })

    const wrongToken = createCoreClient({ baseUrl: facadeUrl, token: 'w'.repeat(48), retries: 0 })
    await expect(wrongToken.health()).rejects.toMatchObject({ status: 502, code: 'CORE_REJECTED' })
  })

  it('authorize returns the legacy decisions, in legacy order', async () => {
    const authorize = (subject, action) => core.scopeAuthority.authorize({ actor: { subject }, businessId: business.id, action })
    expect(await authorize(OWNER, 'market.feed.read')).toEqual({
      allowed: true,
      scope: { tenantId: tenant.id, businessId: business.id, businessName: business.name },
    })
    expect((await authorize(MEMBER, 'market.feed.read')).allowed).toBe(true)
    expect(await authorize(MEMBER, 'market.translation.run')).toEqual({ allowed: false, status: 404, message: 'Business not found' })
    expect(await authorize('not-a-session', 'market.feed.read')).toEqual({ allowed: false, status: 401, message: 'AUTH_REQUIRED' })
    await expect(core.scopeAuthority.authorize({ actor: {}, businessId: business.id, action: 'market.feed.read' }))
      .rejects.toMatchObject({ status: 401 })
  })

  it('raw candidates pass the consumer schema and carry only the projected fields', async () => {
    const raw = await seedRaw({ title: 'Projected listing', price: 120, currency: 'THB' })
    const records = await core.rawEvidence.listMarketCandidates({ tenantId: tenant.id, businessId: business.id, scanLimit: 50, subject: OWNER })
    const record = records.find((row) => row.id === raw.id)
    expect(record).toBeDefined()
    expect(Object.keys(record).sort()).toEqual([...RAW_RECORD_FIELDS].sort())
    expect(record.receivedAt).toBeInstanceOf(Date)

    const refused = { status: 502, code: 'CORE_REJECTED' }
    await expect(core.rawEvidence.listMarketCandidates({ tenantId: 'other-tenant', businessId: business.id, scanLimit: 5, subject: OWNER })).rejects.toMatchObject(refused)
    await expect(core.rawEvidence.listMarketCandidates({ tenantId: tenant.id, businessId: business.id, scanLimit: 5, subject: MEMBER })).rejects.toMatchObject(refused)
  })

  it('a payload over the per-record cap arrives withheld, not truncated or trusted', async () => {
    const raw = await seedRaw({ title: 'Oversized listing', price: 1, notes: 'x'.repeat(256 * 1024 + 16) })
    const records = await core.rawEvidence.listMarketCandidates({ tenantId: tenant.id, businessId: business.id, scanLimit: 50, subject: OWNER })
    expect(records.find((row) => row.id === raw.id)).toMatchObject({ payloadJson: null, omitted: 'PAYLOAD_TOO_LARGE' })
  })

  it('audit writes one attributed row and refuses a mismatched Business', async () => {
    const payload = { businessId: business.id, candidates: 1, eligible: 1, translated: 1, unchanged: 0, failed: 0 }
    const before = await prisma.auditEvent.count({ where: { action: 'MARKET_TRANSLATION_RUN', entityId: business.id } })
    await core.audit.record({ entityType: 'MARKET_OBSERVATION', entityId: business.id, action: 'MARKET_TRANSLATION_RUN', payload })
    const rows = await prisma.auditEvent.findMany({ where: { action: 'MARKET_TRANSLATION_RUN', entityId: business.id }, orderBy: { occurredAt: 'desc' } })
    expect(rows).toHaveLength(before + 1)
    expect(rows[0]).toMatchObject({ actorType: 'MARKET_SERVICE', actorId: 'market-intelligence', tenantId: tenant.id, businessId: business.id })

    await expect(core.audit.record({ entityType: 'MARKET_OBSERVATION', entityId: 'another-business', action: 'MARKET_TRANSLATION_RUN', payload }))
      .rejects.toMatchObject({ status: 502, code: 'CORE_REJECTED' })
    expect(await prisma.auditEvent.count({ where: { action: 'MARKET_TRANSLATION_RUN', entityId: business.id } })).toBe(before + 1)
  })

  it('the Market service translates through the real façade end to end', async () => {
    process.env.MARKET_EXECUTOR = 'service'
    await seedRaw({ title: 'End-to-end listing', price: 450, currency: 'THB', condition: 'NEW' })
    const service = createMarketHttpServer({
      config: { apiToken: API_TOKEN, production: false, assumeExecutionOwner: false },
      storeFactory: memoryStoreFactory(),
      core,
      now: () => new Date('2026-09-25T00:00:00.000Z'),
    })
    const address = await service.listen(0, '127.0.0.1')
    const base = `http://127.0.0.1:${address.port}`
    const call = (method, path, { subject, body } = {}) => fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${API_TOKEN}`,
        ...(subject ? { 'x-zuri-subject': subject } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    try {
      const auditsBefore = await prisma.auditEvent.count({ where: { action: 'MARKET_TRANSLATION_RUN', entityId: business.id, actorType: 'MARKET_SERVICE' } })

      const run = await call('POST', '/v1/translations', { subject: OWNER, body: { businessId: business.id } })
      expect(run.status).toBe(200)
      const result = await run.json()
      expect(result.translated).toBeGreaterThanOrEqual(1)
      expect(result.failed.map((failure) => failure.reason)).toContain('RAW_PAYLOAD_TOO_LARGE')

      const feed = await call('GET', `/v1/observations?businessId=${encodeURIComponent(business.id)}`, { subject: MEMBER })
      expect(feed.status).toBe(200)
      expect(JSON.stringify(await feed.json())).toContain('End-to-end listing')

      const replay = await call('POST', '/v1/translations', { subject: OWNER, body: { businessId: business.id } })
      expect((await replay.json()).translated).toBe(0)

      expect(await prisma.auditEvent.count({ where: { action: 'MARKET_TRANSLATION_RUN', entityId: business.id, actorType: 'MARKET_SERVICE' } })).toBe(auditsBefore + 2)

      const notOwner = await call('POST', '/v1/translations', { subject: MEMBER, body: { businessId: business.id } })
      expect(notOwner.status).toBe(404)
      expect(await notOwner.json()).toEqual({ error: 'Business not found' })

      const anonymous = await call('POST', '/v1/translations', { body: { businessId: business.id } })
      expect(anonymous.status).toBe(401)
      expect(await anonymous.json()).toEqual({ error: 'AUTH_REQUIRED' })
    } finally {
      await service.close()
    }
  })
})
