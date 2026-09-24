// Two SCM processes commit the same catalogue intake at once (FR-208, D-27).
// The commit takes a lock-only touch on the intake before it reads the status,
// so the later commit waits, reads COMMITTED and replays the committed row: both
// callers get the committed intake, and the catalogue changes exactly once.
//   case 1 — a plan that creates SKUs: exactly one set of products and audits.
//   case 2 — a plan of UNCHANGED items only: without the lock the loser's
//            compare-and-swap finds 0 rows on PostgreSQL READ COMMITTED and
//            answers 409 INVENTORY_CATALOG_INTAKE_VERSION_CONFLICT instead of the
//            replay (guard I-1 in scripts/prove-guards-on-postgres.mjs; SQLite's
//            writer lock serializes the whole unit and hides it).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { startScmProcess } from '../support/scm-process.js'
import { delegation, idem, openRaw, seedDatabase, tempDbPath } from '../support/fixtures.js'

const BIZ = 'biz-synthetic-a1'
const OWNER = { [BIZ]: { owner: true, domains: ['inventory'], permissions: [] } }
const ROUNDS = 3
const db = tempDbPath('intake-race')
after(() => db.cleanup())

test('two processes committing one intake: one commits, the other replays, the catalogue changes once', async (t) => {
  seedDatabase(db, {})
  const a = await startScmProcess({ db })
  const b = await startScmProcess({ db })
  try {
    const token = () => delegation({ sub: 'per-owner', grants: OWNER })
    const post = async (p, path, body) => {
      const r = await p.request('POST', path, { token: token(), key: idem('ci'), body })
      if (r.status !== 201 && r.status !== 200) throw Object.assign(new Error(`${path} ${r.status} ${JSON.stringify(r.body)}`), { response: r })
      return r.body
    }
    const category = (await post(a, '/v1/inventory/categories', { businessId: BIZ, code: 'CI-RACE-CAT', nameTh: 'หมวด', nameEn: 'Cat' })).category
    await post(a, '/v1/inventory/product-masters', { businessId: BIZ, code: 'CI-RACE-PM', categoryId: category.id, nameTh: 'ของ', nameEn: 'Thing' })
    const envelope = (correlationId, items) => ({ schemaVersion: '1.0', businessId: BIZ, source: { channel: 'REST_API', correlationId }, items })
    const race = async (intake) => {
      const results = await Promise.all([a, b].map((p) => p.request('POST', '/v1/inventory/catalog-intakes/commit', { token: token(), key: idem('ci-commit'), body: { businessId: BIZ, intakeId: intake.id, planHash: intake.planHash } })))
      return results.map((r) => (r.status === 201 ? 'COMMITTED' : r.status === 200 && r.body.replayed ? 'REPLAYED' : r.body.error?.code ?? `HTTP_${r.status}`))
    }
    const outcomes = { creates: [], unchanged: [] }
    for (let round = 0; round < ROUNDS; round += 1) {
      const code = `CI-RACE-${round}`
      const creates = (await post(a, '/v1/inventory/catalog-intakes/preview', envelope(`race-create-${round}`, [{ sku: { code, name: `Race ${round}` }, master: { code: 'CI-RACE-PM' }, identifiers: [{ kind: 'BARCODE', value: `${code}-BAR` }] }]))).intake
      outcomes.creates.push(await race(creates))
      // The same item again, now that it exists: an UNCHANGED-only plan.
      const unchanged = (await post(a, '/v1/inventory/catalog-intakes/preview', envelope(`race-same-${round}`, [{ sku: { code, name: `Race ${round}` }, master: { code: 'CI-RACE-PM' } }]))).intake
      assert.deepEqual(unchanged.plan.items.map((i) => i.decision), ['UNCHANGED'])
      outcomes.unchanged.push(await race(unchanged))
    }
    t.diagnostic(`outcomes: ${JSON.stringify(outcomes)}`)
    for (const pair of [...outcomes.creates, ...outcomes.unchanged]) assert.deepEqual([...pair].sort(), ['COMMITTED', 'REPLAYED'])
    const check = openRaw(db)
    try {
      for (let round = 0; round < ROUNDS; round += 1) {
        assert.equal(Number(check.prepare('SELECT COUNT(*) AS n FROM Product WHERE code = ?').get(`CI-RACE-${round}`).n), 1)
        assert.equal(Number(check.prepare('SELECT COUNT(*) AS n FROM ProductIdentifier WHERE value = ?').get(`CI-RACE-${round}-BAR`).n), 1)
      }
      assert.equal(Number(check.prepare("SELECT COUNT(*) AS n FROM ScmAuditEvent WHERE action = 'INVENTORY_CATALOG_INTAKE_COMMITTED'").get().n), ROUNDS * 2)
      assert.equal(Number(check.prepare("SELECT COUNT(*) AS n FROM ScmAuditEvent WHERE action = 'PRODUCT_CREATED'").get().n), ROUNDS)
    } finally { check.close() }
  } finally { await Promise.all([a.kill(), b.kill()]) }
})
