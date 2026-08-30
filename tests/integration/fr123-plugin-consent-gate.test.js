import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import prisma from '@/lib/db'
import { generateSessionToken } from '@/modules/identity/auth-service'
import { GET as authorizeGet, POST as authorizePost } from '@/app/api/plugin/auth/authorize/route'
import { POST as tokenPost } from '@/app/api/plugin/auth/token/route'
import { buildPluginConsent } from '@/modules/identity/plugin-consent-view'
import {
  issuePluginConsentCsrfToken,
  pluginConsentSessionBinding,
  signPluginConsentRequest,
} from '@/modules/identity/plugin-consent'

// @req FR-123 — the consent gate, proved as behaviour rather than as structure.
// Every assertion below is about what does or does not reach the database: a
// test that only checked the new code exists would prove nothing about the hole
// it was written to close.
// @spec ADR-052 D4, SDD-074, SEC-022
// @tested tests/integration/fr123-plugin-consent-gate.test.js

const SESSION_SECRET = 'fr123-consent-secret-that-is-long-enough-0123456789'
const CLIENT_ID = 'zuri-plugin-consent-test'
const REDIRECT_URI = 'http://127.0.0.1:43123/callback'
const OTHER_REDIRECT_URI = 'http://127.0.0.1:43199/other'
const CODE_VERIFIER = randomBytes(32).toString('base64url')
const CODE_CHALLENGE = createHash('sha256').update(CODE_VERIFIER, 'utf8').digest('base64url')
const STATE = 'state_consent_gate_0001'
const INSTALLATION_ID = 'install_consent_gate_0001'

const query = new URLSearchParams({
  response_type: 'code',
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  code_challenge: CODE_CHALLENGE,
  code_challenge_method: 'S256',
  state: STATE,
  installation_id: INSTALLATION_ID,
}).toString()

const AUTHORIZE_URL = `http://local/api/plugin/auth/authorize?${query}`

let personId
let sessionCookieValue
let cookieHeader

function post(fields) {
  const body = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) body.set(key, value)
  }
  return new Request('http://local/api/plugin/auth/authorize', { method: 'POST', headers: { cookie: cookieHeader }, body })
}

function codesForThisPerson() {
  return prisma.pluginAuthorizationCode.count({ where: { personId } })
}

/** Re-encode a signed request token with one claim changed, signature untouched. */
function tamper(token, changes) {
  const [prefix, payload, signature] = token.split('.')
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  const forged = Buffer.from(JSON.stringify({ ...claims, ...changes }), 'utf8').toString('base64url')
  return `${prefix}.${forged}.${signature}`
}

async function freshConsent() {
  const result = await buildPluginConsent({
    searchParams: Object.fromEntries(new URLSearchParams(query).entries()),
    cookieHeader,
    sessionCookieValue,
  })
  expect(result.state).toBe('READY')
  return result.consent
}

const savedEnv = {}

