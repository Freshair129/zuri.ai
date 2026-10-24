import { randomUUID, createHash, createHmac } from 'node:crypto'

// @req FR-230 — tenant-bound API-011 maintenance authority, separate from chat.
// @spec SEC-031, ADR-091 — bounded downward-only windows; no private reads/writes.
// @tested tests/unit/msp-retention.test.js
export const MSP_RETENTION_COUNT_KEYS = Object.freeze([
  'threadMessages', 'protectedMemoryRecords', 'sessionSummaries', 'threadDeliveryReceipts', 'threadPendingDeliveries',
])
export const MSP_RETENTION_ROW_BOUND = 200
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const fail = code => { throw new Error(code) }

export function resolveMspRetentionConfig(env = process.env) {
  let scopes, keys
  try { scopes = JSON.parse(env.ZURI_MSP_RETENTION_TENANTS); keys = JSON.parse(env.MSP_THREAD_SERVICE_KEYRING) }
  catch { fail('MSP_RETENTION_CONFIG_INVALID') }
  // Current LINE memory composition has one deployment Workspace/key. Do not
  // pretend a wider maintenance mapping establishes multi-Tenant composition.
  if (!plain(scopes) || !plain(keys) || Object.keys(scopes).length !== 1) fail('MSP_RETENTION_CONFIG_INVALID')
  const raw = env.MSP_THREAD_RETENTION_DAYS
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw))) fail('MSP_RETENTION_WINDOW_INVALID')
  const targets = Object.entries(scopes).map(([tenantId, workspaceId]) => {
    if (!UUID.test(tenantId) || !UUID.test(workspaceId) || !Object.hasOwn(keys, tenantId)
      || typeof keys[tenantId] !== 'string' || keys[tenantId].length < 32) fail('MSP_RETENTION_SCOPE_KEY_INVALID')
    if (env.ZURI_MSP_THREAD_WORKSPACE_ID !== workspaceId || env.ZURI_MSP_THREAD_SERVICE_KEY !== keys[tenantId]) fail('MSP_RETENTION_LINE_COMPOSITION_MISMATCH')
    return { tenantId, workspaceId, serviceKey: keys[tenantId] }
  })
  if (new Set(targets.map(t => t.workspaceId)).size !== targets.length) fail('MSP_RETENTION_SCOPE_KEY_INVALID')
  return { targets, retentionDays: Math.min(90, Number(raw)) }
}

export function createMspRetentionPort({ tenantId, workspaceId, serviceKey, retentionDays, transport, clock = Date.now }) {
  if (!UUID.test(tenantId) || !UUID.test(workspaceId) || typeof serviceKey !== 'string' || serviceKey.length < 32
    || !Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 90 || typeof transport !== 'function') fail('MSP_RETENTION_PORT_INVALID')
  return Object.freeze({ async tick({ dryRun = false } = {}) {
    if (typeof dryRun !== 'boolean') fail('MSP_RETENTION_DRY_RUN_INVALID')
    const input = { dry_run: dryRun }, started = clock()
    const grant = { tenantId, workspaceId, agentId: 'zuri-retention-worker', principalId: 'zuri-retention-worker', policyRevision: 'msp-retention-v1',
      operator: true, readPrivate: false, writePrivate: false, operation: 'msp_thread_retention_tick',
      nonce: randomUUID(), expiresAt: started + 60000,
      payloadHash: createHash('sha256').update(JSON.stringify(input)).digest('hex') }
    const response = await transport('msp_thread_retention_tick', { ...input, access: { grant,
      signature: createHmac('sha256', serviceKey).update(JSON.stringify(grant)).digest('hex') } })
    const value = response?.structuredContent ?? response
    const cutoff = Date.parse(value?.cutoff), daysMs = retentionDays * 86400000
    const counts = value?.tablesAffected
    if (value?.dryRun !== dryRun || !Number.isFinite(cutoff) || cutoff < started - daysMs - 5000 || cutoff > clock() - daysMs + 5000
      || !plain(counts) || Object.keys(counts).length !== MSP_RETENTION_COUNT_KEYS.length
      || MSP_RETENTION_COUNT_KEYS.some(k => !Number.isInteger(counts[k]) || counts[k] < 0 || counts[k] > MSP_RETENTION_ROW_BOUND)) fail('MSP_RETENTION_RESULT_INVALID')
    return { dryRun, cutoff: value.cutoff, tablesAffected: Object.fromEntries(MSP_RETENTION_COUNT_KEYS.map(k => [k, counts[k]])) }
  } })
}
