// @req FR-266 — the Business owner's model provider API key, entered in the browser:
//   the FR-224 write gate refuses before the provider is called, a rejected key
//   stores nothing, a provider outage stores nothing, a stored key never appears in
//   any response, rotation and provider change reuse the one connection, and
//   revocation leaves the next answer with nothing to resolve.
// @req FR-265 — the readiness journey's fifth step reads this credential's evidence.
// @spec ADR-100 D4, D5; ADR-089 D2, D4, D5; SEC-030; SEC-033; SDD-101; SDD-106
// @tested tests/integration/fr266-model-provider-credential.test.js
import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { AUTH_SESSION_COOKIE, hashSessionToken } from '@/modules/identity/auth-service'
import { MODEL_PROVIDER_API } from '@/platform/integrations/providers/model/model-provider-admin-port'
import { findLeaks, secretNeedles } from '../helpers/credential-vault-fixtures'

const { resolveRequestViewer } = vi.hoisted(() => ({ resolveRequestViewer: vi.fn() }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))

const { GET: STATUS, POST: PROVISION } = await import('@/app/api/integration/model-providers/route')
const { POST: REVOKE } = await import('@/app/api/integration/model-providers/[id]/revoke/route')
const { POST: VALIDATE } = await import('@/app/api/integration/model-providers/[id]/validate/route')
const { resolveBusinessModelCredential } = await import('@/modules/integration/application/model-provider-credential-service')
const { lineOaReadinessJourney } = await import('@/modules/line-oa-studio/domain/line-oa-readiness-journey')

const ENV_KEYS = ['ZURI_SECRET_STORE', 'ZURI_SECRET_KEK', 'ZURI_SECRET_KEK_VERSION']
const savedEnv = {}
const responses = []
let business, person, viewer, sessionToken

// The stub provider behaves like the real per-model endpoints: the key is checked
// first (401 for one not handed out by `key()`), then the model (404 for one this
// provider does not offer). The URL must be the provider's own per-model endpoint.
const goodKeys = new Set()
const fetchCalls = []
let providerStatus = null // when set, every probe answers with this status instead
const AVAILABLE_MODELS = {
  anthropic: new Set(['claude-sonnet-5']),
  openai: new Set(['gpt-4o-mini']),
  gemini: new Set(['gemini-2.0-flash']),
  groq: new Set(['llama-3.3-70b-versatile']),
}
async function fakeFetch(url, init) {
  fetchCalls.push({ url, headers: init?.headers ?? {} })
  const reply = (status) => ({ status, ok: status < 300, json: async () => ({}) })
  if (providerStatus) return reply(providerStatus)
  const provider = Object.keys(MODEL_PROVIDER_API).find((code) => url.startsWith(MODEL_PROVIDER_API[code]))
  if (!provider) return reply(404)
  const presented = init?.headers?.['x-api-key']
    ?? init?.headers?.['x-goog-api-key']
    ?? String(init?.headers?.authorization ?? '').replace(/^Bearer /, '')
  if (!goodKeys.has(presented)) return reply(401)
  const model = decodeURIComponent(url.slice(MODEL_PROVIDER_API[provider].length))
  return reply(AVAILABLE_MODELS[provider].has(model) ? 200 : 404)
}

function key(good = true) {
  const value = `sk-${randomBytes(24).toString('hex')}`
  if (good) goodKeys.add(value)
  return value
}

async function call(handler, url, body, { id, token = sessionToken, method = 'POST' } = {}) {
  const request = new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { cookie: `${AUTH_SESSION_COOKIE}=${token}` } : {}) },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
  })
  const response = await handler(request, { params: { id } })
  const json = await response.json()
  responses.push(json)
  return { status: response.status, json, headers: response.headers }
}

const provision = (body) => call(PROVISION, 'http://local/api/integration/model-providers', body)
const status = () => call(STATUS, `http://local/api/integration/model-providers?businessId=${business.id}`, null, { method: 'GET' })

