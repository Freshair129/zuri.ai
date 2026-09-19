// @req FR-252 — clean-target recovery and complete protected export are
// process-only, single-transaction operations with no destructive replacement.
// @spec docs/architecture/project-manager-system/26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md
// @tested tests/integration/phase-b-recovery.test.js

import { describe, expect, it } from 'vitest'
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
  it('loads the committed pinned 180-table inventory', () => {
    expect(inventory.applicationTables).toHaveLength(180)
    expect(inventory.schemaSha256).toBe('23f8c04baf70ebc90fe71e3be0002c0b3f33a46de735e4f56eb3ec814ed91a58')
    expect(inventory.targetSchemaSha256).toBe('8e86b994d15cc165d4d26ea28760f9c1c5f4aa93fa038febf9e636666092b362')
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
    const smaller = inventoryVariant({ applicationTables: inventory.applicationTables.slice(0, -1) })
    const rehashed = inventoryVariant({ schemaSha256: '0'.repeat(64) })

    for (const candidate of [smaller, rehashed]) {
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

      expect(() => createPrismaTransactionFacade({}, candidate)).toThrow(/approved 179-table inventory/)
      expect(() => createPostgresRecoveryAdapter({ connectionString: 'postgresql://127.0.0.1/example', inventory: candidate })).toThrow(/approved 179-table inventory/)
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
