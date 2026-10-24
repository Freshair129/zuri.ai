import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import { randomUUID, randomBytes, generateKeyPairSync, sign } from 'node:crypto'
import { PrismaClient as SqliteClient } from '@prisma/client'
import { PrismaClient as PostgresClient } from '@zuri/prisma-postgres'
import pg from 'pg'
import prisma from '@/lib/db'
import { runMspRetentionSweep, reconcileMspRetentionRun } from '@/modules/agent/msp-retention-service'
import { createMspRetentionGate } from '@/modules/agent/msp-retention-gate'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { createPortfolio, createTenant, createBusiness, createWorkspace } from '../factories/scope'

// @req FR-230 — real-engine write fence before provider tombstoning.
// @spec SEC-031, ADR-091 — no live admission may race the retention scan.
// @tested this file
let tenant, workspace, runtime = prisma, restricted, role, admin, runtimeConnectionString
const postgres = prisma._engineConfig.activeProvider === 'postgresql'
const url = inject('testDatabaseUrl')
const counts = { threadMessages: 0, protectedMemoryRecords: 0, sessionSummaries: 0, threadDeliveryReceipts: 0, threadPendingDeliveries: 0 }
beforeAll(async () => {
  const code = randomUUID().slice(0, 8)
  const portfolio = await createPortfolio({ code: `PF-RET-${code}`, name: 'Retention fixture' })
  tenant = await createTenant({ portfolioId: portfolio.id, code: `T-RET-${code}`, name: 'Retention tenant' })
  const business = await createBusiness({ tenantId: tenant.id, code: `B-RET-${code}`, name: 'Retention business' })
  workspace = await createWorkspace({ businessId: business.id, scopeType: 'BUSINESS', code: `W-RET-${code}`, name: 'Retention space' })
  if (postgres) {
    admin = new pg.Client({ connectionString: url }); await admin.connect()
    role = `retention_${code.replaceAll('-', '')}`
    const password = randomBytes(24).toString('hex')
    await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`)
    await admin.query(`GRANT USAGE ON SCHEMA public TO "${role}"`)
    await admin.query(`GRANT SELECT ON "Workspace", "Business", "TenantRetentionOverride", "LineConversationJob" TO "${role}"`)
    await admin.query(`GRANT INSERT, SELECT ON "AuditEvent" TO "${role}"`)
    // Same ordinary UPDATE permission as production runtime; no ownership/superuser.
    await admin.query(`GRANT UPDATE ON "LineConversationJob", "TenantRetentionOverride" TO "${role}"`)
    const runtimeUrl = new URL(url); runtimeUrl.username = role; runtimeUrl.password = password
    runtimeConnectionString = runtimeUrl.href
    restricted = new PostgresClient({ datasources: { db: { url: runtimeUrl.href } } }); runtime = restricted
  }
})
afterAll(async () => {
  await restricted?.$disconnect()
  if (admin) { try { await admin.query(`DROP OWNED BY "${role}"`); await admin.query(`DROP ROLE "${role}"`) } finally { await admin.end() } }
})
describe('MSP real database maintenance fence', () => {
  it.runIf(postgres)('refuses a second provider after the first fence connection is lost', async () => {
    const env = { DATABASE_URL: runtimeConnectionString, MSP_THREAD_RETENTION_DAYS: '30', ZURI_MSP_RETENTION_TENANTS: JSON.stringify({ [tenant.id]: workspace.id }),
      ZURI_MSP_THREAD_WORKSPACE_ID: workspace.id, ZURI_MSP_THREAD_SERVICE_KEY: 'k'.repeat(40), MSP_THREAD_SERVICE_KEYRING: JSON.stringify({ [tenant.id]: 'k'.repeat(40) }) }
    let heldResolve, releaseResolve, calls = 0
    const held = new Promise(r => { heldResolve = r }), release = new Promise(r => { releaseResolve = r })
    const first = runMspRetentionSweep({ db: runtime, env, portFactory: () => ({ tick: async () => {
      calls++; heldResolve(); await release
      return { dryRun: false, cutoff: new Date().toISOString(), tablesAffected: counts }
    } }) })
    await Promise.race([held, first.then(v => { throw new Error(`EARLY_SWEEP:${v.ok}`) })])
    try {
      const killed = await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'zuri_msp_retention' AND usename = $1", [role])
      expect(killed.rowCount).toBe(1)
      const second = await runMspRetentionSweep({ db: runtime, env, portFactory: () => { calls++; throw new Error('OVERLAPPING_PROVIDER') } })
      expect(second.tenants[0]).toMatchObject({ status: 'DEFERRED', reason: 'PRIOR_RUN_UNSETTLED' })
      expect(calls).toBe(1)
      await expect(createMspRetentionGate(runtime)({ tenantId: tenant.id })).rejects.toThrow('MSP_RETENTION_IN_PROGRESS')
    } finally { releaseResolve(); await first }
    await expect(createMspRetentionGate(runtime)({ tenantId: tenant.id })).resolves.toBeUndefined()
  })
  it('blocks an independent LINE table writer while the MSP call is in flight', async () => {
    const env = { DATABASE_URL: runtimeConnectionString, MSP_THREAD_RETENTION_DAYS: '30', ZURI_MSP_RETENTION_TENANTS: JSON.stringify({ [tenant.id]: workspace.id }),
      ZURI_MSP_THREAD_WORKSPACE_ID: workspace.id, ZURI_MSP_THREAD_SERVICE_KEY: 'k'.repeat(40),
      MSP_THREAD_SERVICE_KEYRING: JSON.stringify({ [tenant.id]: 'k'.repeat(40) }) }
    let heldResolve, releaseResolve
    const held = new Promise(r => { heldResolve = r }), release = new Promise(r => { releaseResolve = r })
    const run = runMspRetentionSweep({ db: runtime, env, portFactory: () => ({ tick: async () => {
      heldResolve(); await release
      return { dryRun: false, cutoff: new Date(Date.now() - 30 * 86400000).toISOString(), tablesAffected: counts }
    } }) })
    // A failing sweep must wake the waiter rather than hanging the fixture.
    const observed = run.then(value => { throw new Error(`SWEEP_FINISHED_BEFORE_FENCE:${value.ok}`) })
    await Promise.race([held, observed])
    try {
      if (postgres) await expect(createMspRetentionGate(runtime)({ tenantId: tenant.id })).rejects.toThrow('MSP_RETENTION_IN_PROGRESS')
      if (postgres) {
        const other = new pg.Client({ connectionString: url }); await other.connect()
        try {
          await other.query('BEGIN'); await other.query("SET LOCAL lock_timeout = '100ms'")
          await expect(other.query('UPDATE "LineConversationJob" SET "id" = "id" WHERE 1 = 0')).rejects.toMatchObject({ code: '55P03' })
        } finally { await other.query('ROLLBACK'); await other.end() }
      } else {
        const other = new SqliteClient({ datasources: { db: { url } } })
        try {
          await other.$queryRawUnsafe('PRAGMA busy_timeout = 100')
          await expect(other.$executeRawUnsafe('UPDATE "LineConversationJob" SET "id" = "id" WHERE 1 = 0')).rejects.toThrow(/locked|timed out|timeout/i)
        } finally { await other.$disconnect() }
      }
    } finally { releaseResolve() }
    const result = await run
    expect(result.ok).toBe(true)
    expect(result.tenants[0].status).toBe('COMPLETE')
    const audit = await prisma.auditEvent.findUnique({ where: { id: result.tenants[0].auditEventId } })
    expect(audit.action).toBe('MSP_RETENTION_COMPLETE'); expect(audit.tenantId).toBe(tenant.id)
    await expect(createMspRetentionGate(prisma)({ tenantId: tenant.id })).resolves.toBeUndefined()
    // Writer can proceed again after the retention transaction releases its fence.
    expect(await prisma.$executeRawUnsafe('UPDATE "LineConversationJob" SET "id" = "id" WHERE 1 = 0')).toBe(0)
  })
  it('persists an outstanding STARTED across new gate instances and isolates its Tenant/run', async () => {
    const runId = randomUUID()
    const write = (tenantId, action, entityId = runId) => recordAudit(prisma, { entityType: 'MSP_RETENTION', entityId, action, tenantId, actorType: 'SYSTEM' })
    await write(tenant.id, 'MSP_RETENTION_STARTED')
    await write(randomUUID(), 'MSP_RETENTION_COMPLETE')
    await write(tenant.id, 'MSP_RETENTION_COMPLETE', randomUUID())
    await expect(createMspRetentionGate(prisma)({ tenantId: tenant.id })).rejects.toThrow('MSP_RETENTION_IN_PROGRESS')
    await expect(createMspRetentionGate(prisma)({ tenantId: randomUUID() })).resolves.toBeUndefined()
    // Explicit operator reconciliation, not a later unrelated sweep, releases it.
    await write(tenant.id, 'MSP_RETENTION_RECONCILED')
    await expect(createMspRetentionGate(prisma)({ tenantId: tenant.id })).resolves.toBeUndefined()
  })
  it.runIf(postgres)('reconciles only the configured Tenant/run from a different, stopped-container origin', async () => {
    const runId = randomUUID(), origin = 'a'.repeat(12)
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const env = { DATABASE_URL: runtimeConnectionString, MSP_THREAD_RETENTION_DAYS: '30',
      ZURI_MSP_RETENTION_TENANTS: JSON.stringify({ [tenant.id]: workspace.id }), ZURI_MSP_THREAD_WORKSPACE_ID: workspace.id,
      ZURI_MSP_THREAD_SERVICE_KEY: 'k'.repeat(40), MSP_THREAD_SERVICE_KEYRING: JSON.stringify({ [tenant.id]: 'k'.repeat(40) }),
      ZURI_MSP_RETENTION_PROJECT: 'zuri-retention-test', ZURI_MSP_RETENTION_APP_REVISION: 'd'.repeat(40),
      ZURI_MSP_RETENTION_RECOVERY_PUBLIC_KEY: Buffer.from(publicKey.export({ format: 'pem', type: 'spki' })).toString('base64') }
    await recordAudit(prisma, { entityType: 'MSP_RETENTION', entityId: runId, action: 'MSP_RETENTION_STARTED', tenantId: tenant.id,
      payload: { runtimeHost: origin }, actorType: 'SYSTEM' })
    await expect(createMspRetentionGate(prisma)({ tenantId: tenant.id })).rejects.toThrow('MSP_RETENTION_IN_PROGRESS')
    const signed = stoppedContainerId => { const claims = { runId, stoppedContainerId, currentContainerId: 'b'.repeat(64), project: env.ZURI_MSP_RETENTION_PROJECT,
      appRevision: env.ZURI_MSP_RETENTION_APP_REVISION, issuedAt: Date.now(), expiresAt: Date.now() + 60000, nonce: randomUUID() }
      return { claims, signature: sign(null, Buffer.from(JSON.stringify(claims)), privateKey).toString('base64url') } }
    const input = { db: runtime, env, runId, stoppedContainerId: 'a'.repeat(64), currentHost: 'b'.repeat(12), proof: signed('a'.repeat(64)) }
    await expect(reconcileMspRetentionRun({ ...input, currentHost: origin })).rejects.toThrow('MSP_RETENTION_RECONCILE_INVALID')
    await expect(reconcileMspRetentionRun({ ...input, stoppedContainerId: 'c'.repeat(64), proof: signed('c'.repeat(64)) })).rejects.toThrow('MSP_RETENTION_RECONCILE_SCOPE_MISMATCH')
    const receipt = await reconcileMspRetentionRun(input)
    expect(receipt.ok).toBe(true)
    expect((await reconcileMspRetentionRun(input)).auditEventIds).toEqual(receipt.auditEventIds)
    await expect(createMspRetentionGate(prisma)({ tenantId: tenant.id })).resolves.toBeUndefined()
    const audit = await prisma.auditEvent.findUnique({ where: { id: receipt.auditEventIds[0] } })
    expect(audit.reason).toBe('DEPLOYMENT_OPERATOR_CONFIRMED_CONTAINER_STOPPED')
    const settledRun = randomUUID()
    await recordAudit(prisma, { entityType: 'MSP_RETENTION', entityId: settledRun, action: 'MSP_RETENTION_STARTED', tenantId: tenant.id, payload: { runtimeHost: origin }, actorType: 'SYSTEM' })
    await recordAudit(prisma, { entityType: 'MSP_RETENTION', entityId: settledRun, action: 'MSP_RETENTION_COMPLETE', tenantId: tenant.id, actorType: 'SYSTEM' })
    const settledClaims = { ...signed('a'.repeat(64)).claims, runId: settledRun }
    const proof = { claims: settledClaims, signature: sign(null, Buffer.from(JSON.stringify(settledClaims)), privateKey).toString('base64url') }
    await expect(reconcileMspRetentionRun({ ...input, runId: settledRun, proof })).rejects.toThrow('MSP_RETENTION_RECONCILE_ALREADY_SETTLED')
    expect(await prisma.auditEvent.count({ where: { entityId: settledRun, action: 'MSP_RETENTION_RECONCILED' } })).toBe(0)
  })
})
