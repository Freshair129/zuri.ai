// @req FR-226, FR-227 — the Integration lane's LINE channel-admin port: mint a
//   stateless channel access token, read bot information, and set, read and test
//   the webhook endpoint, every refusal mapped to a stable code.
// @spec SDD-098; ADR-089 D3, D7; SEC-030
// @tested tests/unit/platform/line-channel-admin-port.test.js
//
// LINE facts this port relies on (design §2.5, developers.line.biz, 2026-09-13):
//   POST /oauth2/v3/token (client_credentials)  → stateless token, 15 minutes,
//        cannot be revoked, no issuance limit                        (L4)
//   GET  /v2/bot/info                           → userId = webhook destination (L1)
//   PUT  /v2/bot/channel/webhook/endpoint       → HTTPS only, ≤ 500 characters (L2)
//   GET  /v2/bot/channel/webhook/endpoint       → { endpoint, active }        (L2)
//   POST /v2/bot/channel/webhook/test           → { success, statusCode, reason, … } (L3)
//
// What never leaves this module: a channel secret or a token, in a return value's
// enumerable fields, an error, or a log line. Provider error bodies are not read
// except where LINE's own contract puts the answer in them (the webhook test).
//
// Refusal codes:
//   LINE_CREDENTIALS_REJECTED  wrong Channel ID or wrong secret — deliberately one
//                              code for both, so a response cannot tell them apart
//   LINE_TOKEN_REJECTED        the pair is right and the override token is not
//   LINE_UNAVAILABLE           LINE 5xx, 429, timeout or network failure
//   LINE_WEBHOOK_SET_FAILED    the endpoint was refused (reason says why)
//   LINE_WEBHOOK_SIGNATURE_INVALID  LINE's test reached our route and our route
//                              refused the signature: the stored secret is not this channel's
//   LINE_WEBHOOK_TEST_FAILED:<reason>  COULD_NOT_CONNECT | ERROR_STATUS_CODE | REQUEST_TIMEOUT | UNCLASSIFIED
//   LINE_TOKEN_MINT_THROTTLED  the per-account mint limit (one a minute) is spent

export const LINE_API = Object.freeze({
  token: 'https://api.line.me/oauth2/v3/token',
  botInfo: 'https://api.line.me/v2/bot/info',
  webhookEndpoint: 'https://api.line.me/v2/bot/channel/webhook/endpoint',
  webhookTest: 'https://api.line.me/v2/bot/channel/webhook/test',
})

const TOKEN_MAX_AGE_MS = 13 * 60_000
const MIN_MINT_INTERVAL_MS = 60_000
const TOKEN_PATTERN = /^[A-Za-z0-9+/=._-]{20,4096}$/
const DESTINATION_PATTERN = /^U[0-9a-f]{32}$/
const TEST_REASONS = new Set(['COULD_NOT_CONNECT', 'ERROR_STATUS_CODE', 'REQUEST_TIMEOUT', 'UNCLASSIFIED'])

export function lineFailure(code, status, extra = {}) {
  const error = new Error(code)
  error.code = code
  error.status = status
  for (const [key, value] of Object.entries(extra)) error[key] = value
  return error
}

const rejected = () => lineFailure('LINE_CREDENTIALS_REJECTED', 422)
const unavailable = () => lineFailure('LINE_UNAVAILABLE', 503)

function text(value, max) {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : null
}

function hidden(target, key, value) {
  Object.defineProperty(target, key, { value, enumerable: false })
  return target
}

