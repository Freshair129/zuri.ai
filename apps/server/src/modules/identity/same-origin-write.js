import {
  isPublicBaseUrlConfigured,
  resolvePublicBaseUrl,
} from '../../lib/public-base-url.js'

// @req FR-252 — reject cross-origin API writes before route-specific authorization.
// @spec ADR-097
// @tested tests/unit/identity/same-origin-write.test.js, tests/unit/identity/write-route-coverage.test.js

export const SAME_ORIGIN_WRITE_METHODS = Object.freeze(['POST', 'PUT', 'PATCH', 'DELETE'])

// Browser cross-origin callers are not supported. Future entries require a
// reason proving the route authenticates with a bearer token or signature, never cookies.
export const CROSS_ORIGIN_WRITE_ALLOWLIST = []

const writeMethodSet = new Set(SAME_ORIGIN_WRITE_METHODS)

function refuse() {
  return { allowed: false, status: 403, code: 'CSRF_INVALID' }
}

function getHeader(headers, name) {
  if (typeof headers?.get !== 'function') return null
  const value = headers.get(name)
  return value == null ? null : value
}

function parseOrigin(value) {
  if (typeof value !== 'string' || !value || value.trim() !== value) return null

  try {
    const url = new URL(value)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash
      || url.origin === 'null'
    ) return null
    return { origin: url.origin, host: url.host, protocol: url.protocol }
  } catch {
    return null
  }
}

function requestHost(headers) {
  const forwardedHost = getHeader(headers, 'x-forwarded-host')
  const raw = forwardedHost === null
    ? getHeader(headers, 'host')?.trim()
    : forwardedHost.split(',')[0].trim()
  if (!raw || /[\\/?#@,\s]/.test(raw)) return null

  try {
    const url = new URL(`http://${raw}`)
    if (!url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    // Keep an explicitly supplied default port: host:port comparison is literal
    // apart from DNS case, and must not depend on the temporary parsing scheme.
    return raw.toLowerCase()
  } catch {
    return null
  }
}

function forwardedProtocol(headers) {
  const forwardedProto = getHeader(headers, 'x-forwarded-proto')
  if (forwardedProto === null) return null

  const protocol = forwardedProto.split(',')[0].trim().toLowerCase()
  if (protocol === 'http' || protocol === 'https') return `${protocol}:`
  return null
}

export function validateAllowlist(entries) {
  if (!Array.isArray(entries)) throw new TypeError('Cross-origin write allowlist must be an array.')

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      throw new TypeError('Each cross-origin write allowlist entry must be an object.')
    }
    if (!(entry.pattern instanceof RegExp) && (typeof entry.pattern !== 'string' || !entry.pattern.startsWith('/'))) {
      throw new TypeError('Each cross-origin write allowlist entry needs a RegExp or absolute path prefix.')
    }
    if (typeof entry.reason !== 'string' || !entry.reason.trim()) {
      throw new TypeError('Each cross-origin write allowlist entry requires a non-empty reason.')
    }
    if (!/(?:bearer|signature)/i.test(entry.reason)
      || !/cookie/i.test(entry.reason)
      || !/\b(?:never|no|without|not)\b/i.test(entry.reason)) {
      throw new TypeError('Each allowlist reason must state bearer/signature authentication and that cookies are never used.')
    }
  }

  return entries
}

export function matchesCrossOriginWriteAllowlist(pathname) {
  validateAllowlist(CROSS_ORIGIN_WRITE_ALLOWLIST)
  if (typeof pathname !== 'string') return false

  return CROSS_ORIGIN_WRITE_ALLOWLIST.some(({ pattern }) => {
    if (pattern instanceof RegExp) {
      pattern.lastIndex = 0
      const matches = pattern.test(pathname)
      pattern.lastIndex = 0
      return matches
    }
    return pathname.startsWith(pattern)
  })
}

validateAllowlist(CROSS_ORIGIN_WRITE_ALLOWLIST)

export function evaluateSameOriginWrite({
  method,
  pathname,
  headers,
  env,
} = {}) {
  const normalizedMethod = typeof method === 'string' ? method.toUpperCase() : ''
  if (!writeMethodSet.has(normalizedMethod)) return { allowed: true }
  if (matchesCrossOriginWriteAllowlist(pathname)) return { allowed: true }

  const originHeader = getHeader(headers, 'origin')
  if (originHeader !== null) {
    const suppliedOrigin = parseOrigin(originHeader)
    if (!suppliedOrigin) return refuse()

    const configuredEnv = env && typeof env === 'object' ? env : {}
    let expectedProtocol = null
    if (isPublicBaseUrlConfigured(configuredEnv)) {
      const publicOrigin = parseOrigin(resolvePublicBaseUrl(configuredEnv))
      if (publicOrigin && suppliedOrigin.origin === publicOrigin.origin) return { allowed: true }
      expectedProtocol = publicOrigin?.protocol ?? null
    } else {
      expectedProtocol = forwardedProtocol(headers)
    }

    const host = requestHost(headers)
    return host
      && suppliedOrigin.host === host
      && (!expectedProtocol || suppliedOrigin.protocol === expectedProtocol)
      ? { allowed: true }
      : refuse()
  }

  const fetchSite = getHeader(headers, 'sec-fetch-site')
  if (typeof fetchSite === 'string' && /^(?:cross-site|same-site)$/i.test(fetchSite.trim())) return refuse()
  return { allowed: true }
}
