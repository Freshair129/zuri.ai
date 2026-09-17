// @req FR-252 — bridge the offline commands to the existing backup extraction
// and restore ordering without duplicating SNAPSHOT_MODELS or redaction rules.
// @spec docs/architecture/project-manager-system/26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md
// @tested tests/integration/phase-b-recovery.test.js

import { build } from 'esbuild'
import { mkdtemp, readFile, rmdir, unlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PHASE_B_FAMILY_DELEGATES, PhaseBRecoveryError, PHASE_B_ERROR_CODES } from '../src/modules/project-manager/application/phase-b-backup.js'
import { createPrismaTransactionFacade } from './phase-b-recovery.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = path.resolve(HERE, '..')
const nativeRequire = createRequire(path.join(SERVER_ROOT, 'package.json'))
const NodeModule = nativeRequire('node:module')
let servicePromise

async function composedBackupService() {
  if (!servicePromise) servicePromise = (async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'zuri-phase-b-backup-'))
    const outfile = path.join(directory, 'backup-service.cjs')
    try {
      await build({
        stdin: {
          contents: "export * from './src/modules/project-manager/application/backup-service.js'",
          resolveDir: SERVER_ROOT,
          loader: 'js',
        },
        absWorkingDir: SERVER_ROOT,
        alias: { '@': path.join(SERVER_ROOT, 'src') },
        bundle: true,
        format: 'cjs',
        packages: 'external',
        platform: 'node',
        target: 'node20',
        outfile,
        plugins: [{
          name: 'phase-b-no-ambient-db',
          setup(buildContext) {
            buildContext.onResolve({ filter: /^@\/lib\/db$/ }, () => ({ path: 'phase-b-injected-db', namespace: 'phase-b-injected-db' }))
            buildContext.onLoad({ filter: /.*/, namespace: 'phase-b-injected-db' }, () => ({ contents: 'export const prisma = {}; export default prisma', loader: 'js' }))
          },
        }],
        logLevel: 'silent',
      })
      const compiled = new NodeModule(outfile)
      compiled.filename = outfile
      compiled.paths = NodeModule._nodeModulePaths(SERVER_ROOT)
      compiled._compile(await readFile(outfile, 'utf8'), outfile)
      return compiled.exports
    } catch (error) {
      throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_PRIVILEGE_UNAVAILABLE, 'Composed backup service could not be loaded')
    } finally {
      // The imported module is already evaluated; remove only this temporary
      // bundle and retain no source or credential material.
      await unlink(outfile).catch(() => {})
      await rmdir(directory).catch(() => {})
    }
  })()
  return servicePromise
}

export async function extractSnapshot({ tx, adapter }) {
  if (!tx || !adapter?.inventory) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_CONNECTION_UNAVAILABLE, 'Recovery transaction is unavailable')
  const service = await composedBackupService()
  if (typeof service.extractSnapshot !== 'function') throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_PRIVILEGE_UNAVAILABLE, 'Backup extraction boundary is unavailable')
  if (!Array.isArray(service.SNAPSHOT_MODELS) || service.SNAPSHOT_MODELS.length === 0) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.EXPORT_COMPLETENESS_UNAVAILABLE, 'Backup extraction model contract is unavailable')
  if (!service.SNAPSHOT_EXCLUDED_MODELS || typeof service.SNAPSHOT_EXCLUDED_MODELS !== 'object') throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.EXPORT_COMPLETENESS_UNAVAILABLE, 'Backup exclusion model contract is unavailable')
  const snapshot = await service.extractSnapshot({ db: createPrismaTransactionFacade(tx, adapter.inventory), includeBinaryContent: false })
  return { snapshot, includedModels: [...service.SNAPSHOT_MODELS], excludedModels: Object.keys(service.SNAPSHOT_EXCLUDED_MODELS) }
}

export async function validateSnapshotRecovery(snapshot) {
  const service = await composedBackupService()
  if (typeof service.validateSnapshotRecovery !== 'function') throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_PRIVILEGE_UNAVAILABLE, 'Backup recovery validation boundary is unavailable')
  if (!Array.isArray(service.SNAPSHOT_MODELS) || service.SNAPSHOT_MODELS.length === 0) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.EXPORT_COMPLETENESS_UNAVAILABLE, 'Backup recovery model contract is unavailable')
  const validation = service.validateSnapshotRecovery(snapshot)
  const missingModels = service.SNAPSHOT_MODELS.filter((model) => !Array.isArray(snapshot?.tables?.[model]))
  if (missingModels.length) return {
    ...validation,
    valid: false,
    errorCode: PHASE_B_ERROR_CODES.SNAPSHOT_INCOMPLETE,
    errors: [...(validation?.errors || []), `Snapshot is missing included application tables: ${missingModels.join(', ')}`],
  }
  return validation
}

export async function insertSnapshotIntoEmptyTarget({ tx, adapter, snapshot, phaseBFamilyDelegates = PHASE_B_FAMILY_DELEGATES }) {
  if (!tx || !adapter || !snapshot) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_CONNECTION_UNAVAILABLE, 'Recovery insertion boundary is unavailable')
  const service = await composedBackupService()
  // Root may provide a lower-level adapter when its composed backup service
  // owns additional insertion checks. Prefer that explicit boundary.
  if (typeof service.insertSnapshotIntoEmptyTarget === 'function') return service.insertSnapshotIntoEmptyTarget({ tx, adapter, snapshot, phaseBFamilyDelegates })

  // Compatibility path uses the already-exported source list, validator and
  // restoredRow helper. It never calls importSnapshot and never deletes rows.
  if (!Array.isArray(service.SNAPSHOT_MODELS) || typeof service.restoredRow !== 'function') throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_PRIVILEGE_UNAVAILABLE, 'Backup insertion boundary is unavailable')
  let recovery = {}
  if (typeof service.validateSnapshotRecovery === 'function') {
    recovery = service.validateSnapshotRecovery(snapshot)
    if (!recovery.valid) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, 'Existing snapshot recovery validation failed')
  }
  const insertedCounts = {}
  const protectedNames = new Set(phaseBFamilyDelegates)
  for (const model of service.SNAPSHOT_MODELS) {
    const rows = model === 'archiveManifest'
      ? (recovery.archiveRecovery?.manifestRows || [])
      : (Array.isArray(snapshot.tables?.[model]) ? snapshot.tables[model] : [])
    if (rows.length === 0) continue
    const transformed = protectedNames.has(model)
      ? rows
      : rows.map((row) => service.restoredRow(model, row, { lineWorkerMemoryRecovery: recovery.lineWorkerMemoryRecovery }))
    await tx.insertRows(model, transformed)
    insertedCounts[model] = transformed.length
  }
  return { insertedCounts }
}