export function createLineChannelAdminPort({ fetchFn = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  if (typeof fetchFn !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw lineFailure('LINE_ADMIN_PORT_CONFIGURATION_INVALID', 503)
  }

  /** One attempt; a network failure or timeout is LINE_UNAVAILABLE, never retried here. */
  async function call(url, init) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetchFn(url, { ...init, redirect: 'error', signal: controller.signal })
    } catch {
      throw unavailable()
    } finally {
      clearTimeout(timer)
    }
  }

  async function json(response) {
    try {
      return await response.json()
    } catch {
      throw unavailable()
    }
  }

  const bearer = token => {
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw rejected()
    return { Authorization: `Bearer ${token}` }
  }

  function classifyStatus(status) {
    if (status === 429 || status >= 500) return unavailable()
    return rejected()
  }

  async function mintStatelessToken({ channelId, channelSecret } = {}) {
    if (typeof channelId !== 'string' || typeof channelSecret !== 'string') throw rejected()
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: channelId, client_secret: channelSecret }).toString()
    const response = await call(LINE_API.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (response.status !== 200) throw classifyStatus(response.status)
    const payload = await json(response)
    const expiresIn = Number(payload?.expires_in)
    if (typeof payload?.access_token !== 'string' || !TOKEN_PATTERN.test(payload.access_token) || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw unavailable()
    }
    return hidden({ expiresInSeconds: expiresIn }, 'accessToken', payload.access_token)
  }

  async function getBotInfo(accessToken) {
    const response = await call(LINE_API.botInfo, { method: 'GET', headers: bearer(accessToken) })
    if (response.status !== 200) throw classifyStatus(response.status)
    const payload = await json(response)
    if (typeof payload?.userId !== 'string' || !DESTINATION_PATTERN.test(payload.userId)) throw unavailable()
    return {
      destination: payload.userId,
      basicId: text(payload.basicId, 100),
      premiumId: text(payload.premiumId, 100),
      displayName: text(payload.displayName, 200),
      pictureUrl: typeof payload.pictureUrl === 'string' && /^https:\/\//.test(payload.pictureUrl) ? payload.pictureUrl.slice(0, 1000) : null,
      chatMode: text(payload.chatMode, 20),
      markAsReadMode: text(payload.markAsReadMode, 20),
    }
  }

  /**
   * Prove a Channel ID and secret with LINE (and an override token separately).
   * The minted token is returned non-enumerable for immediate use and never cached here.
   */
  async function validateChannel({ channelId, channelSecret, channelAccessToken } = {}) {
    const minted = await mintStatelessToken({ channelId, channelSecret })
    let bot
    try {
      bot = await getBotInfo(minted.accessToken)
    } catch (error) {
      throw error.code === 'LINE_UNAVAILABLE' ? error : rejected()
    }
    if (channelAccessToken !== undefined) {
      let viaOverride
      try {
        viaOverride = await getBotInfo(channelAccessToken)
      } catch (error) {
        throw error.code === 'LINE_UNAVAILABLE' ? error : lineFailure('LINE_TOKEN_REJECTED', 422)
      }
      // A valid token for a different channel is still the wrong token.
      if (viaOverride.destination !== bot.destination) throw lineFailure('LINE_TOKEN_REJECTED', 422)
    }
    return hidden({ destination: bot.destination, bot, validationCode: 'LINE_OK', expiresInSeconds: minted.expiresInSeconds }, 'accessToken', minted.accessToken)
  }

  async function setWebhookEndpoint({ accessToken, endpoint } = {}) {
    let url
    try {
      url = new URL(endpoint)
    } catch {
      throw lineFailure('LINE_WEBHOOK_SET_FAILED', 422, { reason: 'ENDPOINT_INVALID' })
    }
    if (url.protocol !== 'https:') throw lineFailure('LINE_WEBHOOK_SET_FAILED', 422, { reason: 'ENDPOINT_NOT_HTTPS' })
    if (endpoint.length > 500) throw lineFailure('LINE_WEBHOOK_SET_FAILED', 422, { reason: 'ENDPOINT_TOO_LONG' })
    const response = await call(LINE_API.webhookEndpoint, {
      method: 'PUT',
      headers: { ...bearer(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    })
    if (response.status === 200) return { endpoint, status: 'SET' }
    if (response.status === 400) throw lineFailure('LINE_WEBHOOK_SET_FAILED', 422, { reason: 'LINE_REFUSED_ENDPOINT' })
    throw classifyStatus(response.status)
  }

  async function getWebhookEndpoint({ accessToken } = {}) {
    const response = await call(LINE_API.webhookEndpoint, { method: 'GET', headers: bearer(accessToken) })
    if (response.status === 404) return { endpoint: null, active: false }
    if (response.status !== 200) throw classifyStatus(response.status)
    const payload = await json(response)
    return {
      endpoint: typeof payload?.endpoint === 'string' ? payload.endpoint.slice(0, 500) : null,
      active: payload?.active === true,
    }
  }

  /**
   * Run LINE's webhook test. Never throws for a failed test — the outcome is the
   * answer — only for a refused call or an unreachable LINE.
   */
  async function testWebhookEndpoint({ accessToken, endpoint } = {}) {
    const response = await call(LINE_API.webhookTest, {
      method: 'POST',
      headers: { ...bearer(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify(endpoint ? { endpoint } : {}),
    })
    if (response.status === 400) {
      return { success: false, code: 'LINE_WEBHOOK_TEST_FAILED:UNCLASSIFIED', reason: 'UNCLASSIFIED', statusCode: null, detail: 'ENDPOINT_NOT_SET' }
    }
    if (response.status !== 200) throw classifyStatus(response.status)
    return classifyWebhookTest(await json(response))
  }

  return Object.freeze({ mintStatelessToken, getBotInfo, validateChannel, setWebhookEndpoint, getWebhookEndpoint, testWebhookEndpoint })
}

/** Map LINE's webhook test body to one outcome with a code (FR-227). */
export function classifyWebhookTest(body) {
  const statusCode = Number.isInteger(body?.statusCode) ? body.statusCode : null
  const detail = typeof body?.detail === 'string' ? body.detail.slice(0, 200) : null
  const testedAt = typeof body?.timestamp === 'string' ? body.timestamp : null
  if (body?.success === true) return { success: true, code: 'LINE_OK', reason: 'OK', statusCode, detail, testedAt }
  // Our route answers 401 exactly when the signature LINE computed with the real
  // channel secret does not verify against the secret we hold (D7).
  if (statusCode === 401) {
    return { success: false, code: 'LINE_WEBHOOK_SIGNATURE_INVALID', reason: 'ERROR_STATUS_CODE', statusCode, detail, testedAt }
  }
  const reason = TEST_REASONS.has(body?.reason) ? body.reason : 'UNCLASSIFIED'
  return { success: false, code: `LINE_WEBHOOK_TEST_FAILED:${reason}`, reason, statusCode, detail, testedAt }
}

/**
 * Stateless tokens for vault-backed accounts (SDD-098): cached per credential
 * version for at most 13 minutes, minted at most once a minute per account, and
 * dropped for an account on rotation or revocation.
 */
export function createLineChannelTokenCache({
  adminPort = createLineChannelAdminPort(),
  now = () => Date.now(),
  maxAgeMs = TOKEN_MAX_AGE_MS,
  minMintIntervalMs = MIN_MINT_INTERVAL_MS,
} = {}) {
  const entries = new Map()
  const inflight = new Map()
  const lastMintAt = new Map()
  const keyOf = (accountKey, credentialVersion) => `${accountKey} ${credentialVersion}`

  function invalidate(accountKey) {
    for (const key of [...entries.keys()]) if (key.startsWith(`${accountKey} `)) entries.delete(key)
  }

  async function accessTokenFor({ accountKey, credentialVersion, channelId, channelSecret }) {
    if (typeof accountKey !== 'string' || !accountKey || typeof credentialVersion !== 'string' || !credentialVersion) throw rejected()
    const key = keyOf(accountKey, credentialVersion)
    const cached = entries.get(key)
    if (cached && cached.expiresAt > now()) return cached.token
    if (inflight.has(key)) return inflight.get(key)
    const last = lastMintAt.get(accountKey)
    if (last !== undefined && now() - last < minMintIntervalMs) {
      throw lineFailure('LINE_TOKEN_MINT_THROTTLED', 503, { retryAfterSeconds: Math.ceil((minMintIntervalMs - (now() - last)) / 1000) })
    }
    lastMintAt.set(accountKey, now())
    const pending = (async () => {
      const minted = await adminPort.mintStatelessToken({ channelId, channelSecret })
      const mintedAt = now()
      const lifetime = Math.min(maxAgeMs, minted.expiresInSeconds * 1000 - 2 * 60_000)
      invalidate(accountKey)
      if (lifetime > 0) entries.set(key, { token: minted.accessToken, expiresAt: mintedAt + lifetime })
      return minted.accessToken
    })()
    inflight.set(key, pending)
    try {
      return await pending
    } finally {
      inflight.delete(key)
    }
  }

  return Object.freeze({ accessTokenFor, invalidate, size: () => entries.size })
}

let processTokenCache = null
/** The token cache this process shares between the runtime and credential writes. */
export function processLineChannelTokenCache() {
  processTokenCache ??= createLineChannelTokenCache()
  return processTokenCache
}
