// @spec ADR-115 — HTTPS TEST sessions trust only the fixture CA; no fabricated cookies.
// @tested tests/node/compact-journey.test.mjs, tests/integration/compact-knowledge-journey.test.js
import https from 'node:https'
export function compactJourneyHttpsClient({ baseURL, ca }) {
  const base = new URL(baseURL)
  if (base.protocol !== 'https:' || base.hostname !== '127.0.0.1' || !base.port || base.pathname !== '/' || base.username || base.password || base.search || base.hash || !ca || !(typeof ca === 'string' || Buffer.isBuffer(ca))) throw new Error('COMPACT_JOURNEY_HTTPS_REQUIRED')
  let cookie = ''
  return {
    request(method, route, data) {
      if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method) || typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//') || /[\r\n]/.test(route)) throw new Error('COMPACT_JOURNEY_REQUEST_INVALID')
      const payload = data === undefined ? undefined : Buffer.from(JSON.stringify(data))
      return new Promise((resolve, reject) => {
        const request = https.request({ hostname: base.hostname, port: Number(base.port), path: route, method, ca, rejectUnauthorized: true, agent: false,
          headers: { origin: base.origin, ...(cookie ? { cookie } : {}), ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) } }, response => {
          let text = ''
          const setCookies = response.headers['set-cookie'] || [], session = setCookies.find(value => value.startsWith('zuri_session='))
          if (session) cookie = session.split(';')[0]
          response.on('data', chunk => { text += chunk; if (Buffer.byteLength(text) > 4 * 1024 * 1024) request.destroy() })
          response.on('error', () => reject(new Error('COMPACT_JOURNEY_HTTPS_FAILED')))
          response.on('end', () => {
            let body
            try { body = JSON.parse(text) } catch { return reject(new Error('COMPACT_JOURNEY_NON_JSON_RESPONSE')) }
            resolve({ status: response.statusCode, ok: response.statusCode >= 200 && response.statusCode < 300, body,
              sessionCookie: { set: Boolean(session), secure: Boolean(session && /;\s*Secure(?:;|$)/i.test(session)), httpOnly: Boolean(session && /;\s*HttpOnly(?:;|$)/i.test(session)) } })
          })
        })
        request.setTimeout(60000, () => request.destroy())
        request.on('error', () => reject(new Error('COMPACT_JOURNEY_HTTPS_FAILED')))
        request.end(payload)
      })
    },
  }
}
