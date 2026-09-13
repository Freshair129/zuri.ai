// @req FR-222 — the HTTP client for the harness-pairing and programme-usage-
//   reports endpoints (FR-220, FR-221), and the queue flush that applies the
//   keep/drop rules from each response.
// @spec ADR-087 D1, D4-D6
// @tested tests/unit/zuri-harness-plugin.test.js
import * as defaultQueue from './queue.mjs'

const DEFAULT_TIMEOUT_MS = 5000

async function withTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function readJson(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

/**
 * A thin client over the four ADR-087 endpoints. Everything the plugin needs
 * to reach the network is injected (`fetch`, `timeoutMs`) so tests never make
 * a real request. Every method resolves to `{ ok, status, body }` — a network
 * error or an abort resolves to `{ ok: false, status: 0, body: null, error }`
 * rather than throwing, so callers (the queue flush especially) can treat
 * "could not reach the server" the same as any other retryable response.
 */
export function createClient({ server, key, fetch = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!server) throw new Error('createClient requires a server URL')
  const base = server.replace(/\/+$/, '')

  async function call(pathname, { method = 'POST', body, auth } = {}) {
    const headers = { 'Content-Type': 'application/json' }
    if (auth) headers.Authorization = `Bearer ${auth}`
    try {
      const response = await withTimeout(
        fetch,
        `${base}${pathname}`,
        { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
        timeoutMs,
      )
      const json = await readJson(response)
      return { ok: response.ok, status: response.status, body: json }
    } catch (error) {
      return { ok: false, status: 0, body: null, error }
    }
  }

  return {
    // Exposed for the pairing flow, which polls with the one-time device
    // secret rather than the client's own (not-yet-issued) key.
    request: call,
    start: (body) => call('/api/platform/harness-pairing/start', { body }),
    poll: (body, deviceSecret) => call('/api/platform/harness-pairing/poll', { body, auth: deviceSecret || key }),
    whoami: () => call('/api/platform/programme-usage-reports/whoami', { method: 'GET', auth: key }),
    sendReport: (body) => call('/api/platform/programme-usage-reports', { body, auth: key }),
  }
}

/**
 * Drain the queue against the server, applying the ADR-087 D4-D6 response
 * rules: a report the server accepted (201, or 200 replayed/extended) is
 * removed; one it will never accept (400, 404, 409) is dropped and logged; one
 * it may accept later (401, 403, 5xx, or no response at all) stays queued.
 * Reports are sent in file order (oldest first) and one failure never stops
 * the rest from being attempted.
 */
export async function flushQueue({ client, queue = defaultQueue, home, log = () => {} } = {}) {
  const entries = queue.list(home)
  let sent = 0
  let dropped = 0
  let kept = 0
  for (const { file, report } of entries) {
    const result = await client.sendReport(report)
    if (result.status === 201 || result.status === 200) {
      queue.remove(file)
      sent += 1
      continue
    }
    if (result.status === 400) {
      log(`dropping invalid usage report (${report.source} ${report.sessionId} ${report.branch}): USAGE_REPORT_INVALID`)
      queue.remove(file)
      dropped += 1
      continue
    }
    if (result.status === 404) {
      log(`dropping usage report for unknown programme task (${report.source} ${report.sessionId} ${report.branch})`)
      queue.remove(file)
      dropped += 1
      continue
    }
    if (result.status === 409) {
      log(`dropping conflicting usage report (${report.source} ${report.sessionId} ${report.branch}): USAGE_REPORT_CONFLICT`)
      queue.remove(file)
      dropped += 1
      continue
    }
    if (result.status === 401) {
      log('harness credential rejected — re-pair with "pair"; report stays queued')
      kept += 1
      continue
    }
    if (result.status === 403) {
      log('device not yet activated by an operator; report stays queued')
      kept += 1
      continue
    }
    // 5xx, or no response at all (network error/timeout): keep and retry later.
    kept += 1
  }
  return { sent, dropped, kept }
}
