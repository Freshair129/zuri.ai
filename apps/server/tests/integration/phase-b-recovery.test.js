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
  PHASE_B_RECOVERY_MANIFEST_VERSION,
  computeSnapshotSha256,
  computeTargetSchemaSha256,
} from '@/modules/project-manager/application/phase-b-backup'
import { SNAPSHOT_EXCLUDED_MODELS, SNAPSHOT_MODELS } from '@/modules/project-manager/application/backup-service'
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

function emptySnapshot() {
  return {
    schemaVersion: '1.0',
    phaseBRecovery: { version: PHASE_B_RECOVERY_MANIFEST_VERSION, requiredTables: [...PHASE_B_FAMILY_DELEGATES] },
    tables: Object.fromEntries(PHASE_B_FAMILY_DELEGATES.map((delegate) => [delegate, []])),
  }
}

function completeSnapshot() {
  const snapshot = emptySnapshot()
  for (const model of SNAPSHOT_MODELS) snapshot.tables[model] = []
  return snapshot
}

function exportedModelContract() {
  return {
    includedModels: [...SNAPSHOT_MODELS],
    excludedModels: Object.keys(SNAPSHOT_EXCLUDED_MODELS),
  }
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
  // @req FR-022 — CustomerRetentionConsent and LegalHoldArchiveKey (ADR-093
  // 1.2.0) rebind the frozen inventory from 192 to 194 application tables, on
  // top of the FR-277 LineGroundingShadowComparison rebind; see the decision
  // doc's binding ladder for the historical entries this one continues.
  // @req FR-022 — the MSP memory erasure scan index on AgentTraceEvent rebinds
  // the schema hash; the 194-table mapping is unchanged.
  it('loads the committed pinned 197-table inventory', () => {
    expect(inventory.applicationTables).toHaveLength(197)
    expect(inventory.schemaSha256).toBe('45d7a7001daa7ede78fe911d1752bf237a7c42218a51372ec4bb89bdd704de06')
    expect(inventory.targetSchemaSha256).toBe('e9f5216b1e9368157dcfd5b926eb3798fac335f45d815615424324fe2909f65e')
    expect(inventory.applicationTables.map(({ modelName }) => modelName)).toEqual(
      expect.arrayContaining(['CustomerRetentionConsent', 'LegalHoldArchiveKey'])
    )
    expect(inventory.applicationTables.map(({ modelName }) => modelName)).toEqual(
      expect.arrayContaining(['SupplierCostLine', 'SupplierCostSheet', 'BusinessKeyResult', 'BusinessKeyResultCheckIn'])
    )
    expect(inventory.applicationTables.map(({ modelName }) => modelName)).toEqual(expect.arrayContaining([
      'ProjectApprovalRequest', 'NotionOAuthState', 'NotionWebhookReceipt', 'NotionWebhookVerificationToken',
    ]))
  })

  it('preserves the exact previous 194 mappings and covers every current Prisma model', async () => {
    const previous = inventory.applicationTables.filter(({ modelName }) => !MARKETING_CUSTODY.includes(modelName))
    expect(previous).toHaveLength(194)
    expect(createHash('sha256').update(JSON.stringify(previous)).digest('hex')).toBe('f170d8b0246546bdf903e7bc4142a85486dc2e20e76e1a532a5fb93a12a98c93')
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

  it('includes all 197 tables in the actual PostgreSQL adapter catalog, privileges, locks and census', async () => {
    const queries = []
    const client = { release() {}, async query(sql, values) {
      queries.push({ sql, values })
      if (sql.includes('pg_catalog.pg_class')) return { rows: inventory.applicationTables }
      if (sql.includes('has_table_privilege')) return { rows: [{ canSelect: true, canInsert: true }] }
      if (sql.startsWith('SELECT COUNT')) return { rows: [{ count: '0' }] }
      return { rows: [] }
    } }
    const connect = vi.spyOn(pg.Pool.prototype, 'connect').mockResolvedValue(client)
    const adapter = createPostgresRecoveryAdapter({ connectionString: 'postgresql://127.0.0.1/unused_phase_b_adapter_qa', inventory })
    try {
      const tx = await adapter.begin()
      expect(await tx.reconcileCatalog()).toEqual({ expectedCount: 197, catalogCount: 197 })
      await tx.assertPrivileges({ write: true })
      await tx.lockApplicationTables()
      expect(Object.keys(await tx.countAllApplicationTables()).sort()).toEqual(inventory.applicationTables.map(entry => entry.modelName))
      const names = inventory.applicationTables.map(entry => `"public"."${entry.tableName}"`)
      expect(queries.filter(query => query.sql.includes('has_table_privilege')).map(query => query.values[0])).toEqual(names)
      expect(queries.filter(query => query.sql.startsWith('LOCK TABLE')).map(query => query.sql)).toEqual(names.map(name => `LOCK TABLE ${name} IN SHARE ROW EXCLUSIVE MODE`))
      expect(queries.filter(query => query.sql.startsWith('SELECT COUNT'))).toHaveLength(197)
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

  it('refuses the last valid 194-model binding at every runner and loader boundary', async () => {
    const previous = inventoryVariant({ applicationTables: inventory.applicationTables.filter(({ modelName }) => !MARKETING_CUSTODY.includes(modelName)), schemaSha256: '32eb25fc477a50457014e2e8b106fd58a4d5eed0666b46a3e98e7bcba66330d4' })
    expect(previous.targetSchemaSha256).toBe('9dfbf9b736a46b2191cc8c72b843b090563af0198359b7015b5654dd08506aa0')
    const dir = await mkdtemp(path.join(os.tmpdir(), 'phase-b-marketing-old-'))
    try {
      const file = path.join(dir, 'inventory.json')
      await writeFile(file, JSON.stringify(previous))
      await expect(loadFrozenSchemaInventory({ modulePath: file })).rejects.toMatchObject({ code: 'TARGET_SCHEMA_UNVERIFIED' })
      const adapter = fakeAdapter()
      const bytes = Buffer.from(JSON.stringify(emptySnapshot()))
      expect(await runCleanTargetRestore({ inventory: previous, adapter, snapshotBytes: bytes, expectedSnapshotSha256: computeSnapshotSha256(bytes), validateSnapshotRecovery: validRecovery })).toMatchObject({ status: 'REFUSED', errorCode: 'TARGET_SCHEMA_UNVERIFIED' })
      expect(await runProtectedExport({ inventory: previous, adapter, extractSnapshot: async () => ({ snapshot: completeSnapshot(), ...exportedModelContract() }), validateSnapshotRecovery: validRecovery })).toMatchObject({ status: 'REFUSED', errorCode: 'TARGET_SCHEMA_UNVERIFIED', snapshot: null })
      expect(adapter.events).not.toContain('begin')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

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
      await writeFile(tempInventory, JSON.stringify({
        ...inventory,
        applicationTables: inventory.applicationTables.filter(({ modelName }) => !['CustomerRetentionConsent', 'LegalHoldArchiveKey'].includes(modelName)),
        schemaSha256: '94b6e5a55ff719afb82d9c8896ca47db6192cf48709d6976fd4cb38870d5231d',
        targetSchemaSha256: '372a2af5602a7af64aef2ea77904f039c7666f4e44007c27b0caf4a74fa50885',
      }))
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
    const snapshot = completeSnapshot()
    const bytes = Buffer.from(JSON.stringify(snapshot), 'utf8')
    // @req FR-277 — `LineGroundingShadowComparison` is the one application
    // model this change adds, so every historical reconstruction below (each
    // built by filtering the CURRENT, live `inventory.applicationTables`)
    // must exclude it first — otherwise "current minus Notion" etc. counts
    // one model too many for a binding that predates FR-277 entirely, which
    // is exactly what broke this test the first time a model was added after
    // it was written. `beforeFr277` is the 191-entry Notion+runtimeOwner
    // mapping this PR's own binding was rebound from.
    // @req FR-022 — likewise excludes the two ADR-093 1.2.0 models added after FR-277.
    const AFTER_FR277 = ['LineGroundingShadowComparison', 'CustomerRetentionConsent', 'LegalHoldArchiveKey', 'MarketingReportPolicy', 'MarketingReportBinding', 'MarketingExternalReport']
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
      const contract = exportedModelContract()
      const exported = await runProtectedExport({
        inventory: candidate,
        adapter: exportAdapter,
        extractSnapshot: async () => ({ snapshot, ...contract }),
        validateSnapshotRecovery: validRecovery,
      })
      expect(exported).toMatchObject({ status: 'REFUSED', errorCode: 'TARGET_SCHEMA_UNVERIFIED' })
      expect(exportAdapter.events).not.toContain('begin')

      expect(() => createPrismaTransactionFacade({}, candidate)).toThrow(/approved 197-table inventory/)
      expect(() => createPostgresRecoveryAdapter({ connectionString: 'postgresql://127.0.0.1/example', inventory: candidate })).toThrow(/approved 197-table inventory/)
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
