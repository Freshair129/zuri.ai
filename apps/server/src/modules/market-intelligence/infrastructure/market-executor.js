import { AUTH_SESSION_COOKIE } from '@/modules/identity/auth-service'
import { readRequestCookie } from '@/modules/identity/session-port'

// Single-writer routing for the two Market routes (ADR-108 D6). One deployment flag,
// read once when the module loads, never per request and never from the client:
//
//   MARKET_EXECUTOR unset | legacy  → the in-process module runs, exactly as before
//   MARKET_EXECUTOR = service       → the route is a thin BFF over the Market service
//
// Anything else, or `service` without its URL/token, is MISCONFIGURED. The route then
// answers 503 and never falls back to legacy, because a silent fallback is how two
// writers happen. The service applies its own gate as well: it refuses translation
// writes unless core says it owns execution.
//
// The BFF decides nothing about the viewer. It forwards the user's own session token
// opaquely (x-zuri-subject) and authenticates itself with MARKET_SERVICE_TOKEN; the
// service asks core, which resolves the viewer from that token.
// This module imports nothing from services/: the contract is HTTP.
// @req FR-092
// @spec BR-001, SEC-001, SEC-017, SDD-049, ADR-108
// @tested tests/unit/market-intelligence/market-executor.test.js

export const MARKET_EXECUTORS = Object.freeze({ LEGACY: 'legacy', SERVICE: 'service', MISCONFIGURED: 'misconfigured' })

const FEED_TIMEOUT_MS = 10_000
const TRANSLATION_TIMEOUT_MS = 60_000
const MAX_FORWARD_BODY_BYTES = 64 * 1024

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

export function resolveMarketExecutor(env = {}) {
  const flag = env.MARKET_EXECUTOR
  if (flag === undefined || flag === '' || flag === MARKET_EXECUTORS.LEGACY) {
    return { executor: MARKET_EXECUTORS.LEGACY }
  }
  if (flag !== MARKET_EXECUTORS.SERVICE) {
    return { executor: MARKET_EXECUTORS.MISCONFIGURED, reason: 'MARKET_EXECUTOR must be legacy or service' }
  }
  let url
  try {
    url = new URL(env.MARKET_SERVICE_URL)
  } catch {
    return { executor: MARKET_EXECUTORS.MISCONFIGURED, reason: 'MARKET_SERVICE_URL is missing or invalid' }
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    return { executor: MARKET_EXECUTORS.MISCONFIGURED, reason: 'MARKET_SERVICE_URL is invalid' }
  }
  if (typeof env.MARKET_SERVICE_TOKEN !== 'string' || env.MARKET_SERVICE_TOKEN.length < 32) {
    return { executor: MARKET_EXECUTORS.MISCONFIGURED, reason: 'MARKET_SERVICE_TOKEN must be at least 32 characters' }
  }
  return { executor: MARKET_EXECUTORS.SERVICE, baseUrl: url, token: env.MARKET_SERVICE_TOKEN }
}

export function createMarketServiceProxy({ baseUrl, token, fetchFn = fetch }) {
  async function forward(request, { method, path, search = '', timeoutMs }) {
    const subject = readRequestCookie(request, AUTH_SESSION_COOKIE)
    if (!subject) return json(401, { error: 'Authentication required' })

    let body
    if (method === 'POST') {
      body = await request.text()
      if (Buffer.byteLength(body, 'utf8') > MAX_FORWARD_BODY_BYTES) return json(413, { error: 'Request body too large' })
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchFn(new URL(`${path}${search}`, baseUrl), {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          'x-zuri-subject': subject,
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body,
        redirect: 'error',
        signal: controller.signal,
      })
      const text = await response.text()
      let payload
      try {
        payload = JSON.parse(text)
      } catch {
        return json(502, { error: 'Market service returned an invalid response', code: 'MARKET_SERVICE_INVALID' })
      }
      // The service speaks the legacy body shapes, so status and body pass through.
      return json(response.status, payload)
    } catch {
      return json(503, { error: 'Market service is unavailable', code: 'MARKET_SERVICE_UNAVAILABLE' })
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    feed: (request) => forward(request, {
      method: 'GET',
      path: '/v1/observations',
      search: new URL(request.url).search,
      timeoutMs: FEED_TIMEOUT_MS,
    }),
    translate: (request) => forward(request, { method: 'POST', path: '/v1/translations', timeoutMs: TRANSLATION_TIMEOUT_MS }),
  }
}

/**
 * The route-facing decision, built once per module load.
 * `null` means "run the legacy code path"; otherwise a handler that returns a Response.
 */
export function createMarketRouting(env, { fetchFn } = {}) {
  const resolved = resolveMarketExecutor(env)
  if (resolved.executor === MARKET_EXECUTORS.LEGACY) return { executor: resolved.executor, feed: null, translate: null }
  if (resolved.executor === MARKET_EXECUTORS.MISCONFIGURED) {
    const refuse = async () => json(503, { error: 'Market service is not configured', code: 'MARKET_SERVICE_MISCONFIGURED' })
    return { executor: resolved.executor, reason: resolved.reason, feed: refuse, translate: refuse }
  }
  const proxy = createMarketServiceProxy({ baseUrl: resolved.baseUrl, token: resolved.token, fetchFn })
  return { executor: resolved.executor, feed: proxy.feed, translate: proxy.translate }
}

export const marketRouting = createMarketRouting(process.env)
