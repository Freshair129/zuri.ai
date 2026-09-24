// Available-to-Promise and reservations (FR-180) through the real SCM commands,
// queries and ledger. [legacy] tests mirror apps/server
// fr180-atp-reservations.test.js with the same inputs and expectations; the
// legacy `now` injection is the harness clock.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, rejects } from '../support/harness.js'
import { BIZ, idem } from '../support/fixtures.js'
import { appendMovement } from '../../src/modules/inventory/index.js'

const G = {
  owner: { [BIZ]: { owner: true, domains: ['inventory'], permissions: [] } },
  member: { [BIZ]: { owner: false, domains: ['inventory'], permissions: [] } },
}
const DAY = 86400000
const NOW = new Date(Date.UTC(2026, 8, 10))
const later = (days) => new Date(NOW.getTime() + days * DAY)
let clockNow = NOW
let h
let tumbler, powerbank, service, recipe, quoteHold
before(async () => {
  h = createHarness({ products: [], clock: () => clockNow })
  const category = (await run('owner', 'inventory.category.create', { businessId: BIZ, code: 'giftset', nameTh: 'ชุด', nameEn: 'Set' })).category
  const master = (await run('owner', 'inventory.product-master.create', { businessId: BIZ, code: 'PM-SET', categoryId: category.id, nameTh: 'ชุด', nameEn: 'Set' })).master
  const serviceMaster = (await run('owner', 'inventory.product-master.create', { businessId: BIZ, code: 'PM-DESIGN', categoryId: category.id, nameTh: 'ออกแบบ', nameEn: 'Design', nature: 'SERVICE' })).master
  const sku = (code, over = {}) => run('owner', 'inventory.product.create', { businessId: BIZ, code, productMasterId: master.id, name: code, ...over }).then((r) => r.product)
  tumbler = await sku('COMP-TUMBLER')
  powerbank = await sku('COMP-PB')
  service = (await run('owner', 'inventory.product.create', { businessId: BIZ, code: 'SVC-DESIGN', productMasterId: serviceMaster.id, name: 'SVC-DESIGN' })).product
  assert.equal(service.stockPolicy, 'SERVICE')
  const giftSet = await sku('SET-TMS06-4-P16', { itemKind: 'FINISHED_SET' })
  await run('owner', 'inventory.product.flowaccount-sku', { businessId: BIZ, flowAccountSku: 'TMS06-4(P-16)' }, giftSet.id)
  const receive = (productId, quantity) => h.store.transaction((sql) => appendMovement(sql, as('owner'), { businessId: BIZ, productId, kind: 'RECEIPT', quantity, occurredAt: NOW.toISOString() }, { now: NOW.toISOString() }))
  await receive(tumbler.id, 1200)
  await receive(powerbank.id, 800)
  recipe = (await run('owner', 'inventory.recipe.create', { businessId: BIZ, code: 'RCP-SET-100', productId: giftSet.id, name: 'Set × 100', batchSize: 100, lines: [{ componentProductId: tumbler.id, qty: 100 }, { componentProductId: powerbank.id, qty: 100 }] })).recipe
})
after(() => h.close())
function as(who) { return h.as({ sub: `per-${who}`, grants: G[who] }) }
function run(who, action, body, targetId = null) { return h.run(as(who), action, { body, targetId, idempotencyKey: idem(action) }) }
const reserve = (body, who = 'owner') => run(who, 'inventory.reservation.create', { businessId: BIZ, ...body }).then((r) => r.reservation)
const act = (id, body, who = 'owner') => run(who, 'inventory.reservation.action', { businessId: BIZ, ...body }, id)
const atp = (query, who = 'member') => h.bus.queries.atp(as(who), { businessId: BIZ, ...query })
const ledgerRows = () => h.store.read((sql) => Number(sql.get('SELECT COUNT(*) AS n FROM StockMovement WHERE businessId = ?', BIZ).n))
const statusOf = (id) => h.store.read((sql) => sql.get('SELECT status FROM StockReservation WHERE id = ?', id).status)

