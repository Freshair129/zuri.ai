// POS terminal catalogue (FR-183) through the real SCM query, store and
// ReferenceAuthority: the two domain gates, the Branch owner as a fact source
// (asked only after authorization, refused retryably when unavailable), and the
// catalogue following the ledger as sales happen. Field-level parity with
// legacy is test/unit/pos-catalogue-parity.test.js.
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, rejects } from '../support/harness.js'
import { BIZ, LOCATIONS, PRODUCTS, REFERENCE_FIXTURE, ROLES, idem } from '../support/fixtures.js'
import { createFixtureReferenceAuthority, createUnavailableReferenceAuthority } from '../../src/infrastructure/reference-authority.js'

let h
afterEach(() => h?.close())
const G = {
  cashier: { [BIZ]: ROLES.cashier },
  viewer: { [BIZ]: ROLES.commerceViewer },
  noInventory: { [BIZ]: { owner: true, domains: ['commerce'], permissions: [] } },
  noCommerce: { [BIZ]: { owner: true, domains: ['inventory', 'procurement'], permissions: [] } },
}
const seed = { locations: [LOCATIONS.shop, LOCATIONS.virtual, LOCATIONS.foreign], stock: [{ productId: PRODUCTS.plain.id, quantity: 3 }] }
const make = (references) => createHarness({ products: [PRODUCTS.plain, PRODUCTS.untracked, PRODUCTS.archived, PRODUCTS.otherBiz], seed, references })

describe('POS terminal catalogue', () => {
  test('commerce + inventory domains required; every refusal is 404 and asks the Branch owner nothing', async () => {
    const asked = []
    const fixture = createFixtureReferenceAuthority(REFERENCE_FIXTURE)
    h = make({ ...fixture, branches: async (scope, q) => { asked.push(q.businessId); return fixture.branches(scope, q) } })
    for (const who of ['noInventory', 'noCommerce']) await rejects(h.bus.queries.posCatalogue(h.as({ sub: who, grants: G[who] }), { businessId: BIZ }), { status: 404 })
    await rejects(h.bus.queries.posCatalogue(h.as({ sub: 'x', grants: G.cashier }), { businessId: 'biz-unknown' }), { status: 404 })
    await assert.rejects(h.bus.queries.posCatalogue(h.as({ sub: 'x', grants: G.cashier }), { businessId: '' }))
    assert.deepEqual(asked, [])
    const view = await h.bus.queries.posCatalogue(h.as({ sub: 'v', grants: G.viewer }), { businessId: BIZ })
    assert.deepEqual(asked, [BIZ])
    assert.deepEqual(view.branches.map((b) => b.code), ['BR-MAIN'])
    assert.deepEqual(view.warehouseLocations.map((l) => [l.code, l.isVirtual]), [['LOC-SHOP', false]])
    assert.deepEqual(view.items.map((i) => [i.code, i.onHand, i.isAvailable, i.unitPrice]), [['SYN-PLAIN', 3, true, null], ['SYN-UNTRACKED', null, true, null]])
  })

  test('an unavailable Branch owner refuses the catalogue retryably instead of serving it without sites', async () => {
    h = make(createUnavailableReferenceAuthority())
    await rejects(h.bus.queries.posCatalogue(h.as({ sub: 'c', grants: G.cashier }), { businessId: BIZ }), { status: 503, code: 'SCM_REFERENCE_AUTHORITY_UNAVAILABLE' })
  })

  test('on-hand follows the ledger: selling the last units through POS makes the SKU unavailable', async () => {
    h = make(createFixtureReferenceAuthority(REFERENCE_FIXTURE))
    const cashier = h.as({ sub: 'per-cashier', grants: G.cashier })
    const before = await h.bus.queries.posCatalogue(cashier, { businessId: BIZ })
    assert.deepEqual(before.items.find((i) => i.productId === PRODUCTS.plain.id), { productId: PRODUCTS.plain.id, code: 'SYN-PLAIN', name: 'SYN-PLAIN', unit: 'EA', stockPolicy: 'TRACKED', trackingMode: 'NONE', onHand: 3, isAvailable: true, categoryId: null, categoryName: null, unitPrice: null })
    await h.run(cashier, 'commerce.pos.checkout', { idempotencyKey: idem('pos'), body: { businessId: BIZ, branchId: 'branch-main', warehouseLocationId: LOCATIONS.shop.id, lines: [{ productId: PRODUCTS.plain.id, qty: 3, unitPrice: 50 }], payment: { method: 'CASH', receivedAmount: 150 } } })
    const after = await h.bus.queries.posCatalogue(cashier, { businessId: BIZ })
    assert.deepEqual(after.items.find((i) => i.productId === PRODUCTS.plain.id).onHand, 0)
    assert.equal(after.items.find((i) => i.productId === PRODUCTS.plain.id).isAvailable, false)
  })
})
