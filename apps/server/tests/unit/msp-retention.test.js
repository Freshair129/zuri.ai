import { describe, expect, it, vi } from 'vitest'
import { createHash, createHmac, generateKeyPairSync, sign } from 'node:crypto'
import { resolveMspRetentionConfig, createMspRetentionPort } from '@/modules/agent/msp-retention-port.mjs'
import { runMspRetentionSweep } from '@/modules/agent/msp-retention-service'
import { createMspRetentionGate } from '@/modules/agent/msp-retention-gate'
import { createMspThreadMemoryPort } from '@/modules/agent/msp-thread-memory-port'
import { verifyMspRetentionRecoveryProof } from '@/modules/agent/msp-retention-recovery.mjs'

// @req FR-230 — signed, tenant-bound scheduled memory retention and live-job fence.
// @spec SEC-031, ADR-091
const tenantId = '00000000-0000-4000-8000-000000000001', workspaceId = '00000000-0000-4000-8000-000000000002', key = 'k'.repeat(40)
const env = () => ({ ZURI_MSP_RETENTION_TENANTS: JSON.stringify({ [tenantId]: workspaceId }),
  ZURI_MSP_THREAD_WORKSPACE_ID: workspaceId, ZURI_MSP_THREAD_SERVICE_KEY: key,
  MSP_THREAD_SERVICE_KEYRING: JSON.stringify({ [tenantId]: key }), MSP_THREAD_RETENTION_DAYS: '30' })
