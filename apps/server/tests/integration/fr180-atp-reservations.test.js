// @req FR-180 — Available-to-Promise and the two-tier reservation against a
//   real database: a quote hold that expires on the clock rather than on a
//   worker, the refusal to promise the same stock twice, conversion into a
//   committed hold with no gap in between, the buildable count computed from
//   ATP, and the fact that no reservation ever touches the stock ledger.
// @spec ADR-074 D8; BR-031; SEC-001; FR-072
// @tested tests/integration/fr180-atp-reservations.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { createCategory, createProduct, createProductMaster, setFlowAccountSku } from '@/modules/inventory/application/inventory-catalog-service'
import { recordMovement } from '@/modules/inventory/application/inventory-stock-service'
import { createRecipe } from '@/modules/inventory/application/inventory-recipe-service'
import {
  applyReservationAction,
  availableToPromiseFor,
  createReservation,
  expireDueReservations,
  listReservations,
  maxBuildableSets,
} from '@/modules/inventory/application/inventory-atp-service'

const DOMAINS = ['projects', 'platform', 'inventory']
const DAY = 86400000
const NOW = new Date(Date.UTC(2026, 8, 10))
const later = (days) => new Date(NOW.getTime() + days * DAY)

let business, owner, member, master, tumbler, powerbank, service, giftSet, recipe
let quoteHold
const b = () => business.id
const ledgerRows = () => prisma.stockMovement.count({ where: { businessId: b() } })

