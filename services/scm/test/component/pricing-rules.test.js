// Pricing rules lifecycle + calculation (FR-253, ADR-098) through the real SCM
// use cases and store. Every [legacy] test mirrors one case of apps/server
// tests/integration/fr253-pricing-rules.test.js with the same inputs and the
// same expectations; the rest pin what SCM adds (header key semantics, replay
// guard, owner-only lookup, database-level immutability, rollback).
import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, rejects } from '../support/harness.js'
import { BIZ, OTHER_BIZ, idem } from '../support/fixtures.js'
import { calculatePrice, defaultPricingRules } from '../../src/modules/commerce/pricing/index.js'

const NOW = new Date('2026-09-17T00:00:00.000Z')
const later = (minutes) => new Date(NOW.getTime() + minutes * 60000)
const input = () => ({ costBasis: 'landed', landedUnitCostThb: '123.45', quantity: 100, kind: 'set', profile: 'corporate', orderCostThb: '0', sourceRefs: [] })
const G = {
  owner: { [BIZ]: { owner: true, domains: ['commerce'], permissions: [] } },
  owner2: { [BIZ]: { owner: true, domains: ['commerce'], permissions: [] } },
  // A member with every Commerce permission is still not an owner.
  member: { [BIZ]: { owner: false, domains: ['commerce'], permissions: ['commerce.order.write', 'commerce.payment.verify'] } },
  noDomain: { [BIZ]: { owner: true, domains: ['inventory'], permissions: [] } },
  foreignOwner: { [OTHER_BIZ]: { owner: true, domains: ['commerce'], permissions: [] } },
}

let h, clock
beforeEach(() => { clock = NOW; h = createHarness({ clock: () => clock }) })
afterEach(() => h.close())
const as = (who) => h.as({ sub: `per-${who}`, grants: G[who] })
const at = async (when, fn) => { const saved = clock; clock = when; try { return await fn() } finally { clock = saved } }

const draft = (over = {}, who = 'owner') => h.run(as(who), 'commerce.pricing-rule.create', { body: { businessId: BIZ, name: 'Fixture policy', rules: defaultPricingRules(), ...over } }).then((r) => r.ruleSet)
const approve = (row, over = {}, who = 'owner') => h.run(as(who), 'commerce.pricing-rule.action', { targetId: row.id, body: { businessId: row.businessId, version: row.version, action: 'APPROVE', reason: 'Fixture owner review', ...over } }).then((r) => r.ruleSet)
const revoke = (row, over = {}) => h.run(as('owner'), 'commerce.pricing-rule.action', { targetId: row.id, body: { businessId: BIZ, version: row.version, action: 'REVOKE', reason: 'Withdraw fixture', ...over } }).then((r) => r.ruleSet)
const update = (row, over = {}, who = 'owner') => h.run(as(who), 'commerce.pricing-rule.update', { targetId: row.id, body: { businessId: BIZ, version: row.version, name: 'Reviewed draft', rules: row.rules, reason: 'Rename after review', ...over } }).then((r) => r.ruleSet)
const calculate = (key, ruleSetId, over = {}, who = 'owner') => h.run(as(who), 'commerce.pricing.calculate', { idempotencyKey: key, body: { businessId: BIZ, ...(ruleSetId ? { ruleSetId } : {}), input: input(), ...over } })
const list = (who = 'owner') => h.bus.queries.pricingRules(as(who), { businessId: BIZ })
const active = (who = 'owner', businessId = BIZ) => h.bus.queries.activePricingRule(as(who), businessId).then((r) => r.ruleSet)
const preview = (body, who = 'owner') => h.bus.queries.pricingPreview(as(who), { businessId: BIZ, ...body })
const audits = (entityId) => h.store.read((sql) => sql.all('SELECT action, businessId, reason, beforeJson, afterJson FROM ScmAuditEvent WHERE entityId = ? ORDER BY rowid', entityId))

