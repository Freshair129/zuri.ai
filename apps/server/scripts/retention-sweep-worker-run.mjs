// @req FR-230, FR-245, SEC-034 — the testable core of the single-shot nightly
//   retention worker, including serial CRM archive expiry after the CRM chain
//   writer. Split out of `server-retention-sweep-worker.mjs` for the same
//   reason `worker-cadence.mjs` was split out of `server-line-worker.mjs`: that
//   file is a top-level-await script whose import *is* the process, so nothing
//   inside it can be exercised from a test.
// @spec ADR-091 D1, D2; ADR-093 D5 (1.3.0); SEC-001
// @tested tests/unit/retention-sweep-worker-run.test.js

const ALLOWED_PLAIN_HTTP_HOSTS = ['web', 'localhost', '127.0.0.1', '[::1]']

/**
 * Read and validate the worker's configuration from the environment.
 *
 * Mirrors `server-line-worker.mjs`'s own checks: a token under 32 characters is
 * refused here rather than left for the route to reject, and the endpoint is
 * pinned to the one path this worker calls, over plain HTTP only to a known
 * in-network host (or HTTPS anywhere) — the same shape stops a misconfigured
 * URL from becoming an unintended egress target.
 *
 * Throws on a bad configuration (a deploy mistake to fix, not a run to log
 * and move past). Defaults the endpoint's host to `127.0.0.1`, not `web`: this
 * worker is designed to run via `docker compose exec` INSIDE the `web`
 * container itself (see the ops registration script), not as a separate
 * container reaching `web` over the compose network — `web` still works as an
 * override for that alternative topology.
 */
export function resolveRetentionSweepWorkerConfig(env = process.env) {
  const endpoint = new URL(env.ZURI_RETENTION_SWEEP_URL || 'http://127.0.0.1:3000/api/crm/retention-sweep')
  const token = env.ZURI_RETENTION_SWEEP_TOKEN
  if (!token || token.length < 32) throw new Error('ZURI_RETENTION_SWEEP_TOKEN_REQUIRED')
  if (endpoint.username || endpoint.password || endpoint.pathname !== '/api/crm/retention-sweep'
    || (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ALLOWED_PLAIN_HTTP_HOSTS.includes(endpoint.hostname)))) {
    throw new Error('RETENTION_SWEEP_URL_INVALID')
  }
  return { endpoint, token }
}

function hasRetentionSweepFailures(body, endpoint) {
  const classFailures = Object.values(body?.countsByClass ?? {}).some(counts =>
    ['tenantFailures', 'archiveFailures', 'settleFailures'].some(key =>
      Array.isArray(counts?.[key]) && counts[key].length > 0))
  const archiveExpiryFailures = endpoint.pathname === '/api/crm/archive-expiry'
    && (Number(body?.counts?.skipped ?? 0) > 0
      || Number(body?.counts?.failures ?? 0) > 0
      || Number(body?.counts?.tenantsDeferred ?? 0) > 0)
  return classFailures || archiveExpiryFailures
}

/**
 * One authenticated call to the retention-sweep route. A nightly batch job can
 * afford minutes — `timeoutMs` defaults far past the LINE worker's ~1s-per-tick
 * budget, long enough for a full multi-Tenant sweep, short enough that a truly
 * stuck run is eventually reported rather than hanging the scheduled task
 * forever. The route commits its own audit event before answering, so a
 * client-side timeout here means "no confirmation reached this process", never
 * "the sweep did not happen" — a re-run lands on the route's own same-day
 * idempotency guard instead of duplicating work.
 *
 * Never throws for an HTTP-level outcome (4xx/5xx/network/timeout) or a
 * successful-but-partial Tenant sweep — those are reported in the returned
 * shape so the caller can log-and-exit deterministically. Only
 * `resolveRetentionSweepWorkerConfig` throws, because that failure is a deploy
 * mistake, not a run to report on.
 */
export async function runRetentionSweepOnce({ endpoint, token, fetchImpl = fetch, timeoutMs = 600_000 }) {
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    // Counts per class only — never customer content — matching what the route
    // itself returns and what the sweep's own audit event carries.
    const body = await response.json().catch(() => null)
    return { ok: response.ok && !hasRetentionSweepFailures(body, endpoint), status: response.status, body }
  } catch (err) {
    return { ok: false, status: null, body: null, error: err?.name === 'TimeoutError' ? 'TIMEOUT' : 'UNAVAILABLE' }
  }
}

// Ordered deployment sweep calls. The per-Tenant archive-chain lock shared by
// the sweep, hold re-seal and retirement writers provides safety; this order
// reduces contention but is not a correctness boundary.
export const RETENTION_SWEEP_CALLS = Object.freeze([
  Object.freeze({ name: 'crm', path: '/api/crm/retention-sweep', event: 'crm.retention-sweep.tick', usesConfiguredEndpoint: true, supportsDryRun: false }),
  Object.freeze({ name: 'archive-expiry', path: '/api/crm/archive-expiry', event: 'crm.archive-expiry.tick', supportsDryRun: false }),
  Object.freeze({ name: 'integration', path: '/api/integration/raw-retention-sweep', event: 'integration.raw-line-retention-sweep.tick', supportsDryRun: true }),
  Object.freeze({ name: 'agent', path: '/api/agent/trace-retention-sweep', event: 'agent.trace-retention-sweep.tick', supportsDryRun: true }),
])

/** Call every owning-domain route in order; failures are reported but do not stop later calls. */
export async function runRetentionSweepSequence({ endpoint, token, fetchImpl = fetch, timeoutMs = 600_000,
  calls = RETENTION_SWEEP_CALLS, dryRun = false } = {}) {
  const results = []
  for (const call of calls) {
    if (dryRun && !call.supportsDryRun) {
      results.push({ name: call.name, event: call.event, result: { skipped: 'NO_DRY_RUN' } })
      continue
    }
    const target = call.usesConfiguredEndpoint ? endpoint : new URL(call.path, endpoint.origin)
    if (dryRun) target.searchParams.set('dry_run', 'true')
    const result = await runRetentionSweepOnce({ endpoint: target, token, fetchImpl, timeoutMs })
    results.push({ name: call.name, event: call.event, result })
  }
  return { ok: results.every(entry => entry.result.skipped === 'NO_DRY_RUN' || entry.result.ok), results }
}

/** One JSON line per route — counts and status only. */
export function formatRetentionSweepLogLine(result, event = 'crm.retention-sweep.tick') {
  if (result?.skipped === 'NO_DRY_RUN') return JSON.stringify({ event, skipped: 'NO_DRY_RUN' })
  return JSON.stringify({
    event,
    status: result.status,
    ...(result.body && typeof result.body === 'object' ? result.body : {}),
    ...(result.error ? { error: result.error } : {}),
  })
}
