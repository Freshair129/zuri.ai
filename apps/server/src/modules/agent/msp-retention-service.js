import { randomUUID } from 'node:crypto'
import pg from 'pg'
import os from 'node:os'
import prisma, { resolvePostgresUrl } from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { createMspTransportFromEnvironment } from './msp-stdio-transport'
import { resolveMspRetentionConfig, createMspRetentionPort, MSP_RETENTION_COUNT_KEYS, MSP_RETENTION_ROW_BOUND } from './msp-retention-port.mjs'
import { verifyMspRetentionRecoveryProof } from './msp-retention-recovery.mjs'
import { createMspRetentionGate } from './msp-retention-gate'

// @req FR-230 — scheduled provider-owned retention, preserving live LINE work.
// @spec SEC-031, ADR-091 — current Tenant override, signed scope and audit counts.
// @tested tests/unit/msp-retention.test.js, tests/integration/msp-retention-fence.test.js
const MAX_BATCHES = 10
const TERMINAL = ['RECORDED', 'FAILED', 'CANCELLED']
const emptyCounts = () => Object.fromEntries(MSP_RETENTION_COUNT_KEYS.map(k => [k, 0]))
function defaultPort({ env, ...options }) {
  return createMspRetentionPort({ ...options, transport: createMspTransportFromEnvironment(env, { awaitChildExit: true }) })
}
function providerOf(db) {
  const provider = db?._engineConfig?.activeProvider
  if (!['postgresql', 'sqlite'].includes(provider)) throw new Error('MSP_RETENTION_DB_PROVIDER_INVALID')
  return provider
}

async function withFence(db, env, provider, callback) {
  if (provider === 'sqlite') {
    // Development/test adapter. Production is PostgreSQL under ADR-018.
    return db.$transaction(async tx => {
      await tx.$executeRawUnsafe('UPDATE "LineConversationJob" SET "id" = "id" WHERE 1 = 0')
      return callback(tx)
    }, { maxWait: 5000, timeout: 90000, isolationLevel: 'Serializable' })
  }
  const connectionString = resolvePostgresUrl(env)
  if (!connectionString) throw new Error('MSP_RETENTION_DB_CONFIGURATION_INVALID')
  const connection = new pg.Client({ connectionString, connectionTimeoutMillis: 5000, application_name: 'zuri_msp_retention' })
  let connectionError = null
  connection.on('error', error => { connectionError = error })
  try {
    await connection.connect()
    await connection.query('BEGIN')
    await connection.query("SET LOCAL lock_timeout = '5s'")
    // No interactive-transaction lease may release this fence while a killed
    // MSP PID's actual exit is still unconfirmed. The HTTP caller can time out;
    // this server-side connection continues holding the fence until exit.
    await connection.query('SET LOCAL idle_in_transaction_session_timeout = 0')
    await connection.query('LOCK TABLE "LineConversationJob" IN SHARE ROW EXCLUSIVE MODE')
    await connection.query('LOCK TABLE "TenantRetentionOverride" IN SHARE MODE')
    if (connectionError) throw connectionError
    const result = await callback(db)
    if (connectionError) throw connectionError
    await connection.query('COMMIT')
    return result
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => {})
    throw error
  } finally { await connection.end().catch(() => {}) }
}