const zero = () => ({ threadMessages: 0, protectedMemoryRecords: 0, sessionSummaries: 0, threadDeliveryReceipts: 0, threadPendingDeliveries: 0 })
const now = new Date('2026-10-24T00:00:00Z')
const result = (count = 0, dryRun = false) => ({ dryRun, cutoff: '2026-09-24T00:00:00.000Z', tablesAffected: { ...zero(), threadMessages: count } })
function fixture({ provider = 'sqlite', jobs = 0, override = null } = {}) {
  const order = [], audits = []
  const tx = { $queryRaw: vi.fn(async () => []), $executeRawUnsafe: vi.fn(async () => { order.push('lock') }),
    lineConversationJob: { count: vi.fn(async () => { order.push('jobs'); return jobs }) },
    tenantRetentionOverride: { findUnique: vi.fn(async () => override) },
    auditEvent: { create: vi.fn(async ({ data }) => { order.push(data.action); audits.push(data); return { id: `audit-${audits.length}` } }) } }
  const db = { ...tx, _engineConfig: { activeProvider: provider },
    workspace: { findFirst: vi.fn(async () => ({ id: workspaceId, tenantId, business: { tenantId } })) },
    $transaction: vi.fn(async fn => fn(tx)) }
  return { db, tx, order, audits }
}
describe('MSP maintenance authority', () => {
  it('defers a later sweep while a prior run remains unsettled', async () => {
    const f = fixture(), portFactory = vi.fn()
    f.tx.$queryRaw.mockResolvedValue([{ id: 'prior-started' }])
    const value = await runMspRetentionSweep({ db: f.db, env: env(), portFactory })
    expect(value.ok).toBe(false)
    expect(value.tenants[0]).toMatchObject({ status: 'DEFERRED', reason: 'PRIOR_RUN_UNSETTLED' })
    expect(portFactory).not.toHaveBeenCalled()
  })
  it('requires an expiring host-only Ed25519 proof bound to exact environment and container/run identities', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const recoveryEnv = { ZURI_MSP_RETENTION_RECOVERY_PUBLIC_KEY: Buffer.from(publicKey.export({ format: 'pem', type: 'spki' })).toString('base64'),
      ZURI_MSP_RETENTION_PROJECT: 'zuri-retention-test', ZURI_MSP_RETENTION_APP_REVISION: 'c'.repeat(40) }
    const claims = { runId: tenantId, stoppedContainerId: 'a'.repeat(64), currentContainerId: 'b'.repeat(64), project: recoveryEnv.ZURI_MSP_RETENTION_PROJECT,
      appRevision: recoveryEnv.ZURI_MSP_RETENTION_APP_REVISION, issuedAt: now.getTime(), expiresAt: now.getTime() + 60000, nonce: workspaceId }
    const proof = c => ({ claims: c, signature: sign(null, Buffer.from(JSON.stringify(c)), privateKey).toString('base64url') })
    const input = { env: recoveryEnv, runId: tenantId, stoppedContainerId: claims.stoppedContainerId, currentHost: 'b'.repeat(12), now: now.getTime() }
    expect(verifyMspRetentionRecoveryProof({ ...input, proof: proof(claims) })).toEqual(claims)
    for (const c of [{ ...claims, project: 'foreign' }, { ...claims, expiresAt: now.getTime() - 1 },
      { ...claims, currentContainerId: 'd'.repeat(64) }, { ...claims, appRevision: 'd'.repeat(40) }, { ...claims, stoppedContainerId: 'd'.repeat(64) }]) {
      expect(() => verifyMspRetentionRecoveryProof({ ...input, proof: proof(c) })).toThrow('MSP_RETENTION_RECOVERY_PROOF_INVALID')
    }
    expect(() => verifyMspRetentionRecoveryProof({ ...input, proof: { ...proof(claims), signature: 'f'.repeat(86) } })).toThrow()
    expect(() => verifyMspRetentionRecoveryProof({ ...input, proof: undefined })).toThrow()
  })
  it('denies a signed thread tool before transport when durable maintenance is outstanding or unreadable', async () => {
    const transport = vi.fn(), query = vi.fn()
    const gate = createMspRetentionGate({ $queryRaw: query })
    const thread = createMspThreadMemoryPort({ workspaceId, serviceKey: key, transport, maintenanceGate: gate })
    const route = { tenantId, threadKind: 'DIRECT', channelType: 'LINE', channelAccountId: 'oa', externalRoomRef: 'room' }
    query.mockResolvedValueOnce([{ id: 'started' }])
    await expect(thread.resolveThread(route)).rejects.toThrow('MSP_RETENTION_IN_PROGRESS')
    query.mockRejectedValueOnce(new Error('database credential must not leak'))
    await expect(thread.resolveThread(route)).rejects.toThrow('MSP_RETENTION_GATE_UNAVAILABLE')
    expect(transport).not.toHaveBeenCalled()
  })
  it('refuses absent/zero/invalid horizon, scope and keyring before use', () => {
    for (const changes of [{ MSP_THREAD_RETENTION_DAYS: '' }, { MSP_THREAD_RETENTION_DAYS: '0' },
      { MSP_THREAD_RETENTION_DAYS: '3.5' }, { MSP_THREAD_RETENTION_DAYS: 'Infinity' },
      { ZURI_MSP_RETENTION_TENANTS: '{}' }, { ZURI_MSP_RETENTION_TENANTS: '[]' },
      { MSP_THREAD_SERVICE_KEYRING: '{}' }, { MSP_THREAD_SERVICE_KEYRING: JSON.stringify({ [tenantId]: 'short' }) }]) {
      expect(() => resolveMspRetentionConfig({ ...env(), ...changes })).toThrow(/MSP_RETENTION_/)
    }
    expect(resolveMspRetentionConfig({ ...env(), MSP_THREAD_RETENTION_DAYS: '120' }).retentionDays).toBe(90)
    const foreign = '00000000-0000-4000-8000-000000000003'
    expect(() => resolveMspRetentionConfig({ ...env(), ZURI_MSP_RETENTION_TENANTS: JSON.stringify({ [tenantId]: workspaceId, [foreign]: workspaceId }),
      MSP_THREAD_SERVICE_KEYRING: JSON.stringify({ [tenantId]: key, [foreign]: key }) })).toThrow('MSP_RETENTION_CONFIG_INVALID')
    expect(() => resolveMspRetentionConfig({ ...env(), ZURI_MSP_THREAD_WORKSPACE_ID: foreign })).toThrow('MSP_RETENTION_LINE_COMPOSITION_MISMATCH')
    expect(() => resolveMspRetentionConfig({ ...env(), ZURI_MSP_THREAD_SERVICE_KEY: 'x'.repeat(40) })).toThrow('MSP_RETENTION_LINE_COMPOSITION_MISMATCH')
  })
  it('signs only retention with bounded tenant/operator authority and fresh nonces', async () => {
    const calls = [], transport = async (name, input) => { calls.push({ name, input }); return result(0, input.dry_run) }
    const port = createMspRetentionPort({ tenantId, workspaceId, serviceKey: key, retentionDays: 30, transport, clock: () => now.getTime() })
    await port.tick({ dryRun: false }); await port.tick({ dryRun: true })
    expect(Object.keys(port)).toEqual(['tick'])
    for (const { name, input } of calls) {
      expect(name).toBe('msp_thread_retention_tick')
      expect(Object.keys(input).sort()).toEqual(['access', 'dry_run'])
      const { grant, signature } = input.access
      expect(grant).toMatchObject({ tenantId, workspaceId, policyRevision: 'msp-retention-v1', operator: true, readPrivate: false, writePrivate: false, operation: name, expiresAt: now.getTime() + 60000 })
      expect(grant.payloadHash).toBe(createHash('sha256').update(JSON.stringify({ dry_run: input.dry_run })).digest('hex'))
      expect(signature).toBe(createHmac('sha256', key).update(JSON.stringify(grant)).digest('hex'))
    }
    expect(calls[0].input.access.grant.nonce).not.toBe(calls[1].input.access.grant.nonce)
  })
  it('refuses malformed/over-bound provider result or cutoff and mismatched dry-run', async () => {
    for (const value of [{}, { ...result(), cutoff: null }, result(201), { ...result(), dryRun: true },
      { ...result(), tablesAffected: { ...zero(), surprise: 1 } }, { ...result(), cutoff: now.toISOString() }]) {
      const port = createMspRetentionPort({ tenantId, workspaceId, serviceKey: key, retentionDays: 30, transport: async () => value, clock: () => now.getTime() })
      await expect(port.tick({ dryRun: false })).rejects.toThrow('MSP_RETENTION_RESULT_INVALID')
    }
  })
})
describe('MSP retention execution', () => {
  it('fences SQLite writes before checking jobs and calling MSP; PostgreSQL has a real-role test', async () => {
    const f = fixture(), factory = vi.fn(({ retentionDays, env: childEnv }) => {
      expect(retentionDays).toBe(30); expect(childEnv.MSP_THREAD_RETENTION_DAYS).toBe('30')
      return { tick: vi.fn(async () => { f.order.push('msp'); return result(2) }) }
    })
    const out = await runMspRetentionSweep({ db: f.db, env: env(), now, portFactory: factory })
    expect(out.ok).toBe(true); expect(out.tenants[0]).toMatchObject({ status: 'COMPLETE', tablesAffected: { threadMessages: 2 } })
    expect(f.order.indexOf('lock')).toBeLessThan(f.order.indexOf('jobs'))
    expect(f.order.indexOf('jobs')).toBeLessThan(f.order.indexOf('msp'))
    expect(f.audits.map(a => a.action)).toEqual(['MSP_RETENTION_STARTED', 'MSP_RETENTION_COMPLETE'])
  })
  it('skips all memory of a Tenant with any nonterminal or unknown job state', async () => {
    const f = fixture({ jobs: 1 }), factory = vi.fn()
    const out = await runMspRetentionSweep({ db: f.db, env: env(), now, portFactory: factory })
    expect(out.ok).toBe(false); expect(out.tenants[0].status).toBe('DEFERRED')
    expect(factory).not.toHaveBeenCalled()
    expect(f.tx.lineConversationJob.count.mock.calls[0][0]).toEqual({ where: { tenantId, OR: [
      { status: { notIn: ['RECORDED', 'FAILED', 'CANCELLED'] } }, { memoryDeliveryState: { notIn: ['NONE', 'ACKNOWLEDGED', 'CLOSED'] } },
    ] } })
  })
  it('honors downward Tenant overrides and stops saturated batches as PARTIAL', async () => {
    const f = fixture({ override: { windowDays: 7 } }), tick = vi.fn(async () => result(200))
    const factory = vi.fn(() => ({ tick }))
    const out = await runMspRetentionSweep({ db: f.db, env: env(), now, portFactory: factory })
    expect(factory.mock.calls[0][0].retentionDays).toBe(7)
    expect(out.ok).toBe(false); expect(out.tenants[0].status).toBe('PARTIAL'); expect(tick).toHaveBeenCalledTimes(10)
  })
  it('dry run reports one bounded snapshot without pretending to drain it', async () => {
    const f = fixture(), tick = vi.fn(async () => result(200, true))
    const out = await runMspRetentionSweep({ db: f.db, env: env(), now, dryRun: true, portFactory: () => ({ tick }) })
    expect(tick).toHaveBeenCalledTimes(1); expect(out.ok).toBe(true); expect(out.tenants[0].status).toBe('DRY_RUN')
  })
  it('keeps STARTED and records UNKNOWN without leaking provider errors after a lost ACK', async () => {
    const f = fixture()
    const out = await runMspRetentionSweep({ db: f.db, env: env(), now, portFactory: () => ({ tick: async () => { throw new Error('secret provider payload') } }) })
    expect(out.ok).toBe(false); expect(out.tenants[0].status).toBe('UNKNOWN')
    expect(f.audits.map(a => a.action)).toEqual(['MSP_RETENTION_STARTED', 'MSP_RETENTION_UNKNOWN'])
    expect(JSON.stringify([out, f.audits])).not.toContain('secret provider payload')
  })
  it('reports a failed local fence as FAILED, with no external reconciliation claim', async () => {
    const f = fixture(), factory = vi.fn()
    f.tx.$executeRawUnsafe.mockRejectedValue(new Error('lock timeout'))
    const out = await runMspRetentionSweep({ db: f.db, env: env(), now, portFactory: factory })
    expect(out.tenants[0]).toMatchObject({ status: 'FAILED', reconciliationRequired: false })
    expect(factory).not.toHaveBeenCalled()
  })
  it('refuses a foreign Workspace or unknown database provider before external work', async () => {
    const f = fixture(), factory = vi.fn()
    f.db.workspace.findFirst.mockResolvedValue(null)
    await expect(runMspRetentionSweep({ db: f.db, env: env(), now, portFactory: factory })).rejects.toThrow('MSP_RETENTION_SCOPE_INVALID')
    const other = fixture({ provider: 'mysql' })
    await expect(runMspRetentionSweep({ db: other.db, env: env(), now, portFactory: factory })).rejects.toThrow('MSP_RETENTION_DB_PROVIDER_INVALID')
    expect(factory).not.toHaveBeenCalled()
  })
  it('refuses the SQLite test adapter in production', async () => {
    const f = fixture()
    await expect(runMspRetentionSweep({ db: f.db, env: { ...env(), NODE_ENV: 'production' } })).rejects.toThrow('MSP_RETENTION_PRODUCTION_REQUIRES_POSTGRES')
    expect(f.audits).toEqual([])
  })
  it('rejects contradictory Workspace ancestry even when one parent matches', async () => {
    const f = fixture(), factory = vi.fn()
    for (const space of [{ id: workspaceId, tenantId, business: { tenantId: 'foreign' } },
      { id: workspaceId, tenantId: 'foreign', business: { tenantId } }, { id: workspaceId, tenantId: null, business: null },
      { id: workspaceId, tenantId, business: null }, { id: workspaceId, tenantId: null, business: { tenantId } }]) {
      f.db.workspace.findFirst.mockResolvedValue(space)
      await expect(runMspRetentionSweep({ db: f.db, env: env(), now, portFactory: factory })).rejects.toThrow('MSP_RETENTION_SCOPE_INVALID')
    }
    expect(factory).not.toHaveBeenCalled(); expect(f.audits).toEqual([])
  })
})
