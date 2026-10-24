// @req FR-230 — bounded one-shot caller for the nightly MSP sweep.
// @spec SEC-001, SEC-031, ADR-091
// @tested tests/unit/msp-retention-route-worker.test.js
export function resolveMspRetentionWorkerConfig(env = process.env) {
  const endpoint = new URL(env.ZURI_MSP_RETENTION_SWEEP_URL || 'http://127.0.0.1:3000/api/agent/memory-retention')
  const token = env.ZURI_MSP_RETENTION_SWEEP_TOKEN
  if (typeof token !== 'string' || token.length < 32) throw new Error('MSP_RETENTION_CREDENTIAL_REQUIRED')
  if (endpoint.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
    || endpoint.username || endpoint.password || endpoint.pathname !== '/api/agent/memory-retention'
    || endpoint.search || endpoint.hash) throw new Error('MSP_RETENTION_URL_INVALID')
  return { endpoint, token }
}
export async function runMspRetentionOnce({ endpoint, token, dryRun = false, fetchImpl = fetch, timeoutMs = 120000 }) {
  try {
    if (typeof dryRun !== 'boolean') throw new Error('INVALID_DRY_RUN')
    const url = new URL(endpoint)
    if (dryRun) url.searchParams.set('dry_run', 'true')
    const response = await fetchImpl(url, { method: 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) })
    const body = await response.json().catch(() => null)
    const validRun = typeof body?.runId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.runId)
    const ok = response.ok && body?.ok === true && body.dryRun === dryRun && validRun && Array.isArray(body.tenants) && body.tenants.length > 0
      && body.tenants.every(t => t?.status === (dryRun ? 'DRY_RUN' : 'COMPLETE'))
    // Never spread an unexpected server body or error into logs.
    return { ok, status: response.status, runId: validRun ? body.runId : null,
      tenantOutcomes: Array.isArray(body?.tenants) ? body.tenants.map(t => ['COMPLETE', 'DRY_RUN', 'DEFERRED', 'PARTIAL', 'UNKNOWN', 'FAILED'].includes(t?.status) ? t.status : 'INVALID') : [] }
  } catch (error) {
    return { ok: false, status: null, error: error?.name === 'TimeoutError' ? 'TIMEOUT' : 'UNAVAILABLE' }
  }
}
export function formatMspRetentionLog(result) {
  return JSON.stringify({ event: 'msp.retention-sweep.tick', ok: result.ok, status: result.status,
    ...(result.runId ? { runId: result.runId } : {}), ...(result.tenantOutcomes ? { tenantOutcomes: result.tenantOutcomes } : {}),
    ...(result.error ? { error: result.error } : {}) })
}