async function newSession({ elevatedFor = 900, assuranceLevel = 'AAL2' } = {}) {
  const token = randomBytes(24).toString('base64url')
  await prisma.session.create({ data: {
    personId: person.id, tokenHash: hashSessionToken(token), status: 'ACTIVE', assuranceLevel,
    elevatedUntil: elevatedFor === null ? null : new Date(Date.now() + elevatedFor * 1000),
    expiresAt: new Date(Date.now() + 3600_000),
  } })
  return token
}

describe('model provider credential (FR-266)', () => {
  beforeAll(async () => {
    for (const name of ENV_KEYS) savedEnv[name] = process.env[name]
    process.env.ZURI_SECRET_STORE = 'envelope'
    process.env.ZURI_SECRET_KEK = randomBytes(32).toString('hex')
    process.env.ZURI_SECRET_KEK_VERSION = '1'
    vi.stubGlobal('fetch', fakeFetch)
    const portfolio = await createPortfolio({ code: 'PF-MODEL-KEY', name: 'Model key' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-MODEL-KEY', name: 'Model key' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-MODEL-KEY', name: 'Model key' })
    person = await prisma.person.create({ data: { code: `PER-${randomUUID().slice(0, 8)}`, displayName: 'Key owner' } })
    await prisma.mfaFactor.create({ data: { personId: person.id, type: 'TOTP', secret: 'mfa.v0.sealed-in-test.placeholder.value', status: 'ACTIVE' } })
    viewer = makeViewer({
      principal: { id: person.id, code: person.code, displayName: person.displayName },
      visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['line-oa'],
    })
  })

  afterAll(() => {
    vi.unstubAllGlobals()
    for (const name of ENV_KEYS) {
      if (savedEnv[name] === undefined) delete process.env[name]
      else process.env[name] = savedEnv[name]
    }
  })

  beforeEach(async () => {
    resolveRequestViewer.mockResolvedValue(viewer)
    fetchCalls.length = 0
    providerStatus = null
    await prisma.rateLimitBucket.deleteMany({})
    await prisma.integrationConnection.deleteMany({ where: { businessId: business.id } })
    sessionToken = await newSession()
  })

  it('stores a validated key and answers metadata only, with no-store and no display hint', async () => {
    const apiKey = key()
    const { status: code, json, headers } = await provision({ businessId: business.id, provider: 'anthropic', model: 'claude-sonnet-5', apiKey })
    expect(code).toBe(200)
    expect(headers.get('cache-control')).toBe('no-store')
    expect(json).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5', providerChanged: false,
      credential: { status: 'ACTIVE', version: 1, secretStore: 'ENVELOPE' } })
    // A model key has no non-secret identifier, so the hint is null — never four
    // characters of the key itself (SDD-101).
    expect(json.credential.displayHint).toBeNull()
    expect(findLeaks([JSON.stringify(json)], secretNeedles({ apiKey }))).toEqual([])
  })

  it('refuses before the provider is called when the step-up gate is not satisfied', async () => {
    const token = await newSession({ elevatedFor: null, assuranceLevel: 'AAL1' })
    const { status: code, json } = await call(PROVISION, 'http://local/api/integration/model-providers',
      { businessId: business.id, provider: 'anthropic', model: 'claude-sonnet-5', apiKey: key() }, { token })
    expect({ code, error: json.error }).toEqual({ code: 403, error: 'ASSURANCE_LEVEL_INSUFFICIENT' })
    expect(fetchCalls).toEqual([])
  })

  it('stores nothing when the provider rejects the key, and nothing when the provider is unreachable', async () => {
    // Scoped to this suite's Business: the run shares one SQLite file across every
    // test file, so a bare `count()` would be asserting on other suites' fixtures.
    const stored = () => prisma.integrationCredential.count({ where: { connection: { businessId: business.id } } })

    const rejected = await provision({ businessId: business.id, provider: 'anthropic', model: 'claude-sonnet-5', apiKey: key(false) })
    expect({ status: rejected.status, error: rejected.json.error }).toEqual({ status: 422, error: 'MODEL_KEY_REJECTED' })
    expect(await stored()).toBe(0)

    providerStatus = 503
    const unavailable = await provision({ businessId: business.id, provider: 'anthropic', model: 'claude-sonnet-5', apiKey: key() })
    expect({ status: unavailable.status, error: unavailable.json.error }).toEqual({ status: 503, error: 'MODEL_PROVIDER_UNAVAILABLE' })
    expect(await stored()).toBe(0)
  })

  it('sends the key in the header each provider expects, never in the URL', async () => {
    await provision({ businessId: business.id, provider: 'gemini', model: 'gemini-2.0-flash', apiKey: key() })
    const probe = fetchCalls.at(-1)
    expect(probe.url).toBe(`${MODEL_PROVIDER_API.gemini}gemini-2.0-flash`)
    expect(probe.url).not.toContain('sk-')
    expect(probe.headers['x-goog-api-key']).toMatch(/^sk-/)
  })

  it('rotates and changes provider on the one connection rather than creating a second', async () => {
    await provision({ businessId: business.id, provider: 'anthropic', model: 'claude-sonnet-5', apiKey: key() })
    const rotated = await provision({ businessId: business.id, provider: 'anthropic', model: 'claude-sonnet-5', apiKey: key() })
    expect(rotated.json.credential.version).toBeGreaterThan(1)
    const changed = await provision({ businessId: business.id, provider: 'openai', model: 'gpt-4o-mini', apiKey: key() })
    expect(changed.json).toMatchObject({ provider: 'openai', providerChanged: true })
    expect(await prisma.integrationConnection.count({ where: { businessId: business.id, purpose: 'MODEL_PROVIDER' } })).toBe(1)
    expect((await status()).json.modelCredential).toMatchObject({ provider: 'openai', model: 'gpt-4o-mini', status: 'ACTIVE' })
  })

  it('resolves for the worker, and fails closed rather than falling back once a key exists', async () => {
    const scope = { tenantId: business.tenantId, businessId: business.id }
    // Absence is the one case the worker may fall back on (ADR-100 D5).
    expect(await resolveBusinessModelCredential(scope)).toBeNull()

    const apiKey = key()
    const { json } = await provision({ businessId: business.id, provider: 'anthropic', model: 'claude-sonnet-5', apiKey })
    const resolved = await resolveBusinessModelCredential(scope)
    expect(resolved).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5' })
    expect(resolved.apiKey).toBe(apiKey)
    // Non-enumerable, so a spread or a JSON log cannot carry it out (SEC-030).
    expect(Object.keys(resolved)).toEqual(['provider', 'model'])
    expect(JSON.stringify(resolved)).not.toContain(apiKey)

    await call(REVOKE, 'http://local/api/integration/model-providers/x/revoke',
      { reason: 'rotated out of band', confirmation: 'REVOKE' }, { id: json.connectionId })
    await expect(resolveBusinessModelCredential(scope)).rejects.toThrow('MODEL_CREDENTIAL_NOT_RESOLVABLE')
  })

  it('records a failed re-validation instead of leaving an older success standing', async () => {
    const apiKey = key()
    const { json } = await provision({ businessId: business.id, provider: 'anthropic', model: 'claude-sonnet-5', apiKey })
    expect((await status()).json.modelCredential.lastValidatedAt).not.toBeNull()

    goodKeys.delete(apiKey)
    const revalidated = await call(VALIDATE, 'http://local/api/integration/model-providers/x/validate', {}, { id: json.connectionId })
    expect({ status: revalidated.status, error: revalidated.json.error }).toEqual({ status: 422, error: 'MODEL_KEY_REJECTED' })
    const credential = await prisma.integrationCredential.findUnique({ where: { connectionId: json.connectionId } })
    expect(credential.lastValidationCode).toBe('MODEL_KEY_REJECTED')

    // The readiness step reads that evidence: a key whose last validation failed
    // is not a completed step (FR-265). Fed the status the API actually returns.
    // This used to be handed a hand-made `{ status: 'REVOKED', lastValidatedAt: null }`,
    // which passed for a reason unrelated to the failure — and so missed that the
    // real record (ACTIVE, just stamped `lastValidatedAt`) read as ready.
    const real = (await status()).json.modelCredential
    expect(real).toMatchObject({ status: 'ACTIVE', lastValidationCode: 'MODEL_KEY_REJECTED' })
    expect(real.lastValidatedAt).not.toBeNull()
    const account = { id: 'oa', businessId: business.id, tenantId: business.tenantId }
    const journey = lineOaReadinessJourney({ account, modelCredential: real })
    expect(journey.modelKeyReady).toBe(false)
    expect(journey.steps.find(step => step.id === 'model-key').status).toBe('ACTION_REQUIRED')
  })

  it('stores nothing when the key works but the model does not, and says it was the model', async () => {
    const stored = () => prisma.integrationCredential.count({ where: { connection: { businessId: business.id } } })
    const typo = await provision({ businessId: business.id, provider: 'openai', model: 'gpt-4o-minni', apiKey: key() })
    expect({ status: typo.status, error: typo.json.error }).toEqual({ status: 422, error: 'MODEL_NOT_FOUND' })
    expect(await stored()).toBe(0)
    // The same key with the right model is accepted: it was the model, not the key.
    const fixed = await provision({ businessId: business.id, provider: 'openai', model: 'gpt-4o-mini', apiKey: key() })
    expect(fixed.status).toBe(200)
    expect((await status()).json.modelCredential).toMatchObject({ model: 'gpt-4o-mini', lastValidationCode: 'MODEL_KEY_VALIDATED:OPENAI' })
  })

  it('records a model the provider has since withdrawn when the stored key is re-validated', async () => {
    const { json } = await provision({ businessId: business.id, provider: 'openai', model: 'gpt-4o-mini', apiKey: key() })
    AVAILABLE_MODELS.openai.delete('gpt-4o-mini')
    try {
      const revalidated = await call(VALIDATE, 'http://local/api/integration/model-providers/x/validate', {}, { id: json.connectionId })
      expect({ status: revalidated.status, error: revalidated.json.error }).toEqual({ status: 422, error: 'MODEL_NOT_FOUND' })
      const real = (await status()).json.modelCredential
      expect(real.lastValidationCode).toBe('MODEL_NOT_FOUND')
      const journey = lineOaReadinessJourney({ account: { id: 'oa', businessId: business.id, tenantId: business.tenantId }, modelCredential: real })
      expect(journey.modelKeyReady).toBe(false)
    } finally {
      AVAILABLE_MODELS.openai.add('gpt-4o-mini')
    }
  })

  it('accepts a correct key pasted with the whitespace a copy often carries', async () => {
    // The owner's refusal on 2026-09-21: a trailing newline or space failed the key
    // pattern, and the message blamed the key's format.
    const apiKey = key()
    for (const pasted of [`${apiKey}\n`, ` ${apiKey} `, `${apiKey}\r\n`]) {
      const result = await provision({ businessId: business.id, provider: 'openai', model: 'gpt-4o-mini', apiKey: pasted })
      expect(result.status).toBe(200)
    }
    // What reached the provider was the trimmed key, not the pasted one.
    expect(fetchCalls.at(-1).headers.authorization).toBe(`Bearer ${apiKey}`)
  })

  it('refuses a Business the viewer does not own, shaped as not found', async () => {
    resolveRequestViewer.mockResolvedValue(makeViewer({
      principal: { id: person.id, code: person.code, displayName: person.displayName },
      visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: ['line-oa'],
    }))
    const { status: code } = await provision({ businessId: business.id, provider: 'anthropic', model: 'claude-sonnet-5', apiKey: key() })
    expect(code).toBe(404)
    expect(fetchCalls).toEqual([])
  })

  it('never lets any response or audit payload carry the key', async () => {
    const apiKey = key()
    const { json } = await provision({ businessId: business.id, provider: 'anthropic', model: 'claude-sonnet-5', apiKey })
    await call(VALIDATE, 'http://local/api/integration/model-providers/x/validate', {}, { id: json.connectionId })
    const audits = await prisma.auditEvent.findMany({ where: { entityId: json.connectionId } })
    expect(audits.length).toBeGreaterThan(0)
    const haystacks = [...responses.map(r => JSON.stringify(r)), ...audits.map(a => a.payloadJson)]
    expect(findLeaks(haystacks, secretNeedles({ apiKey }))).toEqual([])
  })
})
