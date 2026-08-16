import { execSync } from 'child_process'
import { existsSync, rmSync } from 'fs'
import path from 'path'
import { createRequire } from 'module'

const ROOT = path.resolve(__dirname, '..')

// Loaded through createRequire, not a static import: the Vite build inside
// vitest 2.x predates node:sqlite, strips the node: prefix and then fails to
// resolve a bare "sqlite". Resolving it at call time keeps it out of Vite's
// static analysis.
const nodeRequire = createRequire(path.join(ROOT, 'package.json'))
const TEST_DB = path.resolve(ROOT, 'prisma', 'test.db')

// Tables the whole suite builds on: every integration test starts by creating a
// Portfolio → Tenant → Business chain. If `db push` reports success but these are
// missing, fail here with one clear message instead of letting a dozen suites
// each report "The table main.Portfolio does not exist".
const FOUNDATION_TABLES = ['Portfolio', 'Tenant', 'Business']

/**
 * Every on-disk file that belongs to a SQLite database. The rollback journal
 * survives a process that dies mid-transaction, so removing only the .db file
 * leaves part of the old database behind and the "reset" is not one.
 */
export function testDatabaseFiles(dbPath) {
  return [dbPath, `${dbPath}-journal`, `${dbPath}-wal`, `${dbPath}-shm`]
}

/**
 * Delete the test database and its sidecars. Windows locks an open SQLite file,
 * so a second concurrent vitest run lands here with EPERM — report that as the
 * shared-database collision it is rather than a bare fs stack trace.
 */
export function removeTestDatabase(dbPath, { exists = existsSync, remove = rmSync } = {}) {
  for (const file of testDatabaseFiles(dbPath)) {
    if (!exists(file)) continue
    try {
      remove(file)
    } catch (err) {
      if (err?.code === 'EPERM' || err?.code === 'EBUSY') {
        throw new Error(
          `Cannot reset ${path.relative(ROOT, file).split(path.sep).join('/')} — another test run is holding it open. ` +
            'Wait for that run to finish: prisma/test.db is a single shared file and two suites cannot use it at once.',
        )
      }
      throw err
    }
  }
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
        'prisma/test.db. The schema did not apply — rerun, and if it persists check the Prisma schema engine.',
    )
  }
}

// Create a fresh isolated SQLite test database before the test run.
export default function globalSetup() {
  removeTestDatabase(TEST_DB)

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
      DATABASE_URL: 'file:./test.db',
      RUST_LOG: prismaRustLog,
    },
    stdio: 'inherit',
  })

  assertSchemaApplied(TEST_DB)
}
