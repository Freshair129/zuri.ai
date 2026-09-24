// Supplier cost-sheet commit under concurrency (TASK-ZAI-053):
//  1. the sheet compare-and-swap — a second writer moves the sheet's version
//     between this commit's read and its confirm (the PostgreSQL-shaped
//     interleaving SQLite's writer lock never produces on its own). The commit is
//     refused 409 PROCUREMENT_COST_SHEET_VERSION_CONFLICT and the carton facts
//     and lines written earlier in the same unit roll back with it;
//  2. two SCM processes commit the same sheet and two sheets of one supplier at
//     once: the same sheet gets lines once (the loser sees CONFIRMED → replay),
//     and the supplier ends with exactly one CONFIRMED sheet. The two racing
//     sheets carry no carton facts on purpose: with carton facts the Product
//     version check already serializes them (the loser gets
//     PRODUCT_VERSION_CONFLICT), which would hide the F-12 shape — two commits
//     that each supersede before the other confirms.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createCommandBus } from '../../src/application/commands.js'
import { createFixtureReferenceAuthority } from '../../src/infrastructure/reference-authority.js'
import { createHarness, rejects } from '../support/harness.js'
import { startScmProcess } from '../support/scm-process.js'
import { BIZ, REFERENCE_FIXTURE, delegation, idem, openRaw, openTestStore, seedDatabase, tempDbPath } from '../support/fixtures.js'

const OWNER = { [BIZ]: { owner: true, domains: ['procurement', 'inventory'], permissions: [] } }
const BOX = { id: 'prod-box', code: 'SG-BOX-RACE' }
const envelope = (supplierId, sourceSha256, cost = 1.25, { carton = true } = {}) => ({ businessId: BIZ, supplierId, currency: 'USD', fxRateLocked: 34, sourceSha256, lines: [{ sku: BOX.code, minQty: 1, unitCostForeign: cost, ...(carton ? { unitsPerCarton: 24 } : {}) }, { sku: BOX.code, minQty: 100, unitCostForeign: cost - 0.1, ...(carton ? { unitsPerCarton: 24 } : {}) }] })
const mappings = [{ sourceSku: BOX.code, productId: BOX.id, confirmed: true }]

test('a sheet version change between read and confirm is refused and rolls back carton facts and lines', async () => {
  const h = createHarness({ products: [BOX] })
  const owner = h.as({ sub: 'per-owner', grants: OWNER })
  const { supplier } = await h.run(owner, 'procurement.supplier.create', { body: { businessId: BIZ, code: 'SUP-RACE', name: 'Race Supplier' } })
  const { sheet } = await h.run(owner, 'procurement.cost-sheet.preview', { body: envelope(supplier.id, 'a'.repeat(64)) })
  const count = (sql, t) => sql.get(`SELECT COUNT(*) AS n FROM ${t}`).n
  const before = await h.store.read((sql) => ({ audit: count(sql, 'ScmAuditEvent'), outbox: count(sql, 'ScmOutbox'), receipts: count(sql, 'ScmOperationReceipt') }))
  await h.store.close()

  const store = openTestStore(h.db)
  let current = null
  const transaction = store.transaction
  store.transaction = (fn) => transaction((sql) => { current = sql; return fn(sql) })
  let interleave = true
  const bus = createCommandBus({ store, references: createFixtureReferenceAuthority(REFERENCE_FIXTURE), faults: { 'procurement.cost-sheet.commit': { beforeConfirm: () => {
    if (interleave) current.run('UPDATE SupplierCostSheet SET version = version + 1 WHERE id = ?', sheet.id)
  } } } })
  const run = (key) => bus.run(owner, 'procurement.cost-sheet.commit', { idempotencyKey: key, body: { businessId: BIZ, sheetId: sheet.id, previewHash: sheet.preview.hash, mappings } })
  try {
    await rejects(run(idem('cas')), { status: 409, code: 'PROCUREMENT_COST_SHEET_VERSION_CONFLICT' })
    const afterRace = await store.read((sql) => ({
      sheet: { ...sql.get('SELECT status, version FROM SupplierCostSheet WHERE id = ?', sheet.id) },
      lines: count(sql, 'SupplierCostLine'),
      carton: { ...sql.get('SELECT unitsPerCarton, version FROM Product WHERE id = ?', BOX.id) },
      audit: count(sql, 'ScmAuditEvent'), outbox: count(sql, 'ScmOutbox'), receipts: count(sql, 'ScmOperationReceipt'),
    }))
    assert.deepEqual(afterRace, { sheet: { status: 'DRAFT', version: 1 }, lines: 0, carton: { unitsPerCarton: null, version: 1 }, ...before })
    interleave = false
    assert.equal((await run(idem('cas-retry'))).sheet.status, 'CONFIRMED')
  } finally {
    await store.close()
    h.db.cleanup()
  }
})