export async function runMspRetentionSweep({ db = prisma, env = process.env, dryRun = false, now = new Date(), portFactory = defaultPort } = {}) {
  if (typeof dryRun !== 'boolean') throw new Error('MSP_RETENTION_DRY_RUN_INVALID')
  const config = resolveMspRetentionConfig(env), provider = providerOf(db)
  if (env.NODE_ENV === 'production' && provider !== 'postgresql') throw new Error('MSP_RETENTION_PRODUCTION_REQUIRES_POSTGRES')
  // Validate every deployment target before any provider mutation.
  for (const target of config.targets) {
    const space = await db.workspace.findFirst({ where: { id: target.workspaceId, status: 'ACTIVE' },
      select: { id: true, tenantId: true, business: { select: { tenantId: true } } } })
    if (!space || space.tenantId !== target.tenantId || space.business?.tenantId !== target.tenantId) throw new Error('MSP_RETENTION_SCOPE_INVALID')
  }
  const runId = randomUUID(), tenants = [], deadline = Date.now() + 75000
  for (const target of config.targets) {
    const { tenantId } = target
    const audit = (client, status, payload) => recordAudit(client, { entityType: 'MSP_RETENTION', entityId: runId,
      action: `MSP_RETENTION_${status}`, actorType: 'SYSTEM', tenantId, payload: { runId, dryRun, ...payload } })
    // Committed before external effects: survives a later rollback/lost ACK.
    await audit(db, provider === 'postgresql' ? 'REQUESTED' : 'STARTED', {})
    let outcome
    let attemptedProvider = false
    const totals = emptyCounts()
    if (Date.now() + 10000 > deadline) {
      outcome = { tenantId, status: 'DEFERRED', reason: 'RUN_BUDGET', tablesAffected: totals }
      const event = await audit(db, 'DEFERRED', outcome)
      tenants.push({ ...outcome, auditEventId: event.id })
      continue
    }
    try {
      outcome = await withFence(db, env, provider, async tx => {
        const finish = async value => {
          // PostgreSQL may lose its lock session during a provider call. Do
          // not publish a terminal audit until withFence confirms its COMMIT.
          if (provider === 'postgresql') return value
          const event = await audit(tx, value.status, value)
          return { ...value, auditEventId: event.id }
        }
        try { await createMspRetentionGate(tx, { excludeRunId: runId })({ tenantId }) }
        catch (error) {
          if (error.message !== 'MSP_RETENTION_IN_PROGRESS') throw error
          const value = { tenantId, status: 'DEFERRED', reason: 'PRIOR_RUN_UNSETTLED', tablesAffected: totals }
          return finish(value)
        }
        const pendingJobs = await tx.lineConversationJob.count({ where: { tenantId, OR: [
          { status: { notIn: TERMINAL } }, { memoryDeliveryState: { notIn: ['NONE', 'ACKNOWLEDGED', 'CLOSED'] } },
        ] } })
        if (pendingJobs) {
          const value = { tenantId, status: 'DEFERRED', pendingJobs, tablesAffected: totals }
          return finish(value)
        }
        const override = await tx.tenantRetentionOverride.findUnique({ where: { tenantId_dataClass: { tenantId, dataClass: 'MSP_SESSION_CONTENT' } } })
        if (override && (!Number.isInteger(override.windowDays) || override.windowDays < 1)) throw new Error('MSP_RETENTION_OVERRIDE_INVALID')
        const retentionDays = Math.min(config.retentionDays, override?.windowDays ?? 90)
        // PostgreSQL callback uses the separate Prisma pool: this STARTED is
        // committed before any child launches and survives a lock-session loss.
        if (provider === 'postgresql') await audit(db, 'STARTED', { runtimeHost: os.hostname() })
        const port = portFactory({ ...target, retentionDays, env: { ...env, MSP_THREAD_RETENTION_DAYS: String(retentionDays), ZURI_MSP_TIMEOUT_MS: '3000' } })
        let last, batches = 0, saturated = false
        do {
          attemptedProvider = true
          last = await port.tick({ dryRun }); batches++
          for (const key of MSP_RETENTION_COUNT_KEYS) totals[key] += last.tablesAffected[key]
          saturated = MSP_RETENTION_COUNT_KEYS.some(k => last.tablesAffected[k] === MSP_RETENTION_ROW_BOUND)
        } while (!dryRun && saturated && batches < MAX_BATCHES && Date.now() + 8000 < deadline)
        const status = dryRun ? 'DRY_RUN' : saturated ? 'PARTIAL' : 'COMPLETE'
        const value = { tenantId, status, retentionDays, cutoff: last.cutoff, batches, tablesAffected: totals }
        return finish(value)
      })
      if (!outcome.auditEventId) outcome.auditEventId = (await audit(db, outcome.status, outcome)).id
    } catch {
      // MSP may already have committed; never describe an uncertain call as zero.
      const status = attemptedProvider ? 'UNKNOWN' : 'FAILED'
      outcome = { tenantId, status, acknowledgedCounts: totals, reconciliationRequired: attemptedProvider }
      const event = await audit(db, status, outcome)
      outcome.auditEventId = event.id
    }
    tenants.push(outcome)
  }
  return { ok: tenants.every(t => ['COMPLETE', 'DRY_RUN'].includes(t.status)), runId, dryRun, observedAt: now.toISOString(), tenants }
}