describe('[legacy] FR-253 scoped pricing lifecycle', () => {
  test('refuses internal reads, editing, preview, calculation and activation by members or other Business owners', async () => {
    const row = await draft()
    for (const who of ['member', 'foreignOwner', 'noDomain']) {
      await rejects(list(who), { status: 404 })
      await rejects(draft({}, who), { status: 404 })
      await rejects(preview({ rules: row.rules, input: input() }, who), { status: 404 })
      await rejects(calculate(idem('forbidden'), row.id, {}, who), { status: 404 })
      await rejects(h.run(as(who), 'commerce.pricing-rule.action', { targetId: row.id, body: { businessId: BIZ, version: 1, action: 'APPROVE', reason: 'attempt' } }), { status: 404 })
      await rejects(update(row, {}, who), { status: 404 })
      await rejects(active(who), { status: 404 })
    }
    const foreign = await draft({ businessId: OTHER_BIZ }, 'foreignOwner')
    await rejects(draft({ sourceRuleSetId: foreign.id }), { status: 404 })
    await rejects(preview({ rules: row.rules, input: input(), compareRuleSetId: foreign.id }), { status: 404 })
    await rejects(calculate(idem('foreign-id'), foreign.id), { status: 404 })
    // A foreign rule addressed through my Business, or mine through theirs: the same 404.
    await rejects(approve({ ...foreign, businessId: BIZ }), { status: 404 })
    await rejects(approve({ ...row, businessId: OTHER_BIZ }, {}, 'foreignOwner'), { status: 404 })
  })

  test('edits drafts with compare-and-swap and records changes and approval atomically', async () => {
    const row = await draft()
    const updated = await update(row)
    assert.deepEqual([updated.version, updated.name, updated.status], [2, 'Reviewed draft', 'DRAFT'])
    await rejects(update(row), { status: 409, code: 'PRICING_RULE_VERSION_CONFLICT' })
    const approved = await approve(updated)
    assert.deepEqual([approved.status, approved.version, approved.approvedByPersonId, approved.isActive], ['APPROVED', 3, 'per-owner', true])
    await rejects(update(approved), { status: 409, code: 'PRICING_RULE_IMMUTABLE' })
    await rejects(approve(approved), { status: 409, code: 'PRICING_RULE_IMMUTABLE' })
    const events = await audits(row.id)
    assert.deepEqual(events.map((e) => e.action), ['PRICING_RULE_DRAFT_CREATED', 'PRICING_RULE_DRAFT_UPDATED', 'PRICING_RULE_APPROVED'])
    assert.ok(events.every((e) => e.businessId === BIZ))
    assert.equal(events[2].reason, 'Fixture owner review')
    assert.deepEqual(JSON.parse(events[2].beforeJson), { status: 'DRAFT', version: 2, rulesHash: row.rulesHash, effectiveFrom: null, expiresAt: null })
    assert.deepEqual(JSON.parse(events[2].afterJson), { status: 'APPROVED', version: 3, rulesHash: row.rulesHash, effectiveFrom: NOW.toISOString(), expiresAt: null })
  })

  test('rolls back the rule write when its audit write fails', async () => {
    await h.close()
    h = createHarness({ clock: () => clock, faults: { 'commerce.pricing-rule.create': { afterAudit: () => { throw new Error('audit unavailable') } } } })
    const before = await h.snapshot()
    await assert.rejects(draft(), /audit unavailable/)
    assert.equal(await h.count('PricingRuleSet'), 0)
    assert.deepEqual(await h.snapshot(), before)
  })

  test('uses the same evaluator in preview and durable calculation, with immutable snapshots and idempotency', async () => {
    const approved = await approve(await draft())
    const p = await preview({ rules: approved.rules, input: input(), compareRuleSetId: approved.id })
    const key = idem('same-request')
    const { calculation: result } = await calculate(key, approved.id)
    assert.deepEqual(result.result, p.result)
    assert.deepEqual(result.result, calculatePrice(defaultPricingRules(), input()))
    assert.deepEqual([p.comparison.ruleSetId, p.comparison.deltaUnitPriceSatang, p.comparison.deltaTotalPriceSatang], [approved.id, 0, 0])
    assert.deepEqual([result.ruleSetId, result.ruleVersion, result.rulesHash, result.inputProvenance, result.publishable, result.idempotencyKey], [approved.id, approved.version, approved.rulesHash, 'USER_ENTERED', false, key])
    assert.equal(result.inputHash, result.result.inputHash)
    assert.equal(result.rulesHash, result.result.ruleHash)
    for (const hidden of ['rulesJson', 'requestHash', 'inputJson', 'resultJson']) assert.ok(!(hidden in result), hidden)
    assert.equal((await calculate(key, approved.id)).calculation.id, result.id)
    await rejects(calculate(key, approved.id, { input: { ...input(), quantity: 200 } }), { status: 409, code: 'PRICING_CALCULATION_IDEMPOTENCY_CONFLICT' })
    const next = await draft({ name: 'New generation', sourceRuleSetId: approved.id })
    await at(later(1), () => approve(next))
    await at(later(2), () => rejects(calculate(idem('superseded-explicit'), approved.id), { status: 409, code: 'PRICING_RULE_NOT_ACTIVE' }))
    const stored = await h.store.read((sql) => sql.get('SELECT * FROM PricingCalculation WHERE id = ?', result.id))
    assert.equal(stored.ruleVersion, approved.version)
    assert.deepEqual(JSON.parse(stored.resultJson), p.result)
    assert.equal((await audits(result.id)).filter((e) => e.action === 'PRICING_CALCULATED').length, 1)
  })

  test('rejects caller approval/provenance claims and malformed formulas without persisting', async () => {
    await assert.rejects(draft({ status: 'APPROVED' }))
    const row = await approve(await draft())
    await assert.rejects(calculate(idem('spoof-source'), row.id, { inputProvenance: 'VERIFIED', publishable: true }))
    await rejects(calculate(idem('spoof-input'), row.id, { input: { ...input(), approved: true } }), { status: 422 })
    const bad = await rejects(draft({ rules: { invalid: true } }), { status: 422 })
    assert.ok(Array.isArray(bad.details) && bad.details.length)
    assert.equal(await h.count('PricingCalculation'), 0)
    assert.equal(await h.count('PricingRuleSet'), 1)
  })

  test('does not activate future policy early, expire late or fall back after latest-policy revocation', async () => {
    const previous = await approve(await draft(), { effectiveFrom: later(10).toISOString() })
    const next = await approve(await draft(), { effectiveFrom: later(20).toISOString(), expiresAt: later(30).toISOString() })
    await rejects(calculate(idem('future-policy'), next.id), { status: 409, code: 'PRICING_RULE_NOT_ACTIVE' })
    assert.equal((await at(later(15), () => active())).id, previous.id)
    assert.equal((await at(later(25), () => active())).id, next.id)
    await at(later(30), () => rejects(calculate(idem('expired-policy'), next.id), { status: 409 }))
    await at(later(31), () => rejects(active(), { status: 409, code: 'PRICING_RULE_NOT_ACTIVE' }))
    const key = idem('before-revoke')
    const { calculation: immutable } = await at(later(25), () => calculate(key, next.id))
    const revoked = await at(later(26), () => revoke(next))
    assert.deepEqual([revoked.status, revoked.rulesHash, revoked.isActive], ['REVOKED', next.rulesHash, false])
    await at(later(27), () => rejects(calculate(key, next.id), { status: 409, code: 'PRICING_RULE_NOT_ACTIVE' }))
    await at(later(27), () => rejects(active(), { status: 409 }))
    const listed = await at(later(27), () => list())
    assert.ok(!listed.rules.some((row) => row.isActive))
    const stored = await h.store.read((sql) => sql.get('SELECT resultJson FROM PricingCalculation WHERE id = ?', immutable.id))
    assert.deepEqual(JSON.parse(stored.resultJson), immutable.result)
  })

  test('rejects invalid activation windows and missing policy rather than defaulting to template rates', async () => {
    const row = await draft()
    await rejects(approve(row, { effectiveFrom: later(-1).toISOString() }), { status: 422, code: 'PRICING_RULE_EFFECTIVE_DATE_IN_PAST' })
    await rejects(approve(row, { effectiveFrom: later(1).toISOString(), expiresAt: later(1).toISOString() }), { status: 422, code: 'PRICING_RULE_EXPIRY_BEFORE_EFFECTIVE_DATE' })
    await rejects(active('foreignOwner', OTHER_BIZ), { status: 409, code: 'PRICING_RULE_NOT_ACTIVE' })
    const listed = await list()
    assert.equal(listed.canManage, true)
    assert.deepEqual(listed.template, defaultPricingRules())
  })
})

