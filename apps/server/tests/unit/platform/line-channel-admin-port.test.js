// @req FR-226, FR-227 — the LINE channel-admin port against stubbed LINE endpoints:
//   token minting, bot information, override tokens, webhook set / get / test, and
//   the stateless-token cache.
// @spec SDD-098; ADR-089 D3, D7 and proof 5; SEC-030
// @tested tests/unit/platform/line-channel-admin-port.test.js
import { describe, expect, it, vi } from 'vitest'
import {
  LINE_API,
  classifyWebhookTest,
  createLineChannelAdminPort,
  createLineChannelTokenCache,
} from '@/platform/integrations/providers/line/line-channel-admin-port'
import { errorTrace, generateLineChannelBundle } from '../../helpers/credential-vault-fixtures'

const DESTINATION = `U${'1a'.repeat(16)}`
const OTHER_DESTINATION = `U${'2b'.repeat(16)}`

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body }
}

/**
 * A stub LINE: the valid pair is `good`; tokens minted for it answer bot info with
 * DESTINATION; `foreignToken` belongs to another bot.
 */
function stubLine(good, { foreignToken = null, fail = {} } = {}) {
  const calls = []
  const minted = `minted-${'x'.repeat(40)}`
  const fetchFn = vi.fn(async (url, init) => {
    calls.push({ url, init })
    if (fail[url]) return typeof fail[url] === 'function' ? fail[url]() : response(fail[url], {})
    if (url === LINE_API.token) {
      const form = new URLSearchParams(init.body)
      const ok = form.get('client_id') === good.channelId && form.get('client_secret') === good.channelSecret
      return ok ? response(200, { access_token: minted, expires_in: 900, token_type: 'Bearer' }) : response(400, { error: 'invalid_client' })
    }
    const auth = init.headers?.Authorization ?? ''
    if (url === LINE_API.botInfo) {
      if (auth === `Bearer ${minted}` || (good.channelAccessToken && auth === `Bearer ${good.channelAccessToken}`)) {
        return response(200, { userId: DESTINATION, basicId: '@shop', displayName: 'Shop', pictureUrl: 'https://profile.line-scdn.net/x', chatMode: 'bot', markAsReadMode: 'auto' })
      }
      if (foreignToken && auth === `Bearer ${foreignToken}`) return response(200, { userId: OTHER_DESTINATION, basicId: '@other' })
      return response(401, { message: 'Authentication failed' })
    }
    return response(500, {})
  })
  return { fetchFn, calls, minted }
}

