import { DatabaseSync } from 'node:sqlite'
import { DDL, SCHEMA_VERSION } from './schema.js'

// The SCM transactional store on SQLite (dev/test engine; PostgreSQL adapter is
// an outstanding gate). One connection per process; every operation — reads
// included — runs through one FIFO queue, so an awaited step inside a
// transaction can never interleave another request's statements on the same
// connection (no dirty read of an in-flight transaction). Cross-PROCESS
// exclusion is SQLite's own: a write transaction starts with BEGIN IMMEDIATE
// (the RESERVED lock), WAL keeps readers going, busy_timeout waits instead of
// failing. The in-process queue is NOT offered as the concurrency proof —
// test/recovery/two-process-receipt.test.js runs two real processes.

export class ScmStoreError extends Error {
  constructor(message, { status = 500, code = 'SCM_STORE_ERROR', retryable = false } = {}) {
    super(message)
    Object.assign(this, { status, code, retryable })
  }
}

function busy(error) {
  return /SQLITE_BUSY|database is locked/i.test(String(error?.message ?? error))
}

export function openSqliteStore({ location, busyTimeoutMs = 5000, ensureSchema = false }) {
  if (!location) throw new ScmStoreError('SCM_SQLITE_PATH is required', { code: 'SCM_CONFIG_INVALID' })
  const db = new DatabaseSync(location)
  db.exec(`PRAGMA busy_timeout = ${Number(busyTimeoutMs) | 0}; PRAGMA foreign_keys = ON;`)
  if (location !== ':memory:') db.exec('PRAGMA journal_mode = WAL;')
  if (ensureSchema) {
    db.exec(DDL)
    db.prepare('INSERT OR IGNORE INTO ScmSchemaVersion (version, appliedAt) VALUES (?, ?)').run(SCHEMA_VERSION, new Date().toISOString())
  }
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ScmSchemaVersion'").get()
  const version = row ? db.prepare('SELECT MAX(version) AS v FROM ScmSchemaVersion').get().v : null
  if (version !== SCHEMA_VERSION) {
    db.close()
    throw new ScmStoreError(`SCM schema version ${version ?? 'absent'} != expected ${SCHEMA_VERSION}; schema is applied by the migration owner, not at startup`, { code: 'SCM_SCHEMA_MISMATCH' })
  }

  let tail = Promise.resolve()
  let closed = false
  const enqueue = (job) => {
    const run = tail.then(job, job)
    tail = run.catch(() => {})
    return run
  }
  const sql = {
    get: (text, ...params) => db.prepare(text).get(...params),
    all: (text, ...params) => db.prepare(text).all(...params),
    run: (text, ...params) => db.prepare(text).run(...params),
  }

  return {
    kind: 'sqlite',
    /** Read-only work outside a transaction (still queued: never inside someone's open tx). */
    read(fn) {
      if (closed) return Promise.reject(new ScmStoreError('store closed', { status: 503, code: 'SCM_STORE_CLOSED', retryable: true }))
      return enqueue(async () => fn(sql))
    },
    /** One atomic unit of work. Throwing anywhere rolls the whole unit back. */
    transaction(fn) {
      if (closed) return Promise.reject(new ScmStoreError('store closed', { status: 503, code: 'SCM_STORE_CLOSED', retryable: true }))
      return enqueue(async () => {
        try { db.exec('BEGIN IMMEDIATE') } catch (error) {
          if (busy(error)) throw new ScmStoreError('SCM store busy', { status: 503, code: 'SCM_STORE_BUSY', retryable: true })
          throw error
        }
        try {
          const result = await fn(sql)
          db.exec('COMMIT')
          return result
        } catch (error) {
          try { db.exec('ROLLBACK') } catch { /* already rolled back by SQLite */ }
          throw error
        }
      })
    },
    async ping() {
      return enqueue(async () => sql.get('SELECT 1 AS ok').ok === 1)
    },
    async close() {
      if (closed) return
      closed = true
      await tail
      db.close()
    },
  }
}
