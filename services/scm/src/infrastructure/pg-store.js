import { POSTGRES_DDL, SCHEMA_VERSION } from './schema.js'
import { toPostgres } from './sql-dialect.js'
import { openPgConnection, PgConnectionError } from './pg-connection.js'
import { ScmStoreError } from './sqlite-store.js'

// The SCM transactional store on PostgreSQL — the same port as sqlite-store.js
// (`read`, `transaction`, `ping`, `close`; `sql.get/all/run` inside), so no module
// knows which engine it runs on.
//
// Isolation. A unit of work runs at READ COMMITTED, PostgreSQL's default and the
// level the legacy defects F-1/F-9/F-12 are about. The SCM invariants do not rely
// on a writer lock there: they rely on compare-and-swap predicates, the Inventory
// ledger fence (a row lock taken before any on-hand read), the order-row lock
// before a refund ceiling read (D-9), and unique constraints. A read runs in a
// READ ONLY REPEATABLE READ transaction, so a multi-statement read sees one snapshot.
//
// Retries. A unit that loses a race to a committed peer is re-run from the start,
// a bounded number of times, when PostgreSQL says the loss is safe to retry:
// serialization failure (40001), deadlock (40P01) and unique violation (23505).
// The re-run re-reads everything — the idempotency receipt first — so a lost
// unique race on a receipt, a code, a calculation key or a source hash becomes a
// replay, the next free code or the domain's own refusal, never a duplicate. A
// lock wait longer than `lockTimeoutMs` (55P03) is a retryable 503 SCM_STORE_BUSY,
// the same answer SQLite gives when its writer lock is held.
//
// Connection loss (server restart, killed backend, network) fails the unit in
// flight with a retryable 503 SCM_STORE_UNAVAILABLE and the next unit opens a
// fresh connection. A COMMIT whose reply was lost has an unknown outcome; the
// caller resolves it with the same Idempotency-Key (replay or lookup), never by
// resending under a new key.
//
// In-process ordering is the same FIFO queue as the SQLite store: one connection,
// one unit at a time, never interleaved with another request's statements. The
// thread blocks while a statement runs — as it does on node:sqlite — so a unit
// waiting on a row lock holds this process for up to `lockTimeoutMs`.

const RETRYABLE = new Set(['40001', '40P01', '23505'])

export function openPostgresStore({ url, ensureSchema = false, lockTimeoutMs = 5000, statementTimeoutMs = 30000, maxAttempts = 5 }) {
  if (!url) throw new ScmStoreError('SCM_PG_URL is required', { code: 'SCM_CONFIG_INVALID' })
  const unavailable = (error) => new ScmStoreError(`SCM PostgreSQL unavailable: ${error.message}`, { status: 503, code: 'SCM_STORE_UNAVAILABLE', retryable: true })
  let conn = null
  const connect = () => {
    if (conn) return conn
    try {
      conn = openPgConnection(url, { callTimeoutMs: statementTimeoutMs + 5000 })
      conn.query(`SET lock_timeout = ${Number(lockTimeoutMs) | 0}; SET statement_timeout = ${Number(statementTimeoutMs) | 0}; SET TIME ZONE 'UTC'`)
      return conn
    } catch (error) {
      conn?.close()
      conn = null
      throw unavailable(error)
    }
  }
  const drop = () => { const c = conn; conn = null; c?.close() }
  connect()
  const exec = (text) => conn.query(text)
  if (ensureSchema) {
    exec(POSTGRES_DDL)
    conn.query('INSERT INTO "ScmSchemaVersion" (version, "appliedAt") VALUES ($1, $2) ON CONFLICT DO NOTHING', [SCHEMA_VERSION, new Date().toISOString()])
  }
  const present = conn.query(`SELECT to_regclass('"ScmSchemaVersion"') IS NOT NULL AS ok`).rows[0].ok
  const version = present ? conn.query('SELECT MAX(version) AS v FROM "ScmSchemaVersion"').rows[0].v : null
  if (version !== SCHEMA_VERSION) {
    drop()
    throw new ScmStoreError(`SCM schema version ${version ?? 'absent'} != expected ${SCHEMA_VERSION}; schema is applied by the migration owner, not at startup`, { code: 'SCM_SCHEMA_MISMATCH' })
  }

  const run = (text, params) => {
    const t = toPostgres(text)
    return conn.query(t.text, params)
  }
  const sql = {
    get: (text, ...params) => run(text, params).rows[0],
    all: (text, ...params) => run(text, params).rows,
    run: (text, ...params) => ({ changes: run(text, params).rowCount }),
  }

  let tail = Promise.resolve()
  let closed = false
  const enqueue = (job) => {
    const next = tail.then(job, job)
    tail = next.catch(() => {})
    return next
  }
  const closedError = () => new ScmStoreError('store closed', { status: 503, code: 'SCM_STORE_CLOSED', retryable: true })
  const rollback = () => { try { conn?.query('ROLLBACK') } catch { /* connection already reset or gone */ } }
  const translate = (error) => {
    if (!(error instanceof PgConnectionError)) return error
    if (error.connectionLost) { drop(); return unavailable(error) }
    if (error.pgCode === '55P03') return new ScmStoreError('SCM store busy', { status: 503, code: 'SCM_STORE_BUSY', retryable: true })
    return error
  }
  /** Open (or reopen) the connection and begin; a failure here is the store being unavailable. */
  const begin = (statement) => {
    connect()
    try { exec(statement) } catch (error) { throw translate(error) }
  }

  return {
    kind: 'postgres',
    read(fn) {
      if (closed) return Promise.reject(closedError())
      return enqueue(async () => {
        begin('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        try {
          const result = await fn(sql)
          exec('COMMIT')
          return result
        } catch (error) {
          rollback()
          throw translate(error)
        }
      })
    },
    transaction(fn) {
      if (closed) return Promise.reject(closedError())
      return enqueue(async () => {
        for (let attempt = 1; ; attempt += 1) {
          begin('BEGIN ISOLATION LEVEL READ COMMITTED')
          try {
            const result = await fn(sql)
            exec('COMMIT')
            return result
          } catch (error) {
            rollback()
            if (error instanceof PgConnectionError && RETRYABLE.has(error.pgCode)) {
              if (attempt < maxAttempts) continue
              throw new ScmStoreError(`SCM concurrent conflict after ${attempt} attempts: ${error.message}`, { status: 409, code: 'SCM_CONCURRENT_CONFLICT', retryable: true })
            }
            throw translate(error)
          }
        }
      })
    },
    async ping() {
      return enqueue(async () => {
        try { connect(); return sql.get('SELECT 1 AS ok').ok === 1 } catch (error) { translate(error); return false }
      })
    },
    async close() {
      if (closed) return
      closed = true
      await tail
      await conn?.close()
      conn = null
    },
  }
}