// The deployment operator attests container shutdown through the guarded host
// script; the API cannot independently inspect the host's Docker daemon.
export async function reconcileMspRetentionRun({ db = prisma, env = process.env, runId, stoppedContainerId, proof, currentHost = os.hostname() } = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)
    || !/^[0-9a-f]{64}$/.test(stoppedContainerId) || !/^[0-9a-f]{12}$/.test(currentHost)
    || stoppedContainerId.startsWith(currentHost)) throw new Error('MSP_RETENTION_RECONCILE_INVALID')
  const config = resolveMspRetentionConfig(env), provider = providerOf(db)
  if (provider !== 'postgresql') throw new Error('MSP_RETENTION_RECONCILE_REQUIRES_POSTGRES')
  const attestation = verifyMspRetentionRecoveryProof({ proof, env, runId, stoppedContainerId, currentHost })
  return withFence(db, env, provider, async client => {
    const started = await client.auditEvent.findMany({ where: { entityType: 'MSP_RETENTION', entityId: runId, action: 'MSP_RETENTION_STARTED' } })
    if (!started.length) throw new Error('MSP_RETENTION_RECONCILE_NOT_FOUND')
    const allowed = new Set(config.targets.map(t => t.tenantId))
    // Refuse the entire operation before writing if any Tenant/origin mismatches.
    for (const event of started) {
      const origin = JSON.parse(event.payloadJson).runtimeHost
      if (!allowed.has(event.tenantId) || !/^[0-9a-f]{12}$/.test(origin) || !stoppedContainerId.startsWith(origin)) throw new Error('MSP_RETENTION_RECONCILE_SCOPE_MISMATCH')
    }
    const receipts = []
    for (const event of started) {
      const existing = await client.auditEvent.findFirst({ where: { entityType: 'MSP_RETENTION', entityId: runId, tenantId: event.tenantId, action: 'MSP_RETENTION_RECONCILED' } })
      const settled = await client.auditEvent.findFirst({ where: { entityType: 'MSP_RETENTION', entityId: runId, tenantId: event.tenantId,
        action: { in: ['MSP_RETENTION_COMPLETE', 'MSP_RETENTION_DRY_RUN', 'MSP_RETENTION_DEFERRED', 'MSP_RETENTION_PARTIAL', 'MSP_RETENTION_UNKNOWN', 'MSP_RETENTION_FAILED'] } } })
      if (settled && !existing) throw new Error('MSP_RETENTION_RECONCILE_ALREADY_SETTLED')
      const receipt = existing ?? await recordAudit(client, { entityType: 'MSP_RETENTION', entityId: runId, tenantId: event.tenantId,
        action: 'MSP_RETENTION_RECONCILED', actorType: 'SYSTEM', reason: 'DEPLOYMENT_OPERATOR_CONFIRMED_CONTAINER_STOPPED',
        payload: { runId, startedAuditEventId: event.id, stoppedContainerId, replacementContainerHost: currentHost,
          operatorAuthority: 'SIGNED_HOST_STOPPED_CONTAINER_ATTESTATION', proofNonce: attestation.nonce, proofIssuedAt: attestation.issuedAt } })
      receipts.push(receipt.id)
    }
    return { ok: true, runId, reconciled: true, auditEventIds: receipts }
  })
}