afterAll(() => {
  // Vitest may reuse a worker for the next file; leaving plugin client
  // configuration set would make an unrelated suite pass for the wrong reason.
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

beforeAll(async () => {
  for (const key of ['ZURI_SESSION_SECRET', 'ZURI_PLUGIN_CLIENT_ID', 'ZURI_PLUGIN_REDIRECT_URIS', 'ZURI_PLUGIN_CLIENT_NAME']) {
    savedEnv[key] = process.env[key]
  }
  process.env.ZURI_SESSION_SECRET = SESSION_SECRET
  process.env.ZURI_PLUGIN_CLIENT_ID = CLIENT_ID
  process.env.ZURI_PLUGIN_REDIRECT_URIS = `${REDIRECT_URI},${OTHER_REDIRECT_URI}`
  process.env.ZURI_PLUGIN_CLIENT_NAME = 'Zuri Consent Test Harness'

  const person = await prisma.person.upsert({
    where: { code: 'PER-FR123-CONSENT' },
    update: {},
    create: { code: 'PER-FR123-CONSENT', displayName: 'FR-123 Consent Subject', email: 'fr123-consent@example.test' },
  })
  personId = person.id
  sessionCookieValue = generateSessionToken(personId, { secret: SESSION_SECRET })
  cookieHeader = `zuri_session=${sessionCookieValue}`
})

beforeEach(async () => {
  await prisma.pluginSession.deleteMany({ where: { personId } })
  await prisma.pluginAuthorizationCode.deleteMany({ where: { personId } })
})

describe('FR-123 — GET no longer mints', () => {
  // The defect this closes: `zuri_session` is SameSite=Lax, and Lax sends the
  // cookie on a top-level GET navigation, so a link on any page minted a code
  // for a signed-in person with nothing shown and nothing asked.
  it('answers a fully valid, fully authenticated GET with a consent redirect and creates no code', async () => {
    const before = await codesForThisPerson()

    const response = await authorizeGet(new Request(AUTHORIZE_URL, { headers: { cookie: cookieHeader } }))

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location'))
    expect(location.pathname).toBe('/plugin/authorize')
    expect(location.searchParams.get('client_id')).toBe(CLIENT_ID)
    // The claim is about the database, not about the response shape.
    expect(await codesForThisPerson()).toBe(before)
    expect(await codesForThisPerson()).toBe(0)
  })

  it('does not reach the database at all on GET, so the redirect leaks nothing about the session', async () => {
    const response = await authorizeGet(new Request(AUTHORIZE_URL))
    expect(response.status).toBe(302)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await codesForThisPerson()).toBe(0)
  })
})

describe('FR-123 — the consent screen is built from server-derived facts', () => {
  it('names the plugin from registered configuration and the account from the session', async () => {
    const consent = await freshConsent()
    expect(consent.pluginName).toBe('Zuri Consent Test Harness')
    expect(consent.clientId).toBe(CLIENT_ID)
    expect(consent.redirectUri).toBe(REDIRECT_URI)
    expect(consent.account.id).toBe(personId)
    expect(typeof consent.csrfToken).toBe('string')
    expect(typeof consent.requestToken).toBe('string')
  })

  it('refuses to render for parameters the mint would refuse, and names no redirect target', async () => {
    const result = await buildPluginConsent({
      searchParams: { ...Object.fromEntries(new URLSearchParams(query).entries()), redirect_uri: 'http://127.0.0.1:9/not-registered' },
      cookieHeader,
      sessionCookieValue,
    })
    expect(result.state).toBe('INVALID_REQUEST')
    expect(result.consent).toBeUndefined()
  })

  it('refuses to render without a browser session', async () => {
    const result = await buildPluginConsent({
      searchParams: Object.fromEntries(new URLSearchParams(query).entries()),
      cookieHeader: '',
      sessionCookieValue: null,
    })
    expect(result.state).toBe('AUTH_REQUIRED')
  })
})

describe('FR-123 — only an approved POST mints', () => {
  it('refuses a POST with no anti-CSRF token and writes nothing', async () => {
    const consent = await freshConsent()
    const response = await authorizePost(post({ request_token: consent.requestToken, decision: 'approve' }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'INVALID_REQUEST' })
    expect(await codesForThisPerson()).toBe(0)
  })

  it('refuses a POST whose anti-CSRF token belongs to a different session', async () => {
    const consent = await freshConsent()
    // A correctly-formed token, correctly signed — for somebody else's session.
    // This is the shape an attacker who could read one victim's CSRF token and
    // replay it at another victim would have.
    const foreign = issuePluginConsentCsrfToken({
      sessionBinding: pluginConsentSessionBinding('a different session cookie entirely'),
    })
    expect(foreign).not.toBe(consent.csrfToken)

    const response = await authorizePost(post({ csrf_token: foreign, request_token: consent.requestToken, decision: 'approve' }))

    expect(response.status).toBe(400)
    expect(await codesForThisPerson()).toBe(0)
  })

  // One test per field this handler claims to verify. Each mutates exactly one
  // claim inside the signed token and leaves the rest alone.
  for (const [field, forged] of [
    ['redirect_uri', OTHER_REDIRECT_URI],
    ['client_id', 'some-other-client'],
    ['code_challenge', createHash('sha256').update('a different verifier', 'utf8').digest('base64url')],
    ['state', 'state_the_person_never_saw_01'],
    ['installation_id', 'install_someone_elses_0001'],
    ['principal_id', 'not-this-person'],
  ]) {
    it(`refuses a valid session presenting a signed token with a tampered ${field} and writes nothing`, async () => {
      const consent = await freshConsent()
      const response = await authorizePost(post({
        csrf_token: consent.csrfToken,
        request_token: tamper(consent.requestToken, { [field]: forged }),
        decision: 'approve',
      }))

      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(await codesForThisPerson()).toBe(0)
    })
  }

  // Not redundant with the tamper cases above: this token carries a genuine
  // signature from this server. It is refused because every field is re-checked
  // against live configuration on approval, not merely because the HMAC failed.
  it('refuses a genuinely signed token whose redirect_uri is not registered', async () => {
    const consent = await freshConsent()
    const binding = pluginConsentSessionBinding(sessionCookieValue)
    const signed = signPluginConsentRequest({
      parameters: {
        client_id: CLIENT_ID,
        redirect_uri: 'http://127.0.0.1:9/never-registered',
        code_challenge: CODE_CHALLENGE,
        code_challenge_method: 'S256',
        state: STATE,
        installation_id: INSTALLATION_ID,
      },
      principalId: personId,
      sessionBinding: binding,
    })

    const response = await authorizePost(post({ csrf_token: consent.csrfToken, request_token: signed, decision: 'approve' }))

    expect(response.status).toBe(400)
    expect(await codesForThisPerson()).toBe(0)
  })

  it('refuses an expired signed request token and writes nothing', async () => {
    const consent = await freshConsent()
    const binding = pluginConsentSessionBinding(sessionCookieValue)
    const expired = signPluginConsentRequest({
      parameters: {
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code_challenge: CODE_CHALLENGE,
        code_challenge_method: 'S256',
        state: STATE,
        installation_id: INSTALLATION_ID,
      },
      principalId: personId,
      sessionBinding: binding,
      now: Date.now() - 6 * 60 * 1000,
    })

    const response = await authorizePost(post({ csrf_token: consent.csrfToken, request_token: expired, decision: 'approve' }))

    expect(response.status).toBe(400)
    expect(await codesForThisPerson()).toBe(0)
  })

  it('refuses a POST with no browser session even when both tokens are well formed', async () => {
    const consent = await freshConsent()
    const body = new FormData()
    body.set('csrf_token', consent.csrfToken)
    body.set('request_token', consent.requestToken)
    body.set('decision', 'approve')

    const response = await authorizePost(new Request('http://local/api/plugin/auth/authorize', { method: 'POST', body }))

    expect(response.status).toBe(401)
    expect(await codesForThisPerson()).toBe(0)
  })

  it('refuses a submission with neither approve nor deny rather than defaulting to approve', async () => {
    const consent = await freshConsent()
    const response = await authorizePost(post({ csrf_token: consent.csrfToken, request_token: consent.requestToken }))

    expect(response.status).toBe(400)
    expect(await codesForThisPerson()).toBe(0)
  })
})

describe('FR-123 — refusal is an answer', () => {
  it('returns access_denied with the original state and mints nothing', async () => {
    const consent = await freshConsent()
    const response = await authorizePost(post({
      csrf_token: consent.csrfToken,
      request_token: consent.requestToken,
      decision: 'deny',
    }))

    expect(response.status).toBe(303)
    const location = new URL(response.headers.get('location'))
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_URI)
    expect(location.searchParams.get('error')).toBe('access_denied')
    expect(location.searchParams.get('state')).toBe(STATE)
    expect(location.searchParams.get('code')).toBeNull()
    expect(await codesForThisPerson()).toBe(0)
  })
})