describe('validateChannel (proof 5)', () => {
  it('mints a token, reads the bot and returns the destination with the token hidden', async () => {
    const good = generateLineChannelBundle()
    const line = stubLine(good)
    const result = await createLineChannelAdminPort({ fetchFn: line.fetchFn }).validateChannel(good)
    expect(result).toMatchObject({ destination: DESTINATION, validationCode: 'LINE_OK', bot: { basicId: '@shop', displayName: 'Shop', chatMode: 'bot' } })
    expect(result.accessToken).toBe(line.minted)
    expect(JSON.stringify(result)).not.toContain(line.minted)
    expect(line.calls[0].init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(line.calls[0].init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
  })

  it('answers a wrong Channel ID and a wrong secret with the same code and nothing else', async () => {
    const good = generateLineChannelBundle()
    const port = createLineChannelAdminPort({ fetchFn: stubLine(good).fetchFn })
    const wrongId = await port.validateChannel({ ...good, channelId: String(Number(good.channelId) + 1) }).catch(e => e)
    const wrongSecret = await port.validateChannel({ ...good, channelSecret: generateLineChannelBundle().channelSecret }).catch(e => e)
    for (const error of [wrongId, wrongSecret]) {
      expect({ code: error.code, status: error.status, message: error.message }).toEqual({ code: 'LINE_CREDENTIALS_REJECTED', status: 422, message: 'LINE_CREDENTIALS_REJECTED' })
      expect(errorTrace(error)).not.toContain(good.channelSecret)
    }
    expect(Object.keys(wrongId).sort()).toEqual(Object.keys(wrongSecret).sort())
  })

  it('reports a correct pair with a wrong override token as the token’s fault', async () => {
    const good = generateLineChannelBundle()
    const foreignToken = `foreign-${'y'.repeat(40)}`
    const port = createLineChannelAdminPort({ fetchFn: stubLine(good, { foreignToken }).fetchFn })
    await expect(port.validateChannel({ ...good, channelAccessToken: `unknown-${'z'.repeat(40)}` })).rejects.toMatchObject({ code: 'LINE_TOKEN_REJECTED', status: 422 })
    await expect(port.validateChannel({ ...good, channelAccessToken: foreignToken })).rejects.toMatchObject({ code: 'LINE_TOKEN_REJECTED' })
    const withToken = generateLineChannelBundle({ withToken: true })
    expect((await createLineChannelAdminPort({ fetchFn: stubLine(withToken).fetchFn }).validateChannel(withToken)).destination).toBe(DESTINATION)
  })

  it('treats LINE 5xx, 429, a network failure and a timeout as LINE_UNAVAILABLE', async () => {
    const good = generateLineChannelBundle()
    for (const fail of [500, 503, 429, () => { throw new Error('ECONNRESET') }]) {
      const port = createLineChannelAdminPort({ fetchFn: stubLine(good, { fail: { [LINE_API.token]: fail } }).fetchFn })
      await expect(port.validateChannel(good)).rejects.toMatchObject({ code: 'LINE_UNAVAILABLE', status: 503 })
    }
    const slow = createLineChannelAdminPort({ timeoutMs: 5, fetchFn: (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) })
    await expect(slow.validateChannel(good)).rejects.toMatchObject({ code: 'LINE_UNAVAILABLE' })
  })
})

describe('webhook endpoint calls map every refusal to a reason (FR-227 port half)', () => {
  const token = `token-${'t'.repeat(40)}`

  it('sets an https endpoint, and refuses a non-https or overlong one before calling LINE', async () => {
    const fetchFn = vi.fn(async () => response(200, {}))
    const port = createLineChannelAdminPort({ fetchFn })
    expect(await port.setWebhookEndpoint({ accessToken: token, endpoint: 'https://zuri.example.com/api/line-oa/accounts/a/webhook' })).toMatchObject({ status: 'SET' })
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ endpoint: 'https://zuri.example.com/api/line-oa/accounts/a/webhook' })
    await expect(port.setWebhookEndpoint({ accessToken: token, endpoint: 'http://zuri.example.com/x' })).rejects.toMatchObject({ code: 'LINE_WEBHOOK_SET_FAILED', reason: 'ENDPOINT_NOT_HTTPS' })
    await expect(port.setWebhookEndpoint({ accessToken: token, endpoint: `https://zuri.example.com/${'a'.repeat(500)}` })).rejects.toMatchObject({ reason: 'ENDPOINT_TOO_LONG' })
    await expect(port.setWebhookEndpoint({ accessToken: token, endpoint: 'not a url' })).rejects.toMatchObject({ reason: 'ENDPOINT_INVALID' })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('maps LINE refusing the endpoint, a bad token and an outage', async () => {
    for (const [status, expected] of [[400, { code: 'LINE_WEBHOOK_SET_FAILED', reason: 'LINE_REFUSED_ENDPOINT' }], [401, { code: 'LINE_CREDENTIALS_REJECTED' }], [502, { code: 'LINE_UNAVAILABLE' }]]) {
      const port = createLineChannelAdminPort({ fetchFn: async () => response(status, {}) })
      await expect(port.setWebhookEndpoint({ accessToken: token, endpoint: 'https://zuri.example.com/w' })).rejects.toMatchObject(expected)
    }
  })

  it('reads the endpoint and its active flag, and no endpoint as inactive', async () => {
    expect(await createLineChannelAdminPort({ fetchFn: async () => response(200, { endpoint: 'https://zuri.example.com/w', active: false }) }).getWebhookEndpoint({ accessToken: token }))
      .toEqual({ endpoint: 'https://zuri.example.com/w', active: false })
    expect(await createLineChannelAdminPort({ fetchFn: async () => response(404, {}) }).getWebhookEndpoint({ accessToken: token })).toEqual({ endpoint: null, active: false })
  })

  it('classifies a webhook test: success, signature mismatch, and every documented reason', async () => {
    expect(classifyWebhookTest({ success: true, statusCode: 200, reason: 'OK', timestamp: '2026-09-14T00:00:00Z' })).toMatchObject({ success: true, code: 'LINE_OK', statusCode: 200 })
    expect(classifyWebhookTest({ success: false, statusCode: 401, reason: 'ERROR_STATUS_CODE' })).toMatchObject({ code: 'LINE_WEBHOOK_SIGNATURE_INVALID' })
    for (const reason of ['COULD_NOT_CONNECT', 'ERROR_STATUS_CODE', 'REQUEST_TIMEOUT', 'UNCLASSIFIED']) {
      expect(classifyWebhookTest({ success: false, statusCode: 500, reason }).code).toBe(`LINE_WEBHOOK_TEST_FAILED:${reason}`)
    }
    expect(classifyWebhookTest({ success: false, reason: 'SOMETHING_NEW' }).code).toBe('LINE_WEBHOOK_TEST_FAILED:UNCLASSIFIED')
    const port = createLineChannelAdminPort({ fetchFn: async () => response(200, { success: false, statusCode: 401, reason: 'ERROR_STATUS_CODE', detail: 'x'.repeat(500) }) })
    const outcome = await port.testWebhookEndpoint({ accessToken: token })
    expect(outcome).toMatchObject({ success: false, code: 'LINE_WEBHOOK_SIGNATURE_INVALID' })
    expect(outcome.detail).toHaveLength(200)
  })
})

describe('stateless token cache (SDD-098)', () => {
  function setup({ expiresIn = 900 } = {}) {
    let clock = 1_000_000
    let counter = 0
    const adminPort = { mintStatelessToken: vi.fn(async () => { counter += 1; return Object.defineProperty({ expiresInSeconds: expiresIn }, 'accessToken', { value: `tok-${counter}-${'q'.repeat(30)}`, enumerable: false }) }) }
    const cache = createLineChannelTokenCache({ adminPort, now: () => clock })
    return { cache, adminPort, advance: ms => { clock += ms } }
  }
  const request = (version = 'credential-v1', accountKey = 'conn-1') => ({ accountKey, credentialVersion: version, ...generateLineChannelBundle() })

  it('reuses a token for at most 13 minutes per credential version', async () => {
    const { cache, adminPort, advance } = setup()
    const first = await cache.accessTokenFor(request())
    advance(12 * 60_000)
    expect(await cache.accessTokenFor(request())).toBe(first)
    advance(61_000)
    const second = await cache.accessTokenFor(request())
    expect(second).not.toBe(first)
    expect(adminPort.mintStatelessToken).toHaveBeenCalledTimes(2)
  })

  it('mints at most once a minute per account, and shares one mint between concurrent callers', async () => {
    const { cache, adminPort, advance } = setup()
    const [a, b] = await Promise.all([cache.accessTokenFor(request()), cache.accessTokenFor(request())])
    expect(a).toBe(b)
    expect(adminPort.mintStatelessToken).toHaveBeenCalledTimes(1)
    // A rotation changes the version; a second mint inside the minute is refused.
    await expect(cache.accessTokenFor(request('credential-v2'))).rejects.toMatchObject({ code: 'LINE_TOKEN_MINT_THROTTLED', retryAfterSeconds: 60 })
    expect(await cache.accessTokenFor(request('credential-v1', 'conn-2'))).toMatch(/^tok-2-/)
    advance(60_000)
    expect(await cache.accessTokenFor(request('credential-v2'))).toMatch(/^tok-3-/)
  })

  it('drops an account’s tokens on invalidate and never keeps a token past LINE’s own expiry', async () => {
    const { cache, advance } = setup({ expiresIn: 300 })
    await cache.accessTokenFor(request())
    expect(cache.size()).toBe(1)
    cache.invalidate('conn-1')
    expect(cache.size()).toBe(0)
    advance(60_000)
    const token = await cache.accessTokenFor(request())
    advance(3 * 60_000 + 1)
    advance(60_000)
    expect(await cache.accessTokenFor(request())).not.toBe(token)
  })
})