describe('FR-180 Available-to-Promise and reservations', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-ATP', name: 'ATP Group' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-ATP', name: 'ATP Tenant' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-ATP', name: 'Quoting business' })
    owner = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [b()], visibleDomains: DOMAINS })
    member = makeViewer({ visibleBusinessIds: [b()], ownedBusinessIds: [], visibleDomains: DOMAINS })

    const category = await createCategory({ businessId: b(), code: 'giftset', nameTh: 'ชุด', nameEn: 'Set' }, { viewer: owner })
    master = await createProductMaster({ businessId: b(), code: 'PM-SET', categoryId: category.id, nameTh: 'ชุด', nameEn: 'Set' }, { viewer: owner })
    // @req FR-201 — a service is never a variant of a good (ADR-083 D1): the
    // design service lives under its own SERVICE master, not under the gift set.
    const serviceMaster = await createProductMaster({ businessId: b(), code: 'PM-DESIGN', categoryId: category.id, nameTh: 'ออกแบบ', nameEn: 'Design', nature: 'SERVICE' }, { viewer: owner })
    const sku = (code, over = {}) => createProduct({ businessId: b(), code, productMasterId: master.id, name: code, ...over }, { viewer: owner })

    tumbler = await sku('COMP-TUMBLER')
    powerbank = await sku('COMP-PB')
    service = await sku('SVC-DESIGN', { productMasterId: serviceMaster.id })
    expect(service.stockPolicy).toBe('SERVICE')
    giftSet = await sku('SET-TMS06-4-P16', { itemKind: 'FINISHED_SET' })
    await setFlowAccountSku({ businessId: b(), productId: giftSet.id, flowAccountSku: 'TMS06-4(P-16)' }, { viewer: owner })

    await recordMovement({ businessId: b(), productId: tumbler.id, kind: 'RECEIPT', quantity: 1200, occurredAt: NOW }, { viewer: owner })
    await recordMovement({ businessId: b(), productId: powerbank.id, kind: 'RECEIPT', quantity: 800, occurredAt: NOW }, { viewer: owner })

    recipe = await createRecipe({
      businessId: b(), code: 'RCP-SET-100', productId: giftSet.id, name: 'Set × 100', batchSize: 100,
      lines: [{ componentProductId: tumbler.id, qty: 100 }, { componentProductId: powerbank.id, qty: 100 }],
    }, { viewer: owner })
  })

  it('AC-180.1 — a quote holds stock for seven days and ATP drops by exactly what it holds, without a single ledger row', async () => {
    const rowsBefore = await ledgerRows()
    quoteHold = await createReservation({
      businessId: b(), productId: tumbler.id, quantity: 500,
      customerCompany: 'PTT PLC', quoteReference: 'QT-2026-0912', contactHandle: 'คุณสมชาย / 08x-xxx-xxxx',
    }, { viewer: owner, now: NOW })

    expect(quoteHold).toMatchObject({ purpose: 'QUOTE', quantity: 500, status: 'ACTIVE' })
    expect(quoteHold.code).toMatch(/^RSV-\d{8}-\d{3}$/)
    expect(quoteHold.expiresAt.toISOString()).toBe(later(7).toISOString())

    const atp = await availableToPromiseFor({ businessId: b(), productIds: [tumbler.id], viewer: member, now: NOW })
    expect(atp.products[0]).toMatchObject({ onHand: 1200, committed: 0, reservedForQuotes: 500, available: 700 })
    // BR-031 — a promise is not a physical fact: nothing was written to the ledger.
    expect(await ledgerRows()).toBe(rowsBefore)
  })

  it('AC-180.2 — the same stock cannot be promised twice, and an uncounted product cannot be promised at all', async () => {
    await expect(createReservation({ businessId: b(), productId: tumbler.id, quantity: 800 }, { viewer: owner, now: NOW }))
      .rejects.toMatchObject({ status: 409, message: 'STOCK_RESERVATION_INSUFFICIENT_ATP' })
    // 700 is exactly what is left, so it goes through.
    const second = await createReservation({ businessId: b(), productId: tumbler.id, quantity: 700 }, { viewer: owner, now: NOW })
    expect(second.quantity).toBe(700)
    await applyReservationAction(second.id, { businessId: b(), action: 'RELEASE', version: second.version }, { viewer: owner, now: NOW })

    await expect(createReservation({ businessId: b(), productId: service.id, quantity: 1 }, { viewer: owner, now: NOW }))
      .rejects.toMatchObject({ status: 422, message: 'INVENTORY_PRODUCT_UNTRACKED' })
    await expect(createReservation({ businessId: b(), productId: tumbler.id, quantity: 1 }, { viewer: member, now: NOW }))
      .rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(createReservation({ businessId: b(), productId: tumbler.id, quantity: 1, purpose: 'ORDER' }, { viewer: owner, now: NOW }))
      .rejects.toMatchObject({ status: 422, message: 'STOCK_RESERVATION_ORDER_REQUIRES_SALES_ORDER' })
  })

  it('AC-180.3 — a hold whose clock ran out is already spent, whether or not a sweeper has run', async () => {
    const afterExpiry = later(8)
    const atp = await availableToPromiseFor({ businessId: b(), productIds: [tumbler.id], viewer: member, now: afterExpiry })
    expect(atp.products[0]).toMatchObject({ reservedForQuotes: 0, available: 1200 })
    // The row is still ACTIVE in the database — and already ignored by every reader.
    expect((await prisma.stockReservation.findUnique({ where: { id: quoteHold.id } })).status).toBe('ACTIVE')

    const swept = await expireDueReservations({ businessId: b(), viewer: owner, now: afterExpiry })
    expect(swept.expired).toBe(1)
    expect((await prisma.stockReservation.findUnique({ where: { id: quoteHold.id } })).status).toBe('EXPIRED')
    // Sweeping changed no number, which is exactly why it is safe to skip.
    const after = await availableToPromiseFor({ businessId: b(), productIds: [tumbler.id], viewer: member, now: afterExpiry })
    expect(after.products[0].available).toBe(1200)
  })

  it('AC-180.4 — converting a quote hold commits it with no moment in between where the stock is free', async () => {
    const hold = await createReservation({ businessId: b(), productId: powerbank.id, quantity: 300, quoteReference: 'QT-2026-0913' }, { viewer: owner, now: NOW })
    const converted = await applyReservationAction(hold.id, { businessId: b(), action: 'CONVERT', version: hold.version, salesOrderId: 'so-ptt-9' }, { viewer: owner, now: NOW })

    expect(converted.released).toMatchObject({ status: 'CONVERTED', purpose: 'QUOTE' })
    expect(converted.committed).toMatchObject({ status: 'ACTIVE', purpose: 'ORDER', quantity: 300, salesOrderId: 'so-ptt-9', expiresAt: null })

    const atp = await availableToPromiseFor({ businessId: b(), productIds: [powerbank.id], viewer: member, now: NOW })
    expect(atp.products[0]).toMatchObject({ committed: 300, reservedForQuotes: 0, available: 500 })
    // A committed hold does not expire with time the way a quote does.
    const muchLater = await availableToPromiseFor({ businessId: b(), productIds: [powerbank.id], viewer: member, now: later(90) })
    expect(muchLater.products[0].committed).toBe(300)

    await expect(applyReservationAction(converted.committed.id, { businessId: b(), action: 'CONVERT', version: converted.committed.version, salesOrderId: 'so-x' }, { viewer: owner, now: NOW }))
      .rejects.toMatchObject({ status: 409, message: 'STOCK_RESERVATION_ALREADY_COMMITTED' })
    await expect(applyReservationAction(hold.id, { businessId: b(), action: 'RELEASE', version: 99 }, { viewer: owner, now: NOW }))
      .rejects.toMatchObject({ status: 409, message: 'STOCK_RESERVATION_VERSION_CONFLICT' })
  })

  it('AC-180.5 — a reservation is never deleted, so a past refusal to promise stays explicable', async () => {
    const rows = await listReservations({ businessId: b(), viewer: member, now: later(90) })
    expect(rows.map((r) => r.status).sort()).toEqual(['ACTIVE', 'CONVERTED', 'EXPIRED', 'RELEASED'])
    // `live` is computed on read, never stored: the committed hold is the only
    // one still holding anything ninety days on.
    expect(rows.filter((r) => r.live).map((r) => r.purpose)).toEqual(['ORDER'])
  })

  it('AC-180.6 — the buildable set count comes from ATP, so two quotes cannot promise the same components', async () => {
    const free = await maxBuildableSets({ businessId: b(), recipeId: recipe.id, quantity: 500, viewer: member, now: later(90) })
    // 1,200 tumblers and 500 free power banks (300 are committed) → 500 sets.
    expect(free).toMatchObject({ maxBuildable: 500, canPromise: true })

    const hold = await createReservation({ businessId: b(), productId: tumbler.id, quantity: 900, quoteReference: 'QT-2026-0914' }, { viewer: owner, now: later(90) })
    const squeezed = await maxBuildableSets({ businessId: b(), recipeId: recipe.id, quantity: 500, viewer: member, now: later(90) })
    expect(squeezed).toMatchObject({ maxBuildable: 300, canPromise: false })
    expect(squeezed.lines.find((l) => l.code === 'COMP-TUMBLER')).toMatchObject({ required: 500, available: 300, shortage: 200 })

    await applyReservationAction(hold.id, { businessId: b(), action: 'RELEASE', version: hold.version }, { viewer: owner, now: later(90) })
    expect((await maxBuildableSets({ businessId: b(), recipeId: recipe.id, quantity: 500, viewer: member, now: later(90) })).maxBuildable).toBe(500)
  })
})
