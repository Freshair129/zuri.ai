import { execSync } from 'child_process'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { createHash, randomBytes } from 'crypto'
import { normalizeNewlines } from '../scripts/canonical-text.mjs'

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

// Databases are per-run, but the generated Prisma client is one directory shared
// by every run. Two runs generating into it at once lose a rename race —
// `EPERM … query_engine-windows.dll.node.tmp…` — which `prisma db push` reports
// on stdout while still exiting 0, so the loser would continue against whichever
// client happened to survive. Generation is therefore gated on the schema's
// fingerprint and serialised by a lock, and a lost race fails rather than
// printing a line of noise.
const SCHEMA_PATH = path.join(ROOT, 'prisma', 'schema.prisma')
const CLIENT_DIR = path.join(ROOT, 'node_modules', '.prisma', 'client')
// Inside the client directory on purpose: deleting the client must invalidate the
// fingerprint, or a run would skip generation and import a client that is gone.
const FINGERPRINT_PATH = path.join(CLIENT_DIR, '.zuri-schema-fingerprint')
const GENERATE_LOCK_PATH = path.join(ROOT, 'node_modules', '.prisma', '.zuri-generate.lock')
const LOCK_WAIT_MS = 120_000
const LOCK_STALE_MS = 120_000
const LOCK_POLL_MS = 250

/**
 * Identity of the schema the client must match. Newlines are normalised first:
 * `core.autocrlf` makes the same blob arrive as LF or CRLF depending on the
 * checkout, and a fingerprint that moves with the checkout would force a
 * regeneration on every machine. Same rule as the doc graph — see
 * .brain/rca/2026-08-16-doc-graph-line-ending-hash-drift.md.
 */
export function schemaFingerprint(schemaPath = SCHEMA_PATH, { read = readFileSync } = {}) {
  return createHash('sha256').update(normalizeNewlines(read(schemaPath, 'utf8'))).digest('hex').slice(0, 16)
}

/** The fingerprint recorded beside the generated client, or null if there is none. */
export function recordedFingerprint(stampPath = FINGERPRINT_PATH, { read = readFileSync } = {}) {
  try {
    return read(stampPath, 'utf8').trim() || null
  } catch {
    return null
  }
}

export function recordFingerprint(value, stampPath = FINGERPRINT_PATH, { write = writeFileSync } = {}) {
  write(stampPath, `${value}\n`)
}

/**
 * Run `work` with exclusive hold of the generation lock.
 *
 * `openSync(..., 'wx')` is the atomic create-if-absent primitive, so exactly one
 * run wins. A loser waits: generation is quick, and the moment the winner
 * finishes the fingerprint it recorded is the one this run needed, so `work`
 * re-checks and usually does nothing. A run killed mid-generation leaves the lock
 * behind, so a lock older than LOCK_STALE_MS is taken over rather than trusted.
 * Waiting past LOCK_WAIT_MS throws — using an unknown client silently is the one
 * outcome this whole mechanism exists to prevent.
 */
export function withGenerateLock(work, options = {}) {
  const {
    lockPath = GENERATE_LOCK_PATH,
    acquire = (p) => closeSync(openSync(p, 'wx')),
    release = (p) => rmSync(p, { force: true }),
    heldForMs = (p) => Date.now() - statSync(p).mtimeMs,
    waitMs = LOCK_WAIT_MS,
    staleMs = LOCK_STALE_MS,
    pollMs = LOCK_POLL_MS,
    sleep = sleepSync,
    now = Date.now,
  } = options

  const deadline = now() + waitMs
  for (;;) {
    try {
      acquire(lockPath)
      break
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err
      let held
      try {
        held = heldForMs(lockPath)
      } catch {
        continue // released between the failed acquire and the stat — retry at once
      }
      if (held > staleMs) {
        // Its owner is gone; nothing is generating, so reclaim it.
        release(lockPath)
        continue
      }
      if (now() >= deadline) {
        throw new Error(
          `Timed out after ${Math.round(waitMs / 1000)}s waiting for another test run to finish regenerating the ` +
            'Prisma client. This run will not continue against a client built from a different schema — ' +
            `rerun once that one finishes, or delete ${path.relative(ROOT, lockPath).split(path.sep).join('/')} if no run is active.`,
        )
      }
      sleep(pollMs)
    }
  }

  try {
    return work()
  } finally {
    release(lockPath)
  }
}

// A synchronous wait that does not spin a core. globalSetup is sync (execSync
// throughout), so a promise-based sleep is not available here.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

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
  const push = (generate) =>
    execSync(`npx prisma db push${generate ? '' : ' --skip-generate'}`, {
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

  // Generation is what keeps the client in step with prisma/schema.prisma —
  // postinstall covers installs only, so a schema arriving by pull would
  // otherwise leave a stale client and "Unknown argument …" errors that name no
  // cause. It is gated, not skipped: regenerate only when the schema moved, and
  // never while another run is doing the same.
  const wanted = schemaFingerprint()
  let generated = false
  if (recordedFingerprint() !== wanted) {
    generated = withGenerateLock(() => {
      // The run we queued behind may have generated exactly what we needed.
      if (recordedFingerprint() === wanted) return false
      push(true)
      recordFingerprint(wanted)
      return true
    })
  }
  // Either the client was already current or someone else refreshed it; this
  // run still needs the schema in its own database.
  if (!generated) push(false)

  assertSchemaApplied(file)
  provide('testDatabaseUrl', url)

  // vitest runs the returned teardown after the run whether it passed or failed,
  // so the run's database does not outlive it.
  return () => removeTestDatabase(file)
}
