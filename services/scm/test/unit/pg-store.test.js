// The PostgreSQL store adapter on a real (disposable) PostgreSQL: dialect
// translation, schema, value types, store-level refusals, the retry rule, lock
// timeouts, snapshot reads and reconnection. Always runs: on a SQLite suite run it
// starts its own embedded PostgreSQL; with --engine=postgres it uses the suite's.
// The engine-neutral behaviour (every use case) is the whole suite run with
// `node scripts/run-tests.mjs --engine=postgres`.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { toPostgres } from '../../src/infrastructure/sql-dialect.js'
import { openPgConnection } from '../../src/infrastructure/pg-connection.js'
import { openPostgresStore } from '../../src/infrastructure/pg-store.js'
import { POSTGRES_DDL, SCHEMA_VERSION, TRIGGERS } from '../../src/infrastructure/schema.js'
import { startTestPostgres } from '../support/pg-server.js'

test('the dialect quotes mixed-case names, numbers placeholders and leaves literals, comments and keywords alone', () => {
  assert.deepEqual(
    toPostgres("SELECT tenantId, code, COUNT(*) AS n FROM SalesOrder WHERE businessId = ? AND status != 'CONFIRMED' AND note = 'it''s ?' -- a camelCase ? comment\nLIMIT ?"),
    { text: "SELECT \"tenantId\", code, COUNT(*) AS n FROM \"SalesOrder\" WHERE \"businessId\" = $1 AND status != 'CONFIRMED' AND note = 'it''s ?' -- a camelCase ? comment\nLIMIT $2", params: 2 },
  )
  assert.equal(toPostgres('ON CONFLICT (tenantId, businessId) DO UPDATE SET mutationRevision = InventoryLedgerFence.mutationRevision + 0, updatedAt = excluded.updatedAt').text,
    'ON CONFLICT ("tenantId", "businessId") DO UPDATE SET "mutationRevision" = "InventoryLedgerFence"."mutationRevision" + 0, "updatedAt" = excluded."updatedAt"')
  assert.equal(toPostgres('SELECT id FROM "Already" ORDER BY rowid').text, 'SELECT id FROM "Already" ORDER BY ctid')
})

