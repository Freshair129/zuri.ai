// @req FR-252 — clean-target recovery and complete protected export are
// process-only, single-transaction operations with no destructive replacement.
// @spec docs/architecture/project-manager-system/26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md
// @tested tests/integration/phase-b-recovery.test.js

import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import pg from 'pg'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  PHASE_B_FAMILY_DELEGATES,
  PHASE_B_FAMILY_MODEL_NAMES,
  PHASE_B_RECOVERY_MANIFEST_VERSION,
  computeSnapshotSha256,
  computeTargetSchemaSha256,
} from '@/modules/project-manager/application/phase-b-backup'
import { restoredRow, SNAPSHOT_EXCLUDED_MODELS, SNAPSHOT_MODELS } from '@/modules/project-manager/application/backup-service'
import { consumeAgentApprovalRequest } from '@/modules/agent/approval-gateway'
import {
  createPrismaTransactionFacade,
  createPostgresRecoveryAdapter,
  loadFrozenSchemaInventory,
  runCleanTargetRestore,
  runProtectedExport,
} from '../../scripts/phase-b-recovery.mjs'
import { runCleanTargetRestoreCli } from '../../scripts/phase-b-clean-target-restore.mjs'
import { runProtectedExportCli } from '../../scripts/phase-b-protected-export.mjs'

const inventory = await loadFrozenSchemaInventory()
if (!inventory) throw new Error('The committed Phase B target inventory could not be loaded')
const validRecovery = async () => ({ valid: true })
const MARKETING_CUSTODY = ['MarketingExternalReport', 'MarketingReportBinding', 'MarketingReportPolicy']
const MISSION_MODELS = ['AgentMissionDraft', 'AgentMissionEvidence']
const POST_204_MODELS = ['BusinessAgentConfig', 'AgentApprovalRequest', 'AgentApprovalDecision', 'AgentApprovalNotification']
const POST_204_DELEGATES = POST_204_MODELS.map(name => name[0].toLowerCase() + name.slice(1))

function emptySnapshot() {
  return {
    schemaVersion: '1.0',
    phaseBRecovery: { version: PHASE_B_RECOVERY_MANIFEST_VERSION, requiredTables: [...PHASE_B_FAMILY_DELEGATES] },
    tables: {dependency:[],...Object.fromEntries(PHASE_B_FAMILY_DELEGATES.map((delegate) => [delegate, []]))},
  }
}

function completeSnapshot({ includePost204Models = true } = {}) {
  const snapshot = emptySnapshot()
  for (const model of SNAPSHOT_MODELS) {
    if (!includePost204Models && POST_204_DELEGATES.includes(model)) continue
    snapshot.tables[model] = []
  }
  return snapshot
}

function historicalCompleteSnapshot() {
  return completeSnapshot({ includePost204Models: false })
}

function exportedModelContract({ includePost204Models = true } = {}) {
  return {
    includedModels: SNAPSHOT_MODELS.filter(model => includePost204Models || !POST_204_DELEGATES.includes(model)),
    excludedModels: Object.keys(SNAPSHOT_EXCLUDED_MODELS),
  }
}

function historicalExportedModelContract() {
  return exportedModelContract({ includePost204Models: false })
}

function inventoryVariant({ applicationTables = inventory.applicationTables, schemaSha256 = inventory.schemaSha256 } = {}) {
  const variant = {
    schemaSha256,
    applicationTables: applicationTables.map(({ modelName, schemaName, tableName }) => ({ modelName, schemaName, tableName })),
    migrationTables: [...(inventory.migrationTables || [])],
  }
  variant.targetSchemaSha256 = computeTargetSchemaSha256(variant)
  return variant
}

function fakeAdapter(sourceInventory = inventory) {
  const events = []
  let applied = false
  const tx = {
    async setRowSecurityOff() { events.push('row-security-off') },
    async reconcileCatalog() { events.push('catalog') },
    async assertPrivileges({ write }) { events.push(write ? 'insert-privilege' : 'read-privilege') },
    async lockApplicationTables() { events.push('locks') },
    async countAllApplicationTables() {
      events.push(applied ? 'count-after' : 'count-before')
      return Object.fromEntries(sourceInventory.applicationTables.map(({ modelName }) => [modelName, 0]))
    },
    async reconcileSnapshot() { events.push('reconcile') },
    async commit() { events.push('commit') },
    async rollback() { events.push('rollback') },
  }
  return {
    events,
    async begin() { events.push('begin'); return tx },
    async close() { events.push('close') },
    markApplied() { applied = true },
  }
}