const db = tempDbPath('cost-sheet-race')
after(() => db.cleanup())
seedDatabase(db, { products: [BOX] })

test('two processes: one sheet gets its lines once; one supplier ends with exactly one CONFIRMED sheet', async (t) => {
  const a = await startScmProcess({ db })
  const b = await startScmProcess({ db })
  const owner = (n) => delegation({ sub: `per-owner-${n}`, grants: OWNER })
  const post = (p, path, body, n = 1) => p.request('POST', path, { token: owner(n), key: idem('k'), body })
  try {
    const supplier = (await post(a, '/v1/procurement/suppliers', { businessId: BIZ, code: 'SUP-RACE-2', name: 'Race Supplier' })).body.supplier
    const sheets = []
    for (const [i, hash] of ['b', 'c', 'd'].entries()) sheets.push((await post(a, '/v1/procurement/cost-sheets/preview', envelope(supplier.id, hash.repeat(64), 1.25 + i / 10, { carton: i === 0 }))).body.sheet)
    const [same, other1, other2] = sheets
    const commitOf = (sheet) => ({ businessId: BIZ, sheetId: sheet.id, previewHash: sheet.preview.hash, mappings })
    const sameResults = await Promise.all([a, b, a, b].map((p, i) => post(p, '/v1/procurement/cost-sheets/commit', commitOf(same), i % 2)))
    t.diagnostic(`same sheet: ${JSON.stringify(sameResults.map((r) => (r.body.error ? r.body.error.code : r.body.replayed ? 'replayed' : 'committed')))}`)
    assert.equal(sameResults.filter((r) => r.status === 201 && r.body.replayed === false).length, 1)
    for (const r of sameResults.filter((x) => x.body.error)) assert.equal(r.body.error.code, 'SCM_STORE_BUSY')
    const racers = await Promise.all([[a, other1], [b, other2]].map(([p, s], i) => post(p, '/v1/procurement/cost-sheets/commit', commitOf(s), i)))
    t.diagnostic(`two sheets: ${JSON.stringify(racers.map((r) => (r.body.error ? r.body.error.code : r.status)))}`)
    for (const r of racers.filter((x) => x.body.error)) assert.ok(['SCM_STORE_BUSY', 'SCM_CONCURRENT_CONFLICT'].includes(r.body.error.code), r.body.error.code)
    const check = openRaw(db)
    try {
      assert.equal(check.prepare('SELECT COUNT(*) AS n FROM SupplierCostLine WHERE sheetId = ?').get(same.id).n, 2)
      assert.equal(check.prepare("SELECT COUNT(*) AS n FROM SupplierCostSheet WHERE supplierId = ? AND status = 'CONFIRMED'").get(supplier.id).n, 1)
      assert.equal(check.prepare("SELECT COUNT(*) AS n FROM ScmAuditEvent WHERE action = 'SUPPLIER_COST_SHEET_COMMITTED'").get().n, 1 + racers.filter((r) => r.status === 201).length)
    } finally { check.close() }
  } finally { await Promise.all([a.kill(), b.kill()]) }
})