let server = null
let admin
let adminUrl
const databases = []
before(async () => {
  adminUrl = process.env.SCM_TEST_PG_ADMIN_URL
  if (!adminUrl) { server = await startTestPostgres({ label: 'adapter' }); adminUrl = server.adminUrl }
  admin = openPgConnection(adminUrl)
})
after(async () => {
  for (const name of databases) admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
  await admin.close()
  await server?.stop()
})
function freshDatabase({ schema = true } = {}) {
  const name = `scm_adapter_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  admin.query(`CREATE DATABASE ${name}`)
  databases.push(name)
  const url = adminUrl.replace(/\/[^/]*$/, `/${name}`)
  if (schema) {
    const c = openPgConnection(url)
    c.query(POSTGRES_DDL)
    c.query('INSERT INTO "ScmSchemaVersion" (version, "appliedAt") VALUES ($1, $2)', [SCHEMA_VERSION, new Date().toISOString()])
    c.close()
  }
  return { name, url }
}
const now = () => new Date().toISOString()
const supplierRow = (code, id = randomUUID()) => ['INSERT INTO Supplier (id, code, tenantId, businessId, name, status, createdAt, updatedAt, version) VALUES (?,?,?,?,?,?,?,?,1)', id, code, 'tenant-synthetic-a', 'biz-synthetic-a1', 'Synthetic Supplier', 'ACTIVE', now(), now()]

test('schema: refuses a database without it, creates it on request, and re-applies idempotently', async () => {
  const empty = freshDatabase({ schema: false })
  assert.throws(() => openPostgresStore({ url: empty.url }), (e) => e.code === 'SCM_SCHEMA_MISMATCH')
  const store = openPostgresStore({ url: empty.url, ensureSchema: true })
  await store.close()
  const again = openPostgresStore({ url: empty.url, ensureSchema: true })
  const tables = await again.read((sql) => sql.all("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public'").map((r) => r.t).sort())
  assert.ok(tables.includes('SupplierCostSheet') && tables.includes('ScmOperationReceipt') && tables.includes('ScmSchemaVersion'))
  const triggers = await again.read((sql) => sql.get("SELECT COUNT(DISTINCT trigger_name) AS n FROM information_schema.triggers WHERE trigger_schema = 'public'").n)
  assert.equal(triggers, TRIGGERS.length)
  await again.close()
})

test('values: camelCase keys, counts and sums as numbers, 8-byte reals, UTF-8 text', async () => {
  const { url } = freshDatabase()
  const store = openPostgresStore({ url })
  try {
    await store.transaction((sql) => {
      sql.run(...supplierRow('SUP-TH'))
      sql.run("UPDATE Supplier SET name = ? WHERE code = 'SUP-TH'", 'บริษัท ซัพพลายเออร์ · สังเคราะห์')
      sql.run("INSERT INTO Product (id, code, tenantId, businessId, productMasterId, cartonCbm, createdAt, updatedAt, version) VALUES ('p1','P-1','tenant-synthetic-a','biz-synthetic-a1','pm',0.018,?,?,1)", now(), now())
      sql.run("INSERT INTO StockMovement (id, tenantId, businessId, productId, kind, quantity, occurredAt, createdAt) VALUES ('m1','tenant-synthetic-a','biz-synthetic-a1','p1','RECEIPT',2147483647,?,?)", now(), now())
      sql.run("INSERT INTO StockMovement (id, tenantId, businessId, productId, kind, quantity, occurredAt, createdAt) VALUES ('m2','tenant-synthetic-a','biz-synthetic-a1','p1','RECEIPT',5,?,?)", now(), now())
    })
    const read = await store.read((sql) => ({
      supplier: sql.get("SELECT name, tenantId FROM Supplier WHERE code = 'SUP-TH'"),
      count: sql.get('SELECT COUNT(*) AS n FROM Supplier').n,
      sum: sql.get('SELECT COALESCE(SUM(quantity), 0) AS q FROM StockMovement').q,
      cbm: sql.get("SELECT cartonCbm FROM Product WHERE id = 'p1'").cartonCbm,
    }))
    assert.deepEqual(read, { supplier: { name: 'บริษัท ซัพพลายเออร์ · สังเคราะห์', tenantId: 'tenant-synthetic-a' }, count: 1, sum: 2147483652, cbm: 0.018 })
  } finally { await store.close() }
})

test('store-level refusals surface their message; a failed unit leaves nothing', async () => {
  const { url } = freshDatabase()
  const store = openPostgresStore({ url })
  try {
    await store.transaction((sql) => {
      sql.run("INSERT INTO Product (id, code, tenantId, businessId, productMasterId, createdAt, updatedAt, version) VALUES ('p1','P-1','tenant-synthetic-a','biz-synthetic-a1','pm',?,?,1)", now(), now())
      sql.run("INSERT INTO StockMovement (id, tenantId, businessId, productId, kind, quantity, occurredAt, createdAt) VALUES ('m1','tenant-synthetic-a','biz-synthetic-a1','p1','RECEIPT',3,?,?)", now(), now())
    })
    await assert.rejects(store.transaction((sql) => sql.run('UPDATE StockMovement SET quantity = 30')), /INVENTORY_LEDGER_APPEND_ONLY/)
    await assert.rejects(store.transaction((sql) => { sql.run(...supplierRow('SUP-X')); sql.run("DELETE FROM StockMovement WHERE id = 'm1'") }), /INVENTORY_LEDGER_APPEND_ONLY/)
    assert.equal(await store.read((sql) => sql.get('SELECT COUNT(*) AS n FROM Supplier').n), 0)
  } finally { await store.close() }
})

test('a unit that loses a unique race to a committed peer is re-run and sees the peer; a lasting conflict is a retryable 409', async () => {
  const { url } = freshDatabase()
  const store = openPostgresStore({ url })
  const peer = openPgConnection(url)
  try {
    let attempts = 0
    const outcome = await store.transaction((sql) => {
      attempts += 1
      const existing = sql.get("SELECT id FROM Supplier WHERE tenantId = 'tenant-synthetic-a' AND code = 'SUP-RACE'")
      if (existing) return { replayOf: existing.id }
      // The peer commits the same code after this unit looked and before it writes.
      if (attempts === 1) { const t = toPostgres(supplierRow('SUP-RACE', 'peer-row')[0]); peer.query(t.text, supplierRow('SUP-RACE', 'peer-row').slice(1)) }
      sql.run(...supplierRow('SUP-RACE'))
      return { created: true }
    })
    assert.deepEqual([attempts, outcome], [2, { replayOf: 'peer-row' }])
    let tries = 0
    await assert.rejects(store.transaction((sql) => { tries += 1; sql.run(...supplierRow('SUP-RACE')) }), (e) => e.code === 'SCM_CONCURRENT_CONFLICT' && e.status === 409 && e.retryable === true && /unique/i.test(e.message))
    assert.equal(tries, 5)
  } finally { peer.close(); await store.close() }
})

test('a row lock held longer than lock_timeout is a retryable 503 SCM_STORE_BUSY, not a hang', async () => {
  const { url } = freshDatabase()
  const store = openPostgresStore({ url, lockTimeoutMs: 300 })
  const holder = openPgConnection(url)
  try {
    await store.transaction((sql) => sql.run(...supplierRow('SUP-LOCK', 'locked')))
    holder.query('BEGIN')
    holder.query(`UPDATE "Supplier" SET name = 'held' WHERE id = 'locked'`)
    const started = Date.now()
    await assert.rejects(store.transaction((sql) => sql.run("UPDATE Supplier SET name = 'mine' WHERE id = 'locked'")), (e) => e.code === 'SCM_STORE_BUSY' && e.status === 503 && e.retryable === true)
    assert.ok(Date.now() - started < 5000)
    holder.query('ROLLBACK')
    await store.transaction((sql) => sql.run("UPDATE Supplier SET name = 'mine' WHERE id = 'locked'"))
    assert.equal(await store.read((sql) => sql.get("SELECT name FROM Supplier WHERE id = 'locked'").name), 'mine')
  } finally { holder.close(); await store.close() }
})

test('a read sees one snapshot even when a peer commits in between', async () => {
  const { url } = freshDatabase()
  const store = openPostgresStore({ url })
  const peer = openPgConnection(url)
  try {
    const counts = await store.read((sql) => {
      const first = sql.get('SELECT COUNT(*) AS n FROM Supplier').n
      const t = toPostgres(supplierRow('SUP-LATE')[0]); peer.query(t.text, supplierRow('SUP-LATE').slice(1))
      return [first, sql.get('SELECT COUNT(*) AS n FROM Supplier').n]
    })
    assert.deepEqual(counts, [0, 0])
    assert.equal(await store.read((sql) => sql.get('SELECT COUNT(*) AS n FROM Supplier').n), 1)
    await assert.rejects(store.read((sql) => sql.run(...supplierRow('SUP-RO'))), /read-only/)
  } finally { peer.close(); await store.close() }
})

test('a lost connection fails the unit in flight with a retryable 503 and the next unit reconnects', async () => {
  const { name, url } = freshDatabase()
  const store = openPostgresStore({ url })
  try {
    assert.equal(await store.ping(), true)
    admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND application_name = 'zuri-scm'`)
    await assert.rejects(store.read((sql) => sql.get('SELECT 1 AS ok')), (e) => e.code === 'SCM_STORE_UNAVAILABLE' && e.status === 503 && e.retryable === true)
    assert.equal(await store.read((sql) => sql.get('SELECT 1 AS ok').ok), 1)
    await store.transaction((sql) => sql.run(...supplierRow('SUP-AFTER')))
    assert.equal(await store.read((sql) => sql.get('SELECT COUNT(*) AS n FROM Supplier').n), 1)
  } finally { await store.close() }
})

test('configuration: postgres needs SCM_PG_URL of the right shape and never echoes it', async () => {
  const { loadConfig } = await import('../../src/config.js')
  const base = { SCM_DELEGATION_KEY: 'k'.repeat(40) }
  assert.throws(() => loadConfig({ ...base, SCM_STORE: 'postgres' }), (e) => e.code === 'SCM_CONFIG_INVALID' && /SCM_PG_URL/.test(e.message))
  assert.throws(() => loadConfig({ ...base, SCM_STORE: 'postgres', SCM_PG_URL: 'mysql://u:secret-pw@h/db' }), (e) => e.code === 'SCM_CONFIG_INVALID' && !e.message.includes('secret-pw'))
  assert.throws(() => loadConfig({ ...base }), (e) => /SCM_SQLITE_PATH/.test(e.message))
  const c = loadConfig({ ...base, SCM_STORE: 'postgres', SCM_PG_URL: 'postgres://u:p@127.0.0.1:5432/scm' })
  assert.deepEqual([c.store, c.pgUrl, c.sqlitePath], ['postgres', 'postgres://u:p@127.0.0.1:5432/scm', null])
})