describe('FR-123 — the approved path still works end to end', () => {
  async function approve() {
    const consent = await freshConsent()
    const response = await authorizePost(post({
      csrf_token: consent.csrfToken,
      request_token: consent.requestToken,
      decision: 'approve',
    }))
    expect(response.status).toBe(303)
    return new URL(response.headers.get('location'))
  }

  it('mints exactly one code, returns it with the original state, and the token endpoint accepts it', async () => {
    const location = await approve()

    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_URI)
    expect(location.searchParams.get('state')).toBe(STATE)
    const code = location.searchParams.get('code')
    expect(code).toBeTruthy()
    expect(await codesForThisPerson()).toBe(1)

    const tokenResponse = await tokenPost(new Request('http://local/api/plugin/auth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code_verifier: CODE_VERIFIER,
        installation_id: INSTALLATION_ID,
      }),
    }))

    expect(tokenResponse.status).toBe(200)
    const body = await tokenResponse.json()
    expect(body.token_type).toBe('Bearer')
    expect(body.principal_id).toBe(personId)
    expect(body).not.toHaveProperty('refresh_token')
  })

  it('yields exactly one session when the consented code is redeemed concurrently', async () => {
    const location = await approve()
    const code = location.searchParams.get('code')

    const request = () => tokenPost(new Request('http://local/api/plugin/auth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code_verifier: CODE_VERIFIER,
        installation_id: INSTALLATION_ID,
      }),
    }))

    const results = await Promise.all([request(), request()])
    const statuses = results.map((response) => response.status).sort()
    expect(statuses).toEqual([200, 400])
    expect(await prisma.pluginSession.count({ where: { personId, revokedAt: null } })).toBe(1)
  })
})
