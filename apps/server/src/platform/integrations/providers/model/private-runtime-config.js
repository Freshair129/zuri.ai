// @req FR-267 — where the operator's Private Runtime Platform (PRP) lives, read
//   from server configuration only.
// @spec ADR-100 D7; ADR-099 D10; SEC-030
// @tested tests/unit/platform/private-runtime-config.test.js
//
// The base URL is operator configuration and nothing else. It is never a field a
// Business owner types: the server sends the Business's key to this address, so an
// address supplied from a browser would let anyone who can reach the form aim the
// server — carrying a credential — at any host it can reach (ADR-099 D10). Reading
// it here, in one place, is what makes "the owner picks `prp`" safe.
//
// What is accepted is deliberately narrow:
// - HTTPS, because the key travels to it. Plain HTTP is admitted only on loopback,
//   where the request never leaves the machine.
// - No user-info, query or fragment. Each is a way to smuggle a credential or a
//   second destination into what should be a plain origin.
// - A path prefix is allowed (a runtime mounted under `/prp`), trailing slash removed,
//   so callers append `/v1/...` without producing `//`.
//
// An unset or malformed value means "no private runtime here" — `null` — and every
// caller treats that as refusal, never as a default.

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

export const PRIVATE_RUNTIME_BASE_URL_ENV = 'ZURI_PRIVATE_RUNTIME_BASE_URL'
export const PRIVATE_RUNTIME_MODEL_ENV = 'ZURI_PRIVATE_RUNTIME_MODEL'

/** The normalised base URL, or null when it is unset or not a safe origin. */
export function readPrivateRuntimeBaseUrl(env = process.env) {
  const raw = typeof env?.[PRIVATE_RUNTIME_BASE_URL_ENV] === 'string' ? env[PRIVATE_RUNTIME_BASE_URL_ENV].trim() : ''
  if (!raw) return null
  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const secure = url.protocol === 'https:'
  const loopbackHttp = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
  if (!secure && !loopbackHttp) return null
  if (url.username || url.password || url.search || url.hash) return null
  // Operator ownership is not permission to target metadata or a non-destination.
  // URL canonicalizes alternative IPv4 spellings before these checks. Mapped IPv6
  // is refused to avoid a second spelling of a blocked IPv4 address.
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'metadata.google.internal' || host === 'metadata' || host === 'instance-data'
    || host === '100.100.100.200' || /^(?:0|169\.254|22[4-9]|23\d|24\d|25[0-5])\./.test(host)
    || /^\[(?:::|::ffff:.*|fe[89ab][0-9a-f]:.*|ff[0-9a-f:]+|fd00:ec2::254)\]$/.test(host)) return null
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
}

/**
 * The model alias the form suggests for `prp`, when the operator has named one.
 * A suggestion only: the owner still sees and may change it, and validation still
 * checks it against the aliases the Business's own key is granted.
 */
export function readPrivateRuntimeSuggestedModel(env = process.env) {
  const raw = typeof env?.[PRIVATE_RUNTIME_MODEL_ENV] === 'string' ? env[PRIVATE_RUNTIME_MODEL_ENV].trim() : ''
  return raw || null
}
