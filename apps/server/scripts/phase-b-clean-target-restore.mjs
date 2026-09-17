// @req FR-252 — clean-target, process-only Phase B recovery.
// @spec docs/architecture/project-manager-system/26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md
// @tested tests/integration/phase-b-recovery.test.js

import { writeFile } from 'node:fs/promises'
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
  readSnapshotFile,
  runCleanTargetRestore,
} from './phase-b-recovery.mjs'

const USAGE = [
  'Usage: node apps/server/scripts/phase-b-clean-target-restore.mjs',
  '  --snapshot <absolute-path>',
  '  --snapshot-sha256 <lowercase-hex-64>',
  '  [--confirm-empty-target PHASE_B_EMPTY_TARGET]',
  '  [--report <absolute-path>]',
  '',
  'The database is read only from ZURI_PHASE_B_RECOVERY_DATABASE_URL.',
].join('\n')
const HERE = path.dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const values = {}
  const allowed = new Set(['--snapshot', '--snapshot-sha256', '--confirm-empty-target', '--report'])
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--help' || flag === '-h') return { help: true, values }
    if (!allowed.has(flag)) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `Unknown option ${flag}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `${flag} requires a value`)
    values[flag.slice(2)] = value
    index += 1
  }
  if (!values.snapshot || !values['snapshot-sha256']) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, '--snapshot and --snapshot-sha256 are required')
  if (values['confirm-empty-target'] && values['confirm-empty-target'] !== 'PHASE_B_EMPTY_TARGET') throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, 'Empty-target confirmation is invalid')
  for (const name of ['snapshot', 'report']) if (values[name] && !path.isAbsolute(values[name])) throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, `--${name} must be an absolute path`)
  return { help: false, values }
}

async function writeReport(reportPath, result) {
  if (!reportPath) return
  await writeFile(path.normalize(reportPath), `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8' })
}

async function loadRecoveryBoundary() {
  // Root composes this narrow hook from backup-service's existing model order,
  // restoredRow transformation and no-audit empty-target insert path. Keeping
  // it optional lets help/preflight/refusal remain runnable before composition.
  const hookPath = path.resolve(HERE, 'phase-b-recovery-hooks.mjs')
  try {
    const module = await import(pathToFileURL(hookPath).href)
    return {
      insertSnapshot: module.insertSnapshotIntoEmptyTarget || module.default?.insertSnapshotIntoEmptyTarget || null,
      validateSnapshotRecovery: module.validateSnapshotRecovery || module.default?.validateSnapshotRecovery || null,
    }
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' || error?.code === 'MODULE_NOT_FOUND') return { insertSnapshot: null, validateSnapshotRecovery: null }
    throw new PhaseBRecoveryError(PHASE_B_ERROR_CODES.TARGET_PRIVILEGE_UNAVAILABLE, 'Recovery insertion boundary could not be loaded')
  }
}

export async function runCleanTargetRestoreCli({ argv = process.argv.slice(2), env = process.env } = {}) {
  let parsed
  try { parsed = parseArgs(argv) } catch (error) {
    const result = { status: 'REFUSED', errorCode: error.code || PHASE_B_ERROR_CODES.SNAPSHOT_INVALID }
    return { exitCode: 1, result, stdout: `${result.errorCode}\n` }
  }
  if (parsed.help) return { exitCode: 0, result: null, stdout: `${USAGE}\n` }
  const args = parsed.values
  const resolvedSnapshotPath = path.resolve(args.snapshot)
  const resolvedReportPath = args.report ? path.resolve(args.report) : null
  const sameInputAndReport = resolvedReportPath && (process.platform === 'win32'
    ? resolvedReportPath.toLowerCase() === resolvedSnapshotPath.toLowerCase()
    : resolvedReportPath === resolvedSnapshotPath)
  if (sameInputAndReport) {
    const result = { status: 'REFUSED', errorCode: PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, snapshotSha256: null }
    return { exitCode: 1, result, stdout: `${JSON.stringify(result)}\n` }
  }
  let bytes
  let snapshot
  try {
    ({ bytes, snapshot } = await readSnapshotFile(args.snapshot))
  } catch (error) {
    const result = { status: 'REFUSED', errorCode: error.code || PHASE_B_ERROR_CODES.SNAPSHOT_INVALID, snapshotSha256: null }
    await writeReport(args.report, result)
    return { exitCode: 1, result, stdout: `${JSON.stringify(result)}\n` }
  }
  const snapshotSha256 = computeSnapshotSha256(bytes)
  let inventory
  try { inventory = await loadFrozenSchemaInventory() } catch (error) { inventory = null }
  if (!inventory) {
    const result = { status: 'REFUSED', errorCode: PHASE_B_ERROR_CODES.TARGET_SCHEMA_UNVERIFIED, snapshotSha256, targetSchemaSha256: null }
    await writeReport(args.report, result)
    return { exitCode: 1, result, stdout: `${JSON.stringify(result)}\n` }
  }
  const connectionString = env.ZURI_PHASE_B_RECOVERY_DATABASE_URL
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    const result = { status: 'REFUSED', errorCode: PHASE_B_ERROR_CODES.TARGET_CONNECTION_UNAVAILABLE, snapshotSha256, targetSchemaSha256: null }
    await writeReport(args.report, result)
    return { exitCode: 1, result, stdout: `${JSON.stringify(result)}\n` }
  }
  let adapter
  try {
    adapter = createPostgresRecoveryAdapter({ connectionString, inventory })
    const recoveryBoundary = await loadRecoveryBoundary()
    const result = await runCleanTargetRestore({
      snapshotBytes: bytes,
      snapshot,
      expectedSnapshotSha256: args['snapshot-sha256'],
      inventory,
      confirmation: args['confirm-empty-target'],
      adapter,
      insertSnapshot: recoveryBoundary.insertSnapshot,
      validateSnapshotRecovery: recoveryBoundary.validateSnapshotRecovery,
    })
    await writeReport(args.report, result)
    return { exitCode: result.status === 'READY' || result.status === 'RESTORED' ? 0 : 1, result, stdout: `${JSON.stringify(result)}\n` }
  } catch (error) {
    const result = { status: 'REFUSED', errorCode: error.code || PHASE_B_ERROR_CODES.TARGET_CONNECTION_UNAVAILABLE, snapshotSha256 }
    await writeReport(args.report, result)
    return { exitCode: 1, result, stdout: `${JSON.stringify(result)}\n` }
  } finally {
    try { await adapter?.close() } catch { /* bounded redacted CLI result */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const outcome = await runCleanTargetRestoreCli()
  process.stdout.write(outcome.stdout)
  process.exitCode = outcome.exitCode
}