describe('[legacy] FR-180 Available-to-Promise and reservations', () => {
  test('AC-180.1 — a quote holds stock for seven days and ATP drops by exactly what it holds, without a single ledger row', async () => {
    clockNow = NOW
    const rowsBefore = await ledgerRows()
    quoteHold = await reserve({ productId: tumbler.id, quantity: 500, customerCompany: 'PTT PLC', quoteReference: 'QT-2026-0912', contactHandle: 'คุณสมชาย / 08x-xxx-xxxx' })
    assert.deepEqual([quoteHold.purpose, quoteHold.quantity, quoteHold.status], ['QUOTE', 500, 'ACTIVE'])
    assert.match(quoteHold.code, /^RSV-\d{8}-\d{3}$/)
    assert.equal(quoteHold.expiresAt, later(7).toISOString())
    const view = await atp({ productIds: [tumbler.id] })
    const row = view.products[0]
    assert.deepEqual([row.onHand, row.committed, row.reservedForQuotes, row.available], [1200, 0, 500, 700])
    assert.equal(await ledgerRows(), rowsBefore)
  })

  test('AC-180.2 — the same stock cannot be promised twice, and an uncounted product cannot be promised at all', async () => {
    const tooMuch = await rejects(reserve({ productId: tumbler.id, quantity: 800 }), { status: 409, code: 'STOCK_RESERVATION_INSUFFICIENT_ATP' })
    assert.deepEqual([tooMuch.details.requested, tooMuch.details.available], [800, 700])
    const second = await reserve({ productId: tumbler.id, quantity: 700 })
    assert.equal(second.quantity, 700)
    await act(second.id, { action: 'RELEASE', version: second.version })
    await rejects(reserve({ productId: service.id, quantity: 1 }), { status: 422, code: 'INVENTORY_PRODUCT_UNTRACKED' })
    await rejects(reserve({ productId: tumbler.id, quantity: 1 }, 'member'), { status: 404 })
    await rejects(reserve({ productId: tumbler.id, quantity: 1, purpose: 'ORDER' }), { status: 422, code: 'STOCK_RESERVATION_ORDER_REQUIRES_SALES_ORDER' })
  })

  test('AC-180.3 — a hold whose clock ran out is already spent, whether or not a sweeper has run', async () => {
    clockNow = later(8)
    const row = (await atp({ productIds: [tumbler.id] })).products[0]
    assert.deepEqual([row.reservedForQuotes, row.available], [0, 1200])
    assert.equal(await statusOf(quoteHold.id), 'ACTIVE')
    const swept = await run('owner', 'inventory.reservation.expire', { businessId: BIZ })
    assert.equal(swept.expired, 1)
    assert.equal(await statusOf(quoteHold.id), 'EXPIRED')
    assert.equal((await atp({ productIds: [tumbler.id] })).products[0].available, 1200)
  })

  test('AC-180.4 — converting a quote hold commits it with no moment in between where the stock is free', async () => {
    clockNow = NOW
    const hold = await reserve({ productId: powerbank.id, quantity: 300, quoteReference: 'QT-2026-0913' })
    const converted = await act(hold.id, { action: 'CONVERT', version: hold.version, salesOrderId: 'so-ptt-9' })
    assert.deepEqual([converted.released.status, converted.released.purpose], ['CONVERTED', 'QUOTE'])
    const c = converted.committed
    assert.deepEqual([c.status, c.purpose, c.quantity, c.salesOrderId, c.expiresAt], ['ACTIVE', 'ORDER', 300, 'so-ptt-9', null])
    const row = (await atp({ productIds: [powerbank.id] })).products[0]
    assert.deepEqual([row.committed, row.reservedForQuotes, row.available], [300, 0, 500])
    clockNow = later(90)
    assert.equal((await atp({ productIds: [powerbank.id] })).products[0].committed, 300)
    clockNow = NOW
    await rejects(act(c.id, { action: 'CONVERT', version: c.version, salesOrderId: 'so-x' }), { status: 409, code: 'STOCK_RESERVATION_ALREADY_COMMITTED' })
    await rejects(act(hold.id, { action: 'RELEASE', version: 99 }), { status: 409, code: 'STOCK_RESERVATION_VERSION_CONFLICT' })
  })

  test('AC-180.5 — a reservation is never deleted, so a past refusal to promise stays explicable', async () => {
    clockNow = later(90)
    const { reservations } = await h.bus.queries.reservations(as('member'), { businessId: BIZ })
    assert.deepEqual(reservations.map((r) => r.status).sort(), ['ACTIVE', 'CONVERTED', 'EXPIRED', 'RELEASED'])
    assert.deepEqual(reservations.filter((r) => r.live).map((r) => r.purpose), ['ORDER'])
  })

  test('AC-180.6 — the buildable set count comes from ATP, so two quotes cannot promise the same components', async () => {
    clockNow = later(90)
    const free = await atp({ recipeId: recipe.id, quantity: 500 })
    assert.deepEqual([free.maxBuildable, free.canPromise], [500, true])
    const hold = await reserve({ productId: tumbler.id, quantity: 900, quoteReference: 'QT-2026-0914' })
    const squeezed = await atp({ recipeId: recipe.id, quantity: 500 })
    assert.deepEqual([squeezed.maxBuildable, squeezed.canPromise], [300, false])
    const line = squeezed.lines.find((l) => l.code === 'COMP-TUMBLER')
    assert.deepEqual([line.required, line.available, line.shortage], [500, 300, 200])
    await act(hold.id, { action: 'RELEASE', version: hold.version })
    assert.equal((await atp({ recipeId: recipe.id, quantity: 500 })).maxBuildable, 500)
  })
})

describe('FR-180 over the SCM command bus', () => {
  test('a released hold cannot be released again, a replayed key does not place a second hold, and an unknown recipe is 404', async () => {
    clockNow = NOW
    const key = idem('rsv-replay')
    const body = { businessId: BIZ, productId: powerbank.id, quantity: 5 }
    const first = await h.bus.run(as('owner'), 'inventory.reservation.create', { idempotencyKey: key, body })
    const again = await h.bus.run(as('owner'), 'inventory.reservation.create', { idempotencyKey: key, body })
    assert.deepEqual([again.replayed, again.reservation.id], [true, first.reservation.id])
    await act(first.reservation.id, { action: 'RELEASE', version: 1 })
    await rejects(act(first.reservation.id, { action: 'RELEASE', version: 2 }), { status: 409, code: 'STOCK_RESERVATION_NOT_ACTIVE' })
    await rejects(atp({ recipeId: 'no-such-recipe' }), { status: 404 })
  })
})
