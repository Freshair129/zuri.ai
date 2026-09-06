// @req FR-142 — one canonical public origin for the deployment, read from the
//   environment at run time, so nothing in the app assumes a Vercel hostname.
// @spec ADR-058 — Docker Compose + ngrok replace Vercel; the public origin is
//   `PUBLIC_BASE_URL` (https://<ngrok domain> in a remote deployment,
//   http://localhost:3100 in development). `NEXT_PUBLIC_APP_URL` is kept as the
//   build-time alias the root layout already read.
// @tested tests/unit/public-base-url.test.js

export const DEFAULT_PUBLIC_BASE_URL = 'http://localhost:3100'

/** `POST /api/agent/line-webhook` is the only inbound webhook this app serves. */
export const LINE_WEBHOOK_PATH = '/api/agent/line-webhook'

function normalizeOrigin(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    // Origin only: a path, query or fragment on the base would double up when a
    // route is appended, and a trailing slash is the most common typo.
    return url.origin
  } catch {
    return null
  }
}

/**
 * The public origin this deployment is reached at.
 *
 * Precedence: `PUBLIC_BASE_URL` (server, run time) → `NEXT_PUBLIC_APP_URL`
 * (inlined at build time, so it is also the value a client bundle can see) →
 * the development default. An unparsable or non-HTTP value is treated as unset
 * rather than propagated, so a typo cannot become a broken absolute link.
 */
export function resolvePublicBaseUrl(env = process.env) {
  return (
    normalizeOrigin(env?.PUBLIC_BASE_URL) ||
    normalizeOrigin(env?.NEXT_PUBLIC_APP_URL) ||
    DEFAULT_PUBLIC_BASE_URL
  )
}

/**
 * In the browser the truthful origin is the one the page was served from — through
 * ngrok that is the HTTPS domain, on the host it is localhost — so it wins over any
 * build-time value. Server-side rendering has no window and falls back to the env.
 */
export function resolveBrowserOrigin({ location, env = process.env } = {}) {
  return normalizeOrigin(location?.origin) || resolvePublicBaseUrl(env)
}

/** The absolute LINE webhook URL for a given origin (never invents a path). */
export function lineWebhookUrl(origin) {
  return `${normalizeOrigin(origin) || DEFAULT_PUBLIC_BASE_URL}${LINE_WEBHOOK_PATH}`
}
