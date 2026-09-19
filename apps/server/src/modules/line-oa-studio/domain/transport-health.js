// @req FR-190 — the two pure classifications behind LINE transport reachability:
//   how long the channel has been silent, and whether the endpoint LINE has
//   configured is still this deployment's own route. No I/O lives here, so both
//   are testable against a clock instead of against production.
// @spec ADR-061 — server-owned transport; this only observes it, never changes it.
// @tested tests/unit/fr190-line-transport-health.test.js

export const TRANSPORT_SILENCE_STATES = Object.freeze(['OK', 'QUIET', 'SILENT'])
export const TRANSPORT_ENDPOINT_STATES = Object.freeze(['MATCHED', 'MISMATCHED', 'DISABLED', 'UNKNOWN'])

/** Owner decision 2026-09-12: quiet at 6 hours, silent at 24. */
export const QUIET_AFTER_MS = 6 * 60 * 60 * 1000
export const SILENT_AFTER_MS = 24 * 60 * 60 * 1000

/** Owner decision 2026-09-12: ask LINE for its configured endpoint once an hour. */
export const ENDPOINT_PROBE_TTL_MS = 60 * 60 * 1000

/**
 * Classify inbound silence.
 *
 * `activeSince` is what makes a brand-new account honest: with no delivery ever
 * recorded there is no age to measure, and calling that SILENT would page
 * someone about an account that was enabled four minutes ago. The clock starts
 * at the later of "last delivery" and "became monitorable".
 */
export function classifySilence({
  lastInboundAt = null,
  activeSince = null,
  now = new Date(),
  quietAfterMs = QUIET_AFTER_MS,
  silentAfterMs = SILENT_AFTER_MS,
} = {}) {
  const last = toTime(lastInboundAt)
  const since = toTime(activeSince)
  const reference = last ?? since
  if (reference == null) return { state: 'OK', lastInboundAt: null, ageMs: null, measuredFrom: null }
  const ageMs = Math.max(0, now.getTime() - reference)
  const state = ageMs >= silentAfterMs ? 'SILENT' : ageMs >= quietAfterMs ? 'QUIET' : 'OK'
  return {
    state,
    lastInboundAt: last == null ? null : new Date(last).toISOString(),
    ageMs,
    measuredFrom: last == null ? 'ACTIVE_SINCE' : 'LAST_INBOUND',
  }
}

/**
 * Compare the endpoint LINE reports with the one this deployment serves.
 *
 * The comparison is on origin plus path, case-insensitive on the host and
 * indifferent to a trailing slash, because those differ without meaning. Query
 * and fragment are not ignored: LINE delivers to exactly what is configured.
 */
export function classifyEndpoint({ configured = null, expected = null, active = null, probeFailed = false } = {}) {
  if (probeFailed) return 'UNKNOWN'
  if (active === false) return 'DISABLED'
  const left = normalizeEndpoint(configured)
  const right = normalizeEndpoint(expected)
  if (left == null || right == null) return 'UNKNOWN'
  return left === right ? 'MATCHED' : 'MISMATCHED'
}

/** Origin + path, lowercased host, no trailing slash. Returns null when unusable. */
export function normalizeEndpoint(value) {
  if (typeof value !== 'string' || value.trim() === '') return null
  let url
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const path = url.pathname.length > 1 && url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname
  return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}${url.hash}`
}

/** The webhook URL this deployment serves for one account. */
export function expectedWebhookEndpoint({ baseUrl, accountId }) {
  if (typeof baseUrl !== 'string' || baseUrl.trim() === '' || typeof accountId !== 'string' || accountId.trim() === '') return null
  const base = baseUrl.trim().replace(/\/+$/, '')
  return `${base}/api/line-oa/accounts/${accountId}/webhook`
}

/**
 * Why an account is not monitored, or null when it is.
 *
 * Owner decision 2026-09-12: a paused account is excluded rather than reported
 * OK — pausing is a deliberate act, and an alert that fires on a deliberate act
 * teaches people to ignore it.
 */
export function monitoringExclusion(account) {
  if (!account) return 'NOT_FOUND'
  if (account.archivedAt) return 'ARCHIVED'
  if (account.status === 'PAUSED') return 'PAUSED'
  if (account.status !== 'CONNECTED') return 'NOT_CONNECTED'
  if (account.serverEnabled !== true) return 'NOT_SERVER_ENABLED'
  return null
}

function toTime(value) {
  if (value == null) return null
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}