describe('Phase B offline recovery runners', () => {
  const BUSINESS_ADDED_MODELS = [
    'BusinessKpi', 'BusinessKpiObservation',
    'BusinessLeadMeasure', 'BusinessLeadMeasureValue', 'BusinessWeeklyCommitment', 'BusinessWigSession',
  ]
  // @req FR-022 — CustomerRetentionConsent and LegalHoldArchiveKey (ADR-093
  // 1.2.0) rebind the frozen inventory from 192 to 194 application tables, on
  // top of the FR-277 LineGroundingShadowComparison rebind; see the decision
  // doc's binding ladder for the historical entries this one continues.
  // @req FR-022 — the MSP memory erasure scan index on AgentTraceEvent rebinds
  // the schema hash; MemoryProjectionReceipt and the three Marketing custody
  // models compose the previous 198-table mapping; FR-269 adds two KPI and FR-270 four WIG tables.
  // @req FR-285 — BusinessAgentConfig extends the 204-table binding.
  // @req TASK-ZAI-010 — Agent approval request and decision models join the census;
  // both histories are portable, while restore invalidates every nonterminal request.
  // @req TASK-ZAI-011 — notification history joins portable snapshots and the pinned census.
  // @req TASK-ZAI-012 — mission draft/evidence join the complete portable recovery census.
  it('loads the committed pinned 212-table inventory and preserves prior mappings', () => {
    expect(inventory.applicationTables).toHaveLength(212)
    expect(inventory.schemaSha256).toBe('cb954d301f3c54229207b314df1bfe617eda83d8550bce450808be3743598a18')
    expect(inventory.targetSchemaSha256).toBe('f00f474c2917d2a9f8feb8ab0fe990c84afd82e60fb9f8c898546a26a240c76e')
    expect(inventory.applicationTables.map(({ modelName }) => modelName)).toEqual(
      expect.arrayContaining(['CustomerRetentionConsent', 'LegalHoldArchiveKey'])
    )
    expect(inventory.applicationTables.map(({ modelName }) => modelName)).toEqual(
      expect.arrayContaining(['SupplierCostLine', 'SupplierCostSheet', 'BusinessKeyResult', 'BusinessKeyResultCheckIn'])
    )
    expect(inventory.applicationTables.map(({ modelName }) => modelName)).toEqual(expect.arrayContaining([
      'ProjectApprovalRequest', 'NotionOAuthState', 'NotionWebhookReceipt', 'NotionWebhookVerificationToken', 'MemoryProjectionReceipt',
    ]))
    expect(inventory.applicationTables.map(({ modelName }) => modelName)).toEqual(expect.arrayContaining([
      'AgentApprovalRequest', 'AgentApprovalDecision', 'AgentApprovalNotification',
    ]))
    expect(inventory.applicationTables.map(({ modelName }) => modelName)).toEqual(expect.arrayContaining([
      'AgentMissionDraft', 'AgentMissionEvidence',
    ]))
    expect(PHASE_B_FAMILY_MODEL_NAMES).not.toContain('AgentApprovalRequest')
    expect(PHASE_B_FAMILY_MODEL_NAMES).not.toContain('AgentApprovalDecision')
    expect(PHASE_B_FAMILY_MODEL_NAMES).not.toContain('AgentApprovalNotification')
    expect(inventory.applicationTables.map(({ modelName }) => modelName)).toEqual(expect.arrayContaining(BUSINESS_ADDED_MODELS))
    const policyEntry = inventory.applicationTables.find(({ modelName }) => modelName === 'LineStockDisclosurePolicy')
    expect(policyEntry).toEqual({ modelName: 'LineStockDisclosurePolicy', schemaName: 'public', tableName: 'LineStockDisclosurePolicy' })
    expect(inventory.applicationTables.find(({ modelName }) => modelName === 'LineProductDisclosurePolicy'))
      .toEqual({ modelName: 'LineProductDisclosurePolicy', schemaName: 'public', tableName: 'LineProductDisclosurePolicy' })
    expect(Object.keys(SNAPSHOT_EXCLUDED_MODELS)).toContain('lineProductDisclosurePolicy')
    expect(SNAPSHOT_MODELS).not.toContain('lineProductDisclosurePolicy')
    expect(Object.keys(SNAPSHOT_EXCLUDED_MODELS)).toContain('lineStockDisclosurePolicy')
    expect(SNAPSHOT_MODELS).not.toContain('lineStockDisclosurePolicy')

    const previous208 = inventoryVariant({
      applicationTables: inventory.applicationTables.filter(({ modelName }) => !MISSION_MODELS.includes(modelName) && modelName !== 'LineStockDisclosurePolicy' && modelName !== 'LineProductDisclosurePolicy'),
      schemaSha256: '579afacd11ae1ad34c11183a9617896812c2af94d6b5c7187f382d3f37f418e8',
    })
    expect(previous208.applicationTables).toHaveLength(208)
    expect(previous208.targetSchemaSha256).toBe('af3a57bba8079615e6f8c85718e731eade38aa8de5840e78958231e50fc5e683')
  })

  it('refuses the previous 209-table Pipeline C1 binding after FR-235 composition', async () => {
    const previous = inventoryVariant({
      applicationTables: inventory.applicationTables.filter(({ modelName }) => !MISSION_MODELS.includes(modelName) && modelName !== 'LineProductDisclosurePolicy'),
      schemaSha256: 'd8ec4c28d9c3354305e4699f6d090148daedc52638da1c5bb2d17fbb136d8d21',
    })
    expect(previous.applicationTables).toHaveLength(209)
    expect(previous.targetSchemaSha256).toBe('dbbde65f8e637e738b0bc3fc5295871bd82641928828946092b11677647b1559')
    const dir = await mkdtemp(path.join(os.tmpdir(), 'phase-b-pipeline-c1-old-'))
    try {
      const file = path.join(dir, 'inventory.json')
      await writeFile(file, JSON.stringify(previous))
      await expect(loadFrozenSchemaInventory({ modulePath: file })).rejects.toMatchObject({ code: 'TARGET_SCHEMA_UNVERIFIED' })
      const adapter = fakeAdapter()
      const bytes = Buffer.from(JSON.stringify(emptySnapshot()))
      expect(await runCleanTargetRestore({ inventory: previous, adapter, snapshotBytes: bytes, expectedSnapshotSha256: computeSnapshotSha256(bytes), validateSnapshotRecovery: validRecovery })).toMatchObject({ status: 'REFUSED', errorCode: 'TARGET_SCHEMA_UNVERIFIED' })
      expect(await runProtectedExport({ inventory: previous, adapter, extractSnapshot: async () => ({ snapshot: historicalCompleteSnapshot(), ...historicalExportedModelContract() }), validateSnapshotRecovery: validRecovery })).toMatchObject({ status: 'REFUSED', errorCode: 'TARGET_SCHEMA_UNVERIFIED', snapshot: null })
      expect(() => createPrismaTransactionFacade({}, previous)).toThrow(/approved 212-table inventory/)
      expect(() => createPostgresRecoveryAdapter({ connectionString: 'postgresql://127.0.0.1/unused_pipeline_c1_old_qa', inventory: previous })).toThrow(/approved 212-table inventory/)
      expect(adapter.events).not.toContain('begin')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('counts excluded stock disclosure authority and refuses restore before any write when its target table is nonempty', async () => {
    const adapter = fakeAdapter()
    const originalBegin = adapter.begin
    adapter.begin = async (...args) => {
      const tx = await originalBegin(...args)
      tx.countAllApplicationTables = async () => ({
        ...Object.fromEntries(inventory.applicationTables.map(({ modelName }) => [modelName, 0])),
        LineStockDisclosurePolicy: 1,
      })
      return tx
    }
    const snapshotBytes = Buffer.from(JSON.stringify(emptySnapshot()))
    let insertCalls = 0
    const result = await runCleanTargetRestore({
      inventory,
      adapter,
      snapshotBytes,
      expectedSnapshotSha256: computeSnapshotSha256(snapshotBytes),
      confirmation: 'PHASE_B_EMPTY_TARGET',
      validateSnapshotRecovery: validRecovery,
      insertSnapshot: async () => { insertCalls++; return {} },
    })

    expect(result).toMatchObject({ status: 'REFUSED', errorCode: 'TARGET_NOT_EMPTY' })
    expect(result.targetCounts.LineStockDisclosurePolicy).toBe(1)
    expect(insertCalls).toBe(0)
    expect(adapter.events).toContain('rollback')
    expect(adapter.events).not.toContain('commit')
  })

  it('preserves Agent approval history but prevents a restored approved request from executing', async () => {
    const restored = restoredRow('agentApprovalRequest', {
      id: 'approval-restored-1', tenantId: 'tenant-1', businessId: 'business-1',
      requesterPersonId: 'person-1', actionName: 'deactivate_customer', tier: 4, quorum: 4,
      targetKind: 'CUSTOMER', customerId: 'customer-1', conversationId: null,
      targetVersion: 'v:3', inputDigest: 'digest', inputSummaryJson: '{}',
      status: 'APPROVED', expiresAt: new Date(Date.now() + 60_000), version: 7,
    })
    const historicalDecision = {
      id: 'approval-decision-1', requestId: restored.id, personId: 'owner-1', decision: 'APPROVE', version: 1,
    }
    expect(restored.status).toBe('RESTORE_INVALIDATED')
    expect(restored.version).toBe(8)
    expect(restoredRow('agentApprovalDecision', historicalDecision)).toEqual(historicalDecision)

    const tx = {
      agentApprovalRequest: { async findUnique() { return restored } },
      agentApprovalDecision: { async findFirst() { return null } },
    }
    await expect(consumeAgentApprovalRequest(tx, {
      requestId: restored.id, tenantId: restored.tenantId, requesterPersonId: restored.requesterPersonId,
      action: { name: restored.actionName, approvalTier: 'L4' }, target: { customerId: restored.customerId }, payload: {},
    })).rejects.toMatchObject({ message: 'AGENT_APPROVAL_REQUEST_NOT_OPEN', status: 409 })
  })

  it('preserves the exact previous 194 mappings and covers every current Prisma model', async () => {
    const previous = inventory.applicationTables.filter(({ modelName }) => !MARKETING_CUSTODY.includes(modelName)
      && modelName !== 'MemoryProjectionReceipt' && !BUSINESS_ADDED_MODELS.includes(modelName) && !POST_204_MODELS.includes(modelName)
      && !MISSION_MODELS.includes(modelName) && modelName !== 'LineStockDisclosurePolicy' && modelName !== 'LineProductDisclosurePolicy')
    expect(previous).toHaveLength(194)
    expect(createHash('sha256').update(JSON.stringify(previous)).digest('hex')).toBe('f170d8b0246546bdf903e7bc4142a85486dc2e20e76e1a532a5fb93a12a98c93')
    expect(completeSnapshot().tables).toHaveProperty('businessAgentConfig')
    expect(completeSnapshot().tables).toHaveProperty('agentApprovalRequest')
    expect(completeSnapshot().tables).toHaveProperty('agentApprovalDecision')
    expect(completeSnapshot().tables).toHaveProperty('agentApprovalNotification')
    expect(historicalCompleteSnapshot().tables).not.toHaveProperty('businessAgentConfig')
    expect(historicalCompleteSnapshot().tables).not.toHaveProperty('agentApprovalRequest')
    expect(historicalCompleteSnapshot().tables).not.toHaveProperty('agentApprovalDecision')
    expect(historicalCompleteSnapshot().tables).not.toHaveProperty('agentApprovalNotification')
    const bytes = await readFile(new URL('../../prisma/schema.prisma', import.meta.url))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(inventory.schemaSha256)
    expect(computeTargetSchemaSha256(inventory)).toBe(inventory.targetSchemaSha256)
    expect([...bytes.toString().matchAll(/^model\s+(\w+)\s*\{/gm)].map(match => match[1]).sort()).toEqual(inventory.applicationTables.map(entry => entry.modelName))
    for (const model of MARKETING_CUSTODY) {
      const delegate = model[0].toLowerCase() + model.slice(1)
      expect(SNAPSHOT_MODELS).not.toContain(delegate)
      expect(SNAPSHOT_EXCLUDED_MODELS[delegate]).toMatch(/custody|history|immutable/)
      expect(PHASE_B_FAMILY_DELEGATES).not.toContain(delegate)
    }
  })

  it('includes all 212 tables in the actual PostgreSQL adapter catalog, privileges, locks and census', async () => {
    const queries = []
    const client = { release() {}, async query(sql, values) {
      queries.push({ sql, values })
      if (sql.includes('information_schema.columns')) return {rows:[{data_type:'text',is_nullable:'YES'}]}
      if (sql.includes('pg_catalog.pg_class')) return { rows: inventory.applicationTables }
      if (sql.includes('has_table_privilege')) return { rows: [{ canSelect: true, canInsert: true }] }
      if (sql.startsWith('SELECT COUNT')) return { rows: [{ count: '0' }] }
      return { rows: [] }
    } }
    const connect = vi.spyOn(pg.Pool.prototype, 'connect').mockResolvedValue(client)
    const adapter = createPostgresRecoveryAdapter({ connectionString: 'postgresql://127.0.0.1/unused_phase_b_adapter_qa', inventory })
    try {
      const tx = await adapter.begin()
      expect(await tx.reconcileCatalog()).toEqual({ expectedCount: 212, catalogCount: 212 })
      await tx.assertPrivileges({ write: true })
      await tx.lockApplicationTables()
      expect(Object.keys(await tx.countAllApplicationTables()).sort()).toEqual(inventory.applicationTables.map(entry => entry.modelName))
      const names = inventory.applicationTables.map(entry => `"public"."${entry.tableName}"`)
      expect(queries.filter(query => query.sql.includes('has_table_privilege')).map(query => query.values[0])).toEqual(names)
      expect(queries.filter(query => query.sql.startsWith('LOCK TABLE') && query.sql.includes('SHARE ROW EXCLUSIVE')).map(query => query.sql)).toEqual(names.map(name => `LOCK TABLE ${name} IN SHARE ROW EXCLUSIVE MODE`))
      expect(queries.filter(query => query.sql.startsWith('SELECT COUNT'))).toHaveLength(212)
      await tx.rollback()
    } finally { connect.mockRestore(); await adapter.close() }
  })

  for (const model of MARKETING_CUSTODY) {
    it(`denies missing ${model} PostgreSQL privileges and bounded lock failures`, async () => {
      for (const failure of ['privilege', 'lock']) {
        const client = { release() {}, async query(sql, values) {
          if (sql.includes('has_table_privilege')) return { rows: [{ canSelect: values[0] !== `"public"."${model}"`, canInsert: true }] }
          if (sql === `LOCK TABLE "public"."${model}" IN SHARE ROW EXCLUSIVE MODE`) throw Error('bounded lock unavailable')
          return { rows: [] }
        } }
        const connect = vi.spyOn(pg.Pool.prototype, 'connect').mockResolvedValue(client)
        const adapter = createPostgresRecoveryAdapter({ connectionString: 'postgresql://127.0.0.1/unused_phase_b_adapter_qa', inventory })
        try {
          const tx = await adapter.begin()
          await expect(failure === 'privilege' ? tx.assertPrivileges({ write: true }) : tx.lockApplicationTables()).rejects.toMatchObject({ code: failure === 'privilege' ? 'TARGET_PRIVILEGE_UNAVAILABLE' : 'TARGET_LOCK_UNAVAILABLE' })
          await tx.rollback()
        } finally { connect.mockRestore(); await adapter.close() }
      }
    })
  }

  it('refuses the previous 204-model binding after the FR-285 rebind', async () => {
    const previous = inventoryVariant({
      applicationTables: inventory.applicationTables.filter(({ modelName }) => !MISSION_MODELS.includes(modelName) && !POST_204_MODELS.includes(modelName) && modelName !== 'LineStockDisclosurePolicy' && modelName !== 'LineProductDisclosurePolicy'),
      schemaSha256: '1bf50bdc16737c19116801eee4dd83cc8c0326e6c7b79d440b62caff29744175',
    })
    expect(previous.applicationTables).toHaveLength(204)
    expect(previous.targetSchemaSha256).toBe('75f208f0ed5b13353193ff74e1ff2e86222430c08d03e11148e332fc3f93edae')
    const dir = await mkdtemp(path.join(os.tmpdir(), 'phase-b-fr285-old-'))
    try {
      const file = path.join(dir, 'inventory.json')
      await writeFile(file, JSON.stringify(previous))
      await expect(loadFrozenSchemaInventory({ modulePath: file })).rejects.toMatchObject({ code: 'TARGET_SCHEMA_UNVERIFIED' })
      const adapter = fakeAdapter()
      const bytes = Buffer.from(JSON.stringify(emptySnapshot()))
      expect(await runCleanTargetRestore({ inventory: previous, adapter, snapshotBytes: bytes, expectedSnapshotSha256: computeSnapshotSha256(bytes), validateSnapshotRecovery: validRecovery })).toMatchObject({ status: 'REFUSED', errorCode: 'TARGET_SCHEMA_UNVERIFIED' })
      expect(await runProtectedExport({ inventory: previous, adapter, extractSnapshot: async () => ({ snapshot: historicalCompleteSnapshot(), ...historicalExportedModelContract() }), validateSnapshotRecovery: validRecovery })).toMatchObject({ status: 'REFUSED', errorCode: 'TARGET_SCHEMA_UNVERIFIED', snapshot: null })
      expect(adapter.events).not.toContain('begin')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('refuses the last valid 194-model binding at every runner and loader boundary', async () => {
    const previous = inventoryVariant({ applicationTables: inventory.applicationTables.filter(({ modelName }) => !MARKETING_CUSTODY.includes(modelName)
      && modelName !== 'MemoryProjectionReceipt' && !BUSINESS_ADDED_MODELS.includes(modelName) && !POST_204_MODELS.includes(modelName)
      && !MISSION_MODELS.includes(modelName) && modelName !== 'LineStockDisclosurePolicy' && modelName !== 'LineProductDisclosurePolicy'), schemaSha256: '32eb25fc477a50457014e2e8b106fd58a4d5eed0666b46a3e98e7bcba66330d4' })
    expect(previous.targetSchemaSha256).toBe('9dfbf9b736a46b2191cc8c72b843b090563af0198359b7015b5654dd08506aa0')
    const dir = await mkdtemp(path.join(os.tmpdir(), 'phase-b-marketing-old-'))
    try {
      const file = path.join(dir, 'inventory.json')
      await writeFile(file, JSON.stringify(previous))
      await expect(loadFrozenSchemaInventory({ modulePath: file })).rejects.toMatchObject({ code: 'TARGET_SCHEMA_UNVERIFIED' })
      const adapter = fakeAdapter()
      const bytes = Buffer.from(JSON.stringify(emptySnapshot()))
      expect(await runCleanTargetRestore({ inventory: previous, adapter, snapshotBytes: bytes, expectedSnapshotSha256: computeSnapshotSha256(bytes), validateSnapshotRecovery: validRecovery })).toMatchObject({ status: 'REFUSED', errorCode: 'TARGET_SCHEMA_UNVERIFIED' })
      expect(await runProtectedExport({ inventory: previous, adapter, extractSnapshot: async () => ({ snapshot: historicalCompleteSnapshot(), ...historicalExportedModelContract() }), validateSnapshotRecovery: validRecovery })).toMatchObject({ status: 'REFUSED', errorCode: 'TARGET_SCHEMA_UNVERIFIED', snapshot: null })
      expect(adapter.events).not.toContain('begin')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  for (const historical of [
    { name: 'FR-291 209-model predecessor', schemaSha256: 'fe67a5c5ed02710cdb67227e80380812f233f88ab5a3638f7079527c056b1808', targetSchemaSha256: 'db2e0014754558f8e21fdcad9960565cfccd150343e71b0ae614589b9429e633', omit: [...MISSION_MODELS, 'LineProductDisclosurePolicy'] },
    // FR-001 adds archive/version columns without adding or remapping tables.
    // The previous same-count schema must not pass the current recovery fence.
    { name: 'FR-001 208-model predecessor', schemaSha256: '579afacd11ae1ad34c11183a9617896812c2af94d6b5c7187f382d3f37f418e8', targetSchemaSha256: 'af3a57bba8079615e6f8c85718e731eade38aa8de5840e78958231e50fc5e683', omit: [...MISSION_MODELS, 'LineStockDisclosurePolicy', 'LineProductDisclosurePolicy'] },
    { name: 'TASK-ZAI-011 208-model predecessor', schemaSha256: '47efde1279bc107458cfa28b9e80920df60555089b8763d7634b550c0e9e661b', targetSchemaSha256: 'cb2449ec562fbf9217956442a48b34eac948c74873d7c24f85a2593fd12df38c', omit: [...MISSION_MODELS, 'LineStockDisclosurePolicy', 'LineProductDisclosurePolicy'] },
    // FR-286 changes columns, not the 205 model mappings. A same-count prior
    // schema is still a distinct historical binding, refused at every boundary.
    { name: 'FR-285 205-model predecessor', schemaSha256: '9dc731a7fb749d147f285e0c5eafa3b494b0c67007bdba48f1c094ef06e8aefa', targetSchemaSha256: '9d8c464cbe8d07500dfe0515e85e434b9ab1454ac141f999978e1b8b6987a1c4', omit: [...MISSION_MODELS, 'AgentApprovalRequest', 'AgentApprovalDecision', 'AgentApprovalNotification', 'LineStockDisclosurePolicy', 'LineProductDisclosurePolicy'] },
    { name: 'API-010 195-model', schemaSha256: '73bbbff14159ed2549b9555d8bcb8fb851fec6fcb4a4ceeebd35196cbd33fbf1', targetSchemaSha256: '9b68b9b1faeb7960576a0f0a85ad8c82d7e0a941d8ab9499d80e97f7860a73a9', omit: [...MISSION_MODELS, ...MARKETING_CUSTODY, ...BUSINESS_ADDED_MODELS, ...POST_204_MODELS, 'LineStockDisclosurePolicy', 'LineProductDisclosurePolicy'] },
    { name: 'main 197-model', schemaSha256: '45d7a7001daa7ede78fe911d1752bf237a7c42218a51372ec4bb89bdd704de06', targetSchemaSha256: 'e9f5216b1e9368157dcfd5b926eb3798fac335f45d815615424324fe2909f65e', omit: [...MISSION_MODELS, 'MemoryProjectionReceipt', ...BUSINESS_ADDED_MODELS, ...POST_204_MODELS, 'LineStockDisclosurePolicy', 'LineProductDisclosurePolicy'] },
  ]) {
    it(`preserves and refuses the historical ${historical.name} binding at every runner and loader boundary`, async () => {
      const previous = inventoryVariant({ applicationTables: inventory.applicationTables.filter(({ modelName }) => !historical.omit.includes(modelName)), schemaSha256: historical.schemaSha256 })
      expect(previous.targetSchemaSha256).toBe(historical.targetSchemaSha256)
      const dir = await mkdtemp(path.join(os.tmpdir(), 'phase-b-composed-old-'))
      try {
        const file = path.join(dir, 'inventory.json')
        await writeFile(file, JSON.stringify(previous))
        await expect(loadFrozenSchemaInventory({ modulePath: file })).rejects.toMatchObject({ code: 'TARGET_SCHEMA_UNVERIFIED' })
        const adapter = fakeAdapter()
        const bytes = Buffer.from(JSON.stringify(emptySnapshot()))
        expect(await runCleanTargetRestore({ inventory: previous, adapter, snapshotBytes: bytes, expectedSnapshotSha256: computeSnapshotSha256(bytes), validateSnapshotRecovery: validRecovery })).toMatchObject({ status: 'REFUSED', errorCode: 'TARGET_SCHEMA_UNVERIFIED' })
        expect(await runProtectedExport({ inventory: previous, adapter, extractSnapshot: async () => ({ snapshot: historicalCompleteSnapshot(), ...historicalExportedModelContract() }), validateSnapshotRecovery: validRecovery })).toMatchObject({ status: 'REFUSED', errorCode: 'TARGET_SCHEMA_UNVERIFIED', snapshot: null })
        expect(() => createPrismaTransactionFacade({}, previous)).toThrow(/approved 212-table inventory/)
        expect(() => createPostgresRecoveryAdapter({ connectionString: 'postgresql://127.0.0.1/unused_composed_qa', inventory: previous })).toThrow(/approved 212-table inventory/)
        expect(adapter.events).not.toContain('begin')
      } finally { await rm(dir, { recursive: true, force: true }) }
    })
  }

  for (const model of MARKETING_CUSTODY) {
    for (const state of ['nonempty', 'missing', 'unreadable']) {
      it(`refuses ${state} ${model} custody before export or restore callbacks`, async () => {
        for (const operation of ['export', 'restore']) {
          const adapter = fakeAdapter()
          const original = adapter.begin
          adapter.begin = async (...args) => {
            const tx = await original(...args)
            tx.countAllApplicationTables = async () => {
              if (state === 'unreadable') throw new Error('count unavailable')
              const counts = Object.fromEntries(inventory.applicationTables.map(entry => [entry.modelName, 0]))
              if (state === 'missing') delete counts[model]
              else counts[model] = 1
              return counts
            }
            return tx
          }
          let callbacks = 0
          const snapshot = completeSnapshot()
          const bytes = Buffer.from(JSON.stringify(snapshot))
          const result = operation === 'export'
            ? await runProtectedExport({ inventory, adapter, validateSnapshotRecovery: validRecovery, extractSnapshot: async () => { callbacks++; return { snapshot, ...exportedModelContract() } } })
            : await runCleanTargetRestore({ inventory, adapter, snapshotBytes: bytes, expectedSnapshotSha256: computeSnapshotSha256(bytes), confirmation: 'PHASE_B_EMPTY_TARGET', validateSnapshotRecovery: validRecovery, insertSnapshot: async () => { callbacks++; return {} } })
          expect(result.status).toBe('REFUSED')
          expect(callbacks).toBe(0)
          expect(adapter.events).toContain('rollback')
          expect(adapter.events).not.toContain('commit')
          if (operation === 'export') expect(result.snapshot).toBeNull()
        }
      })
    }
    for (const location of ['delegate', 'model', 'top-level']) {
      it(`refuses unsupported empty ${model} ${location} fields even when shared validation accepts`, async () => {
        const snapshot = completeSnapshot()
        const delegate = model[0].toLowerCase() + model.slice(1)
        if (location === 'top-level') snapshot[delegate] = []
        else snapshot.tables[location === 'model' ? model : delegate] = []
        for (const operation of ['export', 'restore']) {
          const adapter = fakeAdapter()
          let inserts = 0
          const bytes = Buffer.from(JSON.stringify(snapshot))
          const result = operation === 'export'
            ? await runProtectedExport({ inventory, adapter, validateSnapshotRecovery: validRecovery, extractSnapshot: async () => ({ snapshot, ...exportedModelContract() }) })
            : await runCleanTargetRestore({ inventory, adapter, snapshotBytes: bytes, expectedSnapshotSha256: computeSnapshotSha256(bytes), confirmation: 'PHASE_B_EMPTY_TARGET', validateSnapshotRecovery: validRecovery, insertSnapshot: async () => { inserts++; return {} } })
          expect(result).toMatchObject({ status: 'REFUSED', errorCode: 'MARKETING_REPORT_LEGACY_BACKUP_UNSUPPORTED' })
          expect(inserts).toBe(0)
          expect(adapter.events).not.toContain('commit')
          if (operation === 'restore') expect(adapter.events).not.toContain('begin')
          else expect(result.snapshot).toBeNull()
        }
      })
    }
  }

  it('refuses the previous 194-table binding against the erasure-scan-index schema', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'phase-b-old-binding-194-'))
    const tempInventory = path.join(tempDir, 'previous-inventory.json')
    try {
      await writeFile(tempInventory, JSON.stringify({
        ...inventory,
        schemaSha256: '1f7fa96247a7af651cca6ca1cb157ae0d9b07f37e36262084967a20d36cc1206',
        targetSchemaSha256: '3b0841c3771ae0fafb4147c9622e86b6d1827cbb656d070113f22bd7e94b8c79',
      }))
      await expect(loadFrozenSchemaInventory({ modulePath: tempInventory }))
        .rejects.toMatchObject({ code: 'TARGET_SCHEMA_UNVERIFIED' })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('refuses the previous 192-table binding against the retention-consent schema', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'phase-b-old-binding-192-'))
    const tempInventory = path.join(tempDir, 'previous-inventory.json')
    try {
      const modelsAddedAfter192 = [
        'CustomerRetentionConsent',
        'LegalHoldArchiveKey',
        'MemoryProjectionReceipt',
        ...MARKETING_CUSTODY,
        ...BUSINESS_ADDED_MODELS,
        ...POST_204_MODELS,
        ...MISSION_MODELS,
        'LineStockDisclosurePolicy', 'LineProductDisclosurePolicy',
      ]
      const previous = {
        ...inventory,
        applicationTables: inventory.applicationTables.filter(({ modelName }) => !modelsAddedAfter192.includes(modelName)),
        schemaSha256: '94b6e5a55ff719afb82d9c8896ca47db6192cf48709d6976fd4cb38870d5231d',
      }
      previous.targetSchemaSha256 = computeTargetSchemaSha256(previous)
      expect(previous.applicationTables).toHaveLength(192)
      expect(previous.applicationTables.map(({ modelName }) => modelName)).toContain('LineGroundingShadowComparison')
      expect(previous.targetSchemaSha256).toBe('372a2af5602a7af64aef2ea77904f039c7666f4e44007c27b0caf4a74fa50885')
      await writeFile(tempInventory, JSON.stringify(previous))
      await expect(loadFrozenSchemaInventory({ modulePath: tempInventory }))
        .rejects.toMatchObject({ code: 'TARGET_SCHEMA_UNVERIFIED' })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('refuses the previous 191-table binding against the Message author schema', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'phase-b-old-binding-'))
    const tempInventory = path.join(tempDir, 'previous-inventory.json')
    try {
      await writeFile(tempInventory, JSON.stringify({
        ...inventory,
        schemaSha256: 'f17edcf1917e80825f6b1ec8e0e958fc9dae74b570195d5b3e0c6069eb7dd078',
        targetSchemaSha256: 'a3b354485036ccb70f84980f0af2676ddeee554fff0089b33eb0afe29f43d4d1',
      }))
      await expect(loadFrozenSchemaInventory({ modulePath: tempInventory }))
        .rejects.toMatchObject({ code: 'TARGET_SCHEMA_UNVERIFIED' })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('rejects a CRLF-mutated schema even with the approved inventory', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'phase-b-schema-'))
    const tempSchema = path.join(tempDir, 'schema.prisma')
    try {
      const schemaPath = new URL('../../prisma/schema.prisma', import.meta.url)
      const source = await readFile(schemaPath)
      const crlf = Buffer.from(source.toString('utf8').replace(/\r?\n/g, '\r\n'), 'utf8')
      await writeFile(tempSchema, crlf)
      await expect(loadFrozenSchemaInventory({ schemaPath: tempSchema })).resolves.toBeNull()
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('preflights without confirmation and inserts only after the exact confirmation', async () => {
    const snapshot = emptySnapshot()
    const bytes = Buffer.from(JSON.stringify(snapshot), 'utf8')
    const adapter = fakeAdapter()
    let insertCalls = 0
    const insertSnapshot = async () => { insertCalls += 1; adapter.markApplied(); return { insertedCounts: {} } }

    const ready = await runCleanTargetRestore({
      snapshotBytes: bytes,
      snapshot,
      expectedSnapshotSha256: computeSnapshotSha256(bytes),
      inventory,
      adapter,
      insertSnapshot,
      validateSnapshotRecovery: validRecovery,
    })
    expect(ready).toMatchObject({ status: 'READY', errorCode: null, schemaVisibility: 'FULL' })
    expect(insertCalls).toBe(0)
    expect(adapter.events).toContain('rollback')

    const restored = await runCleanTargetRestore({
      snapshotBytes: bytes,
      snapshot,
      expectedSnapshotSha256: computeSnapshotSha256(bytes),
      inventory,
      confirmation: 'PHASE_B_EMPTY_TARGET',
      adapter,
      insertSnapshot,
      validateSnapshotRecovery: validRecovery,
    })
    expect(restored).toMatchObject({ status: 'RESTORED', errorCode: null })
    expect(insertCalls).toBe(1)
    expect(Object.keys(ready.targetCounts)).toHaveLength(inventory.applicationTables.length)
    expect(Object.keys(restored.incomingCounts)).toHaveLength(inventory.applicationTables.length)
    expect(adapter.events.indexOf('locks')).toBeLessThan(adapter.events.indexOf('count-before'))
    expect(adapter.events).toContain('reconcile')
    expect(adapter.events).toContain('commit')
  })

  it('publishes no export result when the extraction boundary is unavailable', async () => {
    const adapter = fakeAdapter()
    const result = await runProtectedExport({ inventory, adapter, extractSnapshot: null })
    expect(result.status).toBe('REFUSED')
    expect(result.errorCode).toBe('TARGET_CONNECTION_UNAVAILABLE')
    expect(result.snapshot).toBeNull()
  })

  it('requires the six arrays to reconcile inside the repeatable-read transaction', async () => {
    const adapter = fakeAdapter()
    const snapshot = completeSnapshot()
    const contract = exportedModelContract()
    const result = await runProtectedExport({
      inventory,
      adapter,
      extractSnapshot: async () => ({ snapshot, ...contract }),
      validateSnapshotRecovery: validRecovery,
    })
    expect(result.status).toBe('EXPORTED')
    expect(result.snapshot.phaseBRecovery.requiredTables).toEqual(PHASE_B_FAMILY_DELEGATES)
    expect(result.schemaVisibility).toBe('FULL')
    expect(Object.keys(result.targetCounts)).toHaveLength(inventory.applicationTables.length)
    expect(Object.keys(result.incomingCounts)).toHaveLength(inventory.applicationTables.length)
    expect(adapter.events).toContain('commit')
  })

  it('refuses an included-model contract that omits an application table', async () => {
    const adapter = fakeAdapter()
    const snapshot = completeSnapshot()
    const contract = exportedModelContract()
    const result = await runProtectedExport({
      inventory,
      adapter,
      extractSnapshot: async () => ({ snapshot, includedModels: contract.includedModels.slice(1), excludedModels: contract.excludedModels }),
      validateSnapshotRecovery: validRecovery,
    })
    expect(result).toMatchObject({ status: 'REFUSED', errorCode: 'PHASE_B_EXPORT_COMPLETENESS_UNAVAILABLE' })
    expect(adapter.events).toContain('rollback')
  })

  it('requires the shared recovery validator before protected export begins', async () => {
    const snapshot = completeSnapshot()
    const contract = exportedModelContract()
    const unavailableAdapter = fakeAdapter()
    const unavailable = await runProtectedExport({
      inventory,
      adapter: unavailableAdapter,
      extractSnapshot: async () => ({ snapshot, ...contract }),
    })
    expect(unavailable).toMatchObject({ status: 'REFUSED', errorCode: 'PHASE_B_EXPORT_COMPLETENESS_UNAVAILABLE' })
    expect(unavailableAdapter.events).not.toContain('begin')

    const rejectedAdapter = fakeAdapter()
    const rejected = await runProtectedExport({
      inventory,
      adapter: rejectedAdapter,
      extractSnapshot: async () => ({ snapshot, ...contract }),
      validateSnapshotRecovery: async () => ({ valid: false }),
    })
    expect(rejected).toMatchObject({ status: 'REFUSED', errorCode: 'PHASE_B_EXPORT_COMPLETENESS_UNAVAILABLE' })
    expect(rejectedAdapter.events).toContain('begin')
    expect(rejectedAdapter.events).toContain('rollback')
    expect(rejectedAdapter.events).not.toContain('commit')

    const throwingAdapter = fakeAdapter()
    const thrown = await runProtectedExport({
      inventory,
      adapter: throwingAdapter,
      extractSnapshot: async () => ({ snapshot, ...contract }),
      validateSnapshotRecovery: async () => { throw new Error('validator failed') },
    })
    expect(thrown).toMatchObject({ status: 'REFUSED', errorCode: 'PHASE_B_EXPORT_COMPLETENESS_UNAVAILABLE' })
    expect(throwingAdapter.events).toContain('rollback')
  })

  it('rejects smaller or rehashed inventories at every executable boundary', async () => {
    const snapshot = historicalCompleteSnapshot()
    const bytes = Buffer.from(JSON.stringify(snapshot), 'utf8')
    // @req FR-277, FR-269 and FR-270 — every historical reconstruction below (each
    // built by filtering the CURRENT, live `inventory.applicationTables`)
    // must exclude it first — otherwise "current minus Notion" etc. counts
    // one model too many for a binding that predates FR-277 entirely, which
    // is exactly what broke this test the first time a model was added after
    // it was written. `beforeFr277` is the 191-entry Notion+runtimeOwner
    // mapping this PR's own binding was rebound from; the KPI and four WIG
    // models are also excluded because those historical schemas predate them.
    // @req FR-022 — likewise excludes the two ADR-093 1.2.0 models added after FR-277.
    // @req FR-285 — reconstructed pre-factory bodies also exclude BusinessAgentConfig.
    const AFTER_FR277 = ['LineGroundingShadowComparison', 'CustomerRetentionConsent', 'LegalHoldArchiveKey', 'MemoryProjectionReceipt', 'MarketingReportPolicy', 'MarketingReportBinding', 'MarketingExternalReport', ...BUSINESS_ADDED_MODELS, ...POST_204_MODELS, ...MISSION_MODELS, 'LineStockDisclosurePolicy', 'LineProductDisclosurePolicy']
    const beforeFr277 = inventory.applicationTables.filter(({ modelName }) => !AFTER_FR277.includes(modelName))
    const smaller = inventoryVariant({ applicationTables: inventory.applicationTables.slice(0, -1) })
    const rehashed = inventoryVariant({ schemaSha256: '0'.repeat(64) })
    const historical = inventoryVariant({
      applicationTables: beforeFr277.filter(({ modelName }) => !modelName.startsWith('Notion')),
      schemaSha256: '9ca8618d758d29387a0eaf79877a370c2ee8f24aadf09a07b4c103e0fe7f974a',
    })
    expect(historical.targetSchemaSha256).toBe('a669f032250b6d72fff5f99398a3fb9166fd5ee383bdd6d5c66c5a6df5831115')
    const notionWithoutRuntimeOwner = inventoryVariant({
      applicationTables: beforeFr277,
      schemaSha256: 'ca3e8247e50eb95980561e3ce8aa882ed7b11010d0b2167582e5f37b448132c8',
    })
    expect(notionWithoutRuntimeOwner.targetSchemaSha256).toBe('c45dd4b70079decbd1d415a392221bf1a4a71970cd807140d832549ff5481d55')
    const runtimeOwnerWithoutNotion = inventoryVariant({
      applicationTables: beforeFr277.filter(({ modelName }) => !modelName.startsWith('Notion')),
      schemaSha256: 'ffa2c121e08891b4de556480130d5a6e116979f151133a58fd0f23a98ba61f2d',
    })
    expect(runtimeOwnerWithoutNotion.targetSchemaSha256).toBe('51b45ae26066775435adef2b983616835d6c09a940ec884f9de0e4cacf8d2899')

    for (const candidate of [smaller, rehashed, historical, notionWithoutRuntimeOwner, runtimeOwnerWithoutNotion]) {
      const cleanAdapter = fakeAdapter()
      const clean = await runCleanTargetRestore({
        snapshotBytes: bytes,
        snapshot,
        expectedSnapshotSha256: computeSnapshotSha256(bytes),
        inventory: candidate,
        adapter: cleanAdapter,
        validateSnapshotRecovery: validRecovery,
      })
      expect(clean).toMatchObject({ status: 'REFUSED', errorCode: 'TARGET_SCHEMA_UNVERIFIED' })
      expect(cleanAdapter.events).not.toContain('begin')

      const exportAdapter = fakeAdapter()
      const contract = historicalExportedModelContract()
      const exported = await runProtectedExport({
        inventory: candidate,
        adapter: exportAdapter,
        extractSnapshot: async () => ({ snapshot, ...contract }),
        validateSnapshotRecovery: validRecovery,
      })
      expect(exported).toMatchObject({ status: 'REFUSED', errorCode: 'TARGET_SCHEMA_UNVERIFIED' })
      expect(exportAdapter.events).not.toContain('begin')

      expect(() => createPrismaTransactionFacade({}, candidate)).toThrow(/approved 212-table inventory/)
      expect(() => createPostgresRecoveryAdapter({ connectionString: 'postgresql://127.0.0.1/example', inventory: candidate })).toThrow(/approved 212-table inventory/)
    }
  })

  it('refuses a retained-byte/object mismatch and an unavailable legacy validator', async () => {
    const snapshot = emptySnapshot()
    const bytes = Buffer.from(JSON.stringify(snapshot), 'utf8')
    const adapter = fakeAdapter()
    const mismatch = await runCleanTargetRestore({
      snapshotBytes: bytes,
      snapshot: { ...snapshot, schemaVersion: 'different' },
      expectedSnapshotSha256: computeSnapshotSha256(bytes),
      inventory,
      adapter,
      validateSnapshotRecovery: validRecovery,
    })
    expect(mismatch).toMatchObject({ status: 'REFUSED', errorCode: 'PHASE_B_SNAPSHOT_INVALID' })
    expect(adapter.events).not.toContain('begin')

    const missingValidator = await runCleanTargetRestore({
      snapshotBytes: bytes,
      snapshot,
      expectedSnapshotSha256: computeSnapshotSha256(bytes),
      inventory,
      adapter,
      insertSnapshot: async () => ({ insertedCounts: {} }),
    })
    expect(missingValidator).toMatchObject({ status: 'REFUSED', errorCode: 'TARGET_PRIVILEGE_UNAVAILABLE' })
  })

  it('reports a partial insertion callback as rolled back', async () => {
    const snapshot = emptySnapshot()
    const bytes = Buffer.from(JSON.stringify(snapshot), 'utf8')
    const adapter = fakeAdapter()
    const result = await runCleanTargetRestore({
      snapshotBytes: bytes,
      snapshot,
      expectedSnapshotSha256: computeSnapshotSha256(bytes),
      inventory,
      confirmation: 'PHASE_B_EMPTY_TARGET',
      adapter,
      validateSnapshotRecovery: validRecovery,
      insertSnapshot: async () => { throw new Error('insertion failed after a prefix') },
    })
    expect(result).toMatchObject({ status: 'ROLLED_BACK', errorCode: 'PHASE_B_WRITE_ROLLED_BACK' })
    expect(adapter.events).toContain('rollback')
  })

  it('keeps both process-only CLIs runnable for help and bounded refusal', async () => {
    await expect(runCleanTargetRestoreCli({ argv: ['--help'], env: {} })).resolves.toMatchObject({ exitCode: 0 })
    await expect(runProtectedExportCli({ argv: ['--help'], env: {} })).resolves.toMatchObject({ exitCode: 0 })
    await expect(runCleanTargetRestoreCli({ argv: [], env: {} })).resolves.toMatchObject({ exitCode: 1, result: { errorCode: 'PHASE_B_SNAPSHOT_INVALID' } })
    await expect(runProtectedExportCli({ argv: ['--output', 'relative.json'], env: {} })).resolves.toMatchObject({ exitCode: 1, result: { errorCode: 'PHASE_B_SNAPSHOT_INVALID' } })
  })
})
