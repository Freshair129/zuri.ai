// Pricing under concurrency (FR-253):
//  1. the PricingRuleSet compare-and-swap — a second writer approves the draft
//     between this approval's version check and its update (the PostgreSQL-shaped
//     interleaving SQLite's writer lock never produces on its own). The approval
//     must be refused 409 PRICING_RULE_VERSION_CONFLICT and leave nothing behind;
//  2. two SCM processes race one approval and one calculation key (two owners):
//     exactly one approval wins, and every successful calculation is ONE snapshot.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { openSqliteStore } from '../../src/infrastructure/sqlite-store.js'
import { createCommandBus } from '../../src/application/commands.js'
import { createFixtureReferenceAuthority } from '../../src/infrastructure/reference-authority.js'
import { defaultPricingRules } from '../../src/modules/commerce/pricing/index.js'
import { createHarness, rejects } from '../support/harness.js'
import { startScmProcess } from '../support/scm-process.js'
import { BIZ, REFERENCE_FIXTURE, delegation, idem, seedDatabase, tempDbPath } from '../support/fixtures.js'

const OWNER = { [BIZ]: { owner: true, domains: ['commerce'], permissions: [] } }
const input = { costBasis: 'landed', landedUnitCostThb: '123.45', quantity: 100, kind: 'set', profile: 'corporate', orderCostThb: '0', sourceRefs: [] }

test('a PricingRuleSet version change between check and update is refused and rolled back', async () => {
  const h = createHarness()
  const owner = h.as({ sub: 'per-owner', grants: OWNER })
  const { ruleSet } = await h.run(owner, 'commerce.pricing-rule.create', { body: { businessId: BIZ, name: 'Race fixture', rules: defaultPricingRules() } })
  const count = (sql, t) => sql.get(`SELECT COUNT(*) AS n FROM ${t}`).n
  const before = await h.store.read((sql) => ({ audit: count(sql, 'ScmAuditEvent'), outbox: count(sql, 'ScmOutbox'), receipts: count(sql, 'ScmOperationReceipt') }))
  await h.store.close()

  const store = openSqliteStore({ location: h.db.path })
  let current = null
  const transaction = store.transaction
  store.transaction = (fn) => transaction((sql) => { current = sql; return fn(sql) })
  let interleave = true
  const bus = createCommandBus({ store, references: createFixtureReferenceAuthority(REFERENCE_FIXTURE), faults: { 'commerce.pricing-rule.action': { beforeRuleUpdate: () => {
    if (interleave) current.run("UPDATE PricingRuleSet SET name = 'concurrent edit', version = version + 1 WHERE id = ?", ruleSet.id)
  } } } })
  const approve = (version, key) => bus.run(owner, 'commerce.pricing-rule.action', { idempotencyKey: key, targetId: ruleSet.id, body: { businessId: BIZ, version, action: 'APPROVE', reason: 'Race review' } })
  try {
    await rejects(approve(1, idem('cas')), { status: 409, code: 'PRICING_RULE_VERSION_CONFLICT' })
    const afterRace = await store.read((sql) => ({
      row: { ...sql.get('SELECT name, status, version, approvedAt FROM PricingRuleSet WHERE id = ?', ruleSet.id) },
      audit: count(sql, 'ScmAuditEvent'), outbox: count(sql, 'ScmOutbox'), receipts: count(sql, 'ScmOperationReceipt'),
    }))
    // The concurrent edit was inside the refused unit of work: it rolled back too.
    assert.deepEqual(afterRace, { row: { name: 'Race fixture', status: 'DRAFT', version: 1, approvedAt: null }, ...before })
    interleave = false
    assert.equal((await approve(1, idem('cas-retry'))).ruleSet.status, 'APPROVED')
  } finally {
    await store.close()
    h.db.cleanup()
  }
})

const db = tempDbPath('pricing-race')
after(() => db.cleanup())
seedDatabase(db.path, {})

test('two processes: one approval wins; one calculation key yields one snapshot across two owners', async (t) => {
  const a = await startScmProcess({ sqlitePath: db.path })
  const b = await startScmProcess({ sqlitePath: db.path })
  const owner = (n) => delegation({ sub: `per-owner-${n}`, grants: OWNER })
  try {
    const created = await a.request('POST', '/v1/commerce/pricing-rules', { token: owner(1), key: idem('draft'), body: { businessId: BIZ, name: 'Race fixture', rules: defaultPricingRules() } })
    assert.equal(created.status, 201)
    const id = created.body.ruleSet.id
    const approvals = await Promise.all([a, b, a, b].map((p, i) => p.request('POST', `/v1/commerce/pricing-rules/${id}/actions`, { token: owner(i % 2), key: idem(`approve-${i}`), body: { businessId: BIZ, version: 1, action: 'APPROVE', reason: 'Race review' } })))
    t.diagnostic(`approvals: ${JSON.stringify(approvals.map((r) => (r.status === 201 ? 'APPROVED' : r.body.error.code)))}`)
    assert.equal(approvals.filter((r) => r.status === 201).length, 1)
    for (const r of approvals.filter((x) => x.status !== 201)) assert.ok(['PRICING_RULE_VERSION_CONFLICT', 'PRICING_RULE_IMMUTABLE', 'SCM_STORE_BUSY'].includes(r.body.error.code), r.body.error.code)

    const key = idem('shared-calculation')
    const results = await Promise.all([a, b, a, b, a, b].map((p, i) => p.request('POST', '/v1/commerce/pricing-rules/calculate', { token: owner(i % 2), key, body: { businessId: BIZ, input } })))
    t.diagnostic(`calculations: ${JSON.stringify(results.map((r) => r.status))}`)
    const ok = results.filter((r) => r.status === 201 || r.status === 200)
    assert.ok(ok.length >= 1)
    for (const r of results.filter((x) => !ok.includes(x))) assert.equal(r.body.error.code, 'SCM_STORE_BUSY')
    assert.equal(new Set(ok.map((r) => r.body.calculation.id)).size, 1)
    const check = new DatabaseSync(db.path)
    try {
      assert.equal(check.prepare('SELECT COUNT(*) AS n FROM PricingCalculation').get().n, 1)
      assert.equal(check.prepare("SELECT COUNT(*) AS n FROM ScmAuditEvent WHERE action = 'PRICING_CALCULATED'").get().n, 1)
    } finally { check.close() }
  } finally { await Promise.all([a.kill(), b.kill()]) }
})
