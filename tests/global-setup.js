import { execSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { randomBytes } from 'crypto'

const ROOT = path.resolve(__dirname, '..')

// Loaded through createRequire, not a static import: the Vite build inside
// vitest 2.x predates node:sqlite, strips the node: prefix and then fails to
// resolve a bare "sqlite". Resolving it at call time keeps it out of Vite's
// static analysis.
const nodeRequire = createRequire(path.join(ROOT, 'package.json'))

// One database per run, not one shared file. The name carries the pid plus a
// clock and random component so two runs — two terminals, two agents, a focused
// file alongside a full suite — can never land on the same path.
export const TEST_DB_DIR = path.resolve(ROOT, 'prisma', '.test-dbs')

// A run that is SIGKILLed never reaches teardown and leaves its database behind.
// Anything older than this cannot belong to a live run, so the next run sweeps it.
const ABANDONED_AFTER_MS = 6 * 60 * 60 * 1000

// Tables the whole suite builds on: every integration test starts by creating a
// Portfolio → Tenant → Business chain. If `db push` reports success but these are
// missing, fail here with one clear message instead of letting a dozen suites
// each report "The table main.Portfolio does not exist".
const FOUNDATION_TABLES = ['Portfolio', 'Tenant', 'Business']

/**
 * The absolute path and the Prisma URL of this run's database. The URL stays
 * relative to prisma/ because that is the directory Prisma resolves a `file:`
 * datasource against — both for `db push` and for the generated client.
 */
export function testDatabaseTarget(name = runDatabaseName()) {
  return {
    name,
    file: path.join(TEST_DB_DIR, name),
    url: `file:./${path.basename(TEST_DB_DIR)}/${name}`,
  }
}

function runDatabaseName() {
  return `run-${process.pid}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}.db`
}

/**
 * Every on-disk file that belongs to a SQLite database. The rollback journal
 * survives a process that dies mid-transaction, so removing only the .db file
 * leaves part of the old database behind and the "reset" is not one.
 */
export function testDatabaseFiles(dbPath) {
  return [dbPath, `${dbPath}-journal`, `${dbPath}-wal`, `${dbPath}-shm`]
}

/**
 * Delete a test database and its sidecars, returning what was removed. Windows
 * locks an open SQLite file: a database still held by a live run reports EPERM,
 * and since no run ever shares another's file, that means "not mine" — skip it
 * and leave it to its owner. Any other failure is real and propagates.
 */
export function removeTestDatabase(dbPath, { exists = existsSync, remove = rmSync } = {}) {
  const removed = []
  for (const file of testDatabaseFiles(dbPath)) {
    if (!exists(file)) continue
    try {
      remove(file)
      removed.push(file)
    } catch (err) {
      if (err?.code === 'EPERM' || err?.code === 'EBUSY') continue
      throw err
    }
  }
  return removed
}

/**
 * Remove databases left behind by runs that never reached teardown, so the
 * directory cannot grow without bound. Age is the only safe signal — a live run
 * of any length is far younger than the cutoff, and one that is not still gets
 * skipped by the lock check in removeTestDatabase.
 */
export function sweepAbandonedDatabases(dir = TEST_DB_DIR, options = {}) {
  const {
    now = Date.now(),
    maxAgeMs = ABANDONED_AFTER_MS,
    list = readdirSync,
    modifiedAt = (file) => statSync(file).mtimeMs,
    ...removal
  } = options

  let entries
  try {
    entries = list(dir)
  } catch {
    return []
  }

  const swept = []
  for (const entry of entries) {
    if (!entry.endsWith('.db')) continue
    const file = path.join(dir, entry)
    let age
    try {
      age = now - modifiedAt(file)
    } catch {
      continue
    }
    if (age < maxAgeMs) continue
    swept.push(...removeTestDatabase(file, removal))
  }
  return swept
}

/** Prove the schema actually landed before any test file runs a query. */
export function assertSchemaApplied(dbPath, tables = FOUNDATION_TABLES) {
  const { DatabaseSync } = nodeRequire('node:sqlite')
  const db = new DatabaseSync(dbPath, { readOnly: true })
  let present
  try {
    present = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name),
    )
  } finally {
    db.close()
  }
  const missing = tables.filter((t) => !present.has(t))
  if (missing.length) {
    throw new Error(
      `prisma db push reported success but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing from ` +
        `${dbPath}. The schema did not apply — rerun, and if it persists check the Prisma schema engine.`,
    )
  }
}

// Create a fresh isolated SQLite database for this run, and hand its URL to the
// worker processes through vitest's provide/inject channel — see tests/setup.js.
export default function globalSetup({ provide }) {
  mkdirSync(TEST_DB_DIR, { recursive: true })
  sweepAbandonedDatabases()

  const { file, url } = testDatabaseTarget()

  const inheritedRustLog = String(process.env.RUST_LOG || '').toLowerCase()
  const prismaRustLog = /(?:trace|debug|info)/.test(inheritedRustLog)
    ? process.env.RUST_LOG
    : 'info'
  // No --skip-generate: `db push` regenerates the client, which is the only thing
  // that keeps it in step with prisma/schema.prisma. postinstall covers installs
  // only, so skipping here meant a schema-changing pull left a stale client and
  // the suite failed with "Unknown argument …" errors that name no cause.
  execSync('npx prisma db push', {
    cwd: ROOT,
    // Prisma 5.22's Windows schema engine can terminate during silent startup
    // under the repository's Node 24 toolchain. Keep a deterministic log mode
    // for the child process while allowing CI/debug callers to override it.
    env: {
      ...process.env,
      DATABASE_URL: url,
      RUST_LOG: prismaRustLog,
    },
    stdio: 'inherit',
  })

  assertSchemaApplied(file)
  provide('testDatabaseUrl', url)

  // vitest runs the returned teardown after the run whether it passed or failed,
  // so the run's database does not outlive it.
  return () => removeTestDatabase(file)
}