describe('SCM additions', () => {
  test('revoke needs APPROVED and takes no dates; an offset date is stored as UTC', async () => {
    const row = await draft()
    await rejects(revoke(row), { status: 409, code: 'PRICING_RULE_NOT_APPROVED' })
    const approved = await approve(row, { effectiveFrom: '2026-09-17T08:00:00+07:00', expiresAt: null })
    assert.equal(approved.effectiveFrom, '2026-09-17T01:00:00.000Z')
    await rejects(revoke(approved, { expiresAt: null }), { status: 422, code: 'PRICING_RULE_REVOKE_DATES_NOT_ALLOWED' })
    const revoked = await revoke(approved)
    assert.deepEqual([revoked.status, revoked.revokedByPersonId, revoked.revocationReason, revoked.version], ['REVOKED', 'per-owner', 'Withdraw fixture', 3])
    // Legacy order: the version is checked before the status.
    await rejects(revoke(approved), { status: 409, code: 'PRICING_RULE_VERSION_CONFLICT' })
    await rejects(revoke(revoked), { status: 409, code: 'PRICING_RULE_NOT_APPROVED' })
  })

  test('a calculation key is bound to the NORMALIZED request and shared by the owners of a Business', async () => {
    const approved = await approve(await draft())
    const key = idem('shared-key')
    const first = await calculate(key, null, { input: { ...input(), landedUnitCostThb: '123.45' } })
    // Same request, different spelling: the same snapshot (legacy requestHash).
    const respelled = await calculate(key, null, { input: { ...input(), landedUnitCostThb: '123.450' } })
    assert.deepEqual([respelled.replayed, respelled.calculation.id], [true, first.calculation.id])
    // A second owner re-using the key gets the same snapshot (keys are per Business).
    const other = await calculate(key, null, {}, 'owner2')
    assert.deepEqual([other.calculation.id, other.calculation.createdByPersonId], [first.calculation.id, 'per-owner'])
    await rejects(calculate(key, null, { input: { ...input(), quantity: 200 } }, 'owner2'), { status: 409, code: 'PRICING_CALCULATION_IDEMPOTENCY_CONFLICT' })
    await rejects(calculate(key, approved.id), { status: 409, code: 'PRICING_CALCULATION_IDEMPOTENCY_CONFLICT' })
    assert.equal(await h.count('PricingCalculation'), 1)
  })

  test('an outcome lookup is owner-only and never re-offers a withdrawn price', async () => {
    const approved = await approve(await draft())
    const key = idem('lookup')
    const { calculation } = await calculate(key, approved.id)
    const found = await h.bus.lookup(as('owner'), { action: 'commerce.pricing.calculate', businessId: BIZ, idempotencyKey: key })
    assert.equal(found.response.calculation.id, calculation.id)
    await rejects(h.bus.lookup(as('member'), { action: 'commerce.pricing.calculate', businessId: BIZ, idempotencyKey: key }), { status: 404 })
    await revoke(approved)
    await rejects(h.bus.lookup(as('owner'), { action: 'commerce.pricing.calculate', businessId: BIZ, idempotencyKey: key }), { status: 409, code: 'PRICING_RULE_NOT_ACTIVE' })
  })

  test('the store itself refuses to rewrite an approved policy or any calculation', async () => {
    const approved = await approve(await draft())
    const { calculation } = await calculate(idem('immutable'), approved.id)
    const open = await draft()
    await h.store.transaction((sql) => sql.run('UPDATE PricingRuleSet SET name = ? WHERE id = ?', 'a draft stays editable', open.id))
    for (const [statement, args] of [
      ['UPDATE PricingRuleSet SET rulesJson = ? WHERE id = ?', ['{}', approved.id]],
      ['UPDATE PricingRuleSet SET rulesHash = ? WHERE id = ?', ['x', approved.id]],
      ['DELETE FROM PricingRuleSet WHERE id = ?', [approved.id]],
      ['UPDATE PricingCalculation SET resultJson = ? WHERE id = ?', ['{}', calculation.id]],
      ['DELETE FROM PricingCalculation WHERE id = ?', [calculation.id]],
    ]) {
      await assert.rejects(h.store.transaction((sql) => sql.run(statement, ...args)), /PRICING_(RULE|CALCULATION)_IMMUTABLE/, statement)
    }
    // Status transitions of an approved row stay possible (revocation).
    assert.equal((await revoke(approved)).status, 'REVOKED')
  })

  test('a calculation that fails after its audit leaves nothing behind; the key is then free', async () => {
    await h.close()
    let fail = true
    h = createHarness({ clock: () => clock, faults: { 'commerce.pricing.calculate': { afterAudit: () => { if (fail) throw new Error('crash after audit') } } } })
    const approved = await approve(await draft())
    const before = await h.snapshot()
    const key = idem('crash')
    await assert.rejects(calculate(key, approved.id), /crash after audit/)
    assert.deepEqual(await h.snapshot(), before)
    assert.equal(await h.count('PricingCalculation'), 0)
    fail = false
    const retried = await calculate(key, approved.id)
    assert.equal(retried.replayed, false)
    assert.equal(await h.count('PricingCalculation'), 1)
  })
})
