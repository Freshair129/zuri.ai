// @req FR-252 — complete read-only protected Phase B export.
// @spec docs/architecture/project-manager-system/26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md
// @tested tests/integration/phase-b-recovery.test.js

import { link, open, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  PHASE_B_ERROR_CODES,
  computeSnapshotSha256,
  PhaseBRecoveryError,
} from '../src/modules/project-manager/application/phase-b-backup.js'
import {
  createPostgresRecoveryAdapter,
  loadFrozenSchemaInventory,
  runProtectedExport,
} from './phase-b-recovery.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_HOOK = path.resolve(HERE, 'phase-b-recovery-hooks.mjs')
const USAGE = [
  'Usage: node apps/server/scripts/phase-b-protected-export.mjs',
  '  --output <absolute-path>',
  '  [--report <absolute-path>]',
  '',
  'The database is read only from ZURI_PHASE_B_RECOVERY_DATABASE_URL.',
].join('\n')

function parseArgs(argv) {
  const values = {}
  const allowed = new Set(['--output', '--report'])
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--help' || flag === '-h') return { help: true, values }
    if (!allowed.has(flag)) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `Unknown option ${flag}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `${flag} requires a value`)
    values[flag.slice(2)] = value
    index += 1
  }
  if (!values.output) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, '--output is required')
  for (const name of ['output', 'report']) if (values[name] && !path.isAbsolute(values[name])) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `--${name} must be an absolute path`)
  if (values.report && pathsConflict(values.report, values.output)) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, '--report must not be the output path')
  return { help: false, values }
}

function pathsConflict(left, right) {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

async function loadExtractionBoundary() {
  try {
    const module = await import(pathToFileURL(DEFAULT_HOOK).href)
    return {
      extractSnapshot: module.extractSnapshot || module.default?.extractSnapshot || null,
      validateSnapshotRecovery: module.validateSnapshotRecovery || module.default?.validateSnapshotRecovery || null,
    }
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' || error?.code === 'MODULE_NOT_FOUND') return { extractSnapshot: null, validateSnapshotRecovery: null }
    throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_PRIVILEGE_UNAVAILABLE, 'Protected export boundary could not be loaded')
  }
}

async function writeReport(reportPath, result) {
  if (!reportPath) return
  await writeFile(path.normalize(reportPath), `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8' })
}

async function writeAtomicNoOverwrite(outputPath, bytes) {
  const target = path.normalize(outputPath)
  const temporary = `${target}.tmp-${randomUUID()}`
  let handle
  try {
    // Write and fsync a sibling first. Linking the complete file into place is
    // an atomic no-overwrite operation on the same filesystem: EEXIST leaves
    // any prior artifact untouched and no reader can observe a partial file.
    handle = await open(temporary, 'wx')
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    handle = null
    try {
      await link(temporary, target)
    } catch (error) {
      if (error?.code === 'EEXIST') throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, 'Output path already exists')
      throw error
    }
  } catch (error) {
    if (error instanceof PhaseBRecoveryError) throw error
    throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, 'Protected export artifact could not be written')
  } finally {
    try { await handle?.close() } catch { /* preserve bounded result */ }
    try { await unlink(temporary) } catch { /* bounded cleanup; final path is never removed */ }
  }
}

export async function runProtectedExportCli({ argv = process.argv.slice(2), env = process.env } = {}) {
  let parsed
  try { parsed = parseArgs(argv) } catch (error) {
    const result = { status: 'REFUSED', errorCode: error.code || PHASE_B_ERROR_CODES.SNAPSHOT_INVALID }
    return { exitCode: 1, result, stdout: `${result.errorCode}\n` }
  }
  if (parsed.help) return { exitCode: 0, result: null, stdout: `${USAGE}\n` }
  const args = parsed.values
  let inventory
  try { inventory = await loadFrozenSchemaInventory() } catch { inventory = null }
  if (!inventory) {
    const result = { status: 'REFUSED', errorCode: PHASE_B_ERROR_CODES.TARGET_SCHEMA_UNVERIFIED, snapshotSha256: null, targetSchemaSha256: null }
    await writeReport(args.report, result)
    return { exitCode: 1, result, stdout: `${JSON.stringify(result)}\n` }
  }
  const connectionString = env.ZURI_PHASE_B_RECOVERY_DATABASE_URL
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    const result = { status: 'REFUSED', errorCode: PHASE_B_ERROR_CODES.TARGET_CONNECTION_UNAVAILABLE, snapshotSha256: null, targetSchemaSha256: null }
    await writeReport(args.report, result)
    return { exitCode: 1, result, stdout: `${JSON.stringify(result)}\n` }
  }
  let adapter
  try {
    adapter = createPostgresRecoveryAdapter({ connectionString, inventory })
    const extractionBoundary = await loadExtractionBoundary()
    const outcome = await runProtectedExport({
      inventory,
      adapter,
      extractSnapshot: extractionBoundary.extractSnapshot,
      validateSnapshotRecovery: extractionBoundary.validateSnapshotRecovery,
    })
    if (outcome.status === 'EXPORTED' && outcome.snapshot) {
      const bytes = Buffer.from(JSON.stringify(outcome.snapshot), 'utf8')
      await writeAtomicNoOverwrite(args.output, bytes)
      outcome.snapshotSha256 = computeSnapshotSha256(bytes)
      outcome.outputPath = path.normalize(args.output)
    }
    const result = { ...outcome }
    delete result.snapshot
    await writeReport(args.report, result)
    return { exitCode: result.status === 'EXPORTED' ? 0 : 1, result, stdout: `${JSON.stringify(result)}\n` }
  } catch (error) {
    const result = { status: 'REFUSED', errorCode: error.code || PHASE_B_ERROR_CODES.EXPORT_COMPLETENESS_UNAVAILABLE, snapshotSha256: null }
    await writeReport(args.report, result)
    return { exitCode: 1, result, stdout: `${JSON.stringify(result)}\n` }
  } finally {
    try { await adapter?.close() } catch { /* bounded redacted CLI result */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const outcome = await runProtectedExportCli()
  process.stdout.write(outcome.stdout)
  process.exitCode = outcome.exitCode
}
