// @req FR-180 — Available-to-Promise and the two-tier reservation against a
//   real database: a quote hold that expires on the clock rather than on a
//   worker, the refusal to promise the same stock twice, conversion into a
//   committed hold with no gap in between, the buildable count computed from
//   ATP, and the fact that no reservation ever touches the stock ledger.
// @spec ADR-074 D8; BR-031; SEC-001; FR-072
// @tested tests/integration/fr180-atp-reservations.test.js
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
let movementDb, releaseDb
const b = () => business.id
const ledgerRows = () => prisma.stockMovement.count({ where: { businessId: b() } })

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

async function independentTestClient() {
  // tests/setup.js replaces DATABASE_URL with this run's disposable target.
  // Select the matching generated client and refuse any unrecognized URL.
  const url = process.env.DATABASE_URL
  if (/^(postgres|postgresql):/i.test(url ?? '')) {
    const { PrismaClient } = await import('@zuri/prisma-postgres')
    return new PrismaClient({ datasources: { db: { url } } })
  }
  if (/^file:/i.test(url ?? '')) {
    const { PrismaClient } = await import('@prisma/client')
    return new PrismaClient({ datasources: { db: { url } } })
  }
  throw new Error('FR180_TEST_DATABASE_URL_NOT_ISOLATED')
}

function instrumentDb(db, hooks = {}) {
  const wrapDelegate = (delegate, model) => new Proxy(delegate, {
    get(target, operation) {
      const method = Reflect.get(target, operation, target)
      if (typeof method !== 'function') return method
      if (model === 'inventoryLedgerFence' && operation === 'upsert') {
        return async (...args) => {
          hooks.beforeFenceAttempt?.()
          await hooks.beforeFenceAcquire?.()
          const result = await method.apply(target, args)
          hooks.afterFenceAcquire?.()
          return result
        }
      }
      if (model === 'product' && operation === 'findMany' && hooks.onHandRead) {
        return async (...args) => {
          const result = await method.apply(target, args)
          return args[0]?.select?.movements ? hooks.onHandRead(result) : result
        }
      }
      if (model === 'stockReservation' && operation === 'findMany' && hooks.beforeReservationsRead) {
        return async (...args) => {
          await hooks.beforeReservationsRead()
          return method.apply(target, args)
        }
      }
      return method.bind(target)
    },
  })

  return new Proxy(db, {
    get(target, property) {
      if (property === '$transaction') {
        const transaction = Reflect.get(target, property, target)
        if (typeof transaction !== 'function') return transaction
        return (callback, ...args) => {
          hooks.beforeTransactionStart?.()
          return typeof callback === 'function'
            ? transaction.call(target, (tx) => callback(instrumentDb(tx, hooks)), ...args)
            : transaction.call(target, callback, ...args)
        }
      }
      if (property === 'inventoryLedgerFence' || property === 'product' || property === 'stockReservation') {
        return wrapDelegate(Reflect.get(target, property, target), property)
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

describe('FR-180 Available-to-Promise and reservations', () => {
  beforeAll(async () => {
    movementDb = await independentTestClient()
    releaseDb = await independentTestClient()
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

  afterAll(async () => {
    await Promise.all([movementDb?.$disconnect(), releaseDb?.$disconnect()])
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

    let fenceAttempts = 0
    const swept = await expireDueReservations({
      businessId: b(), viewer: owner, db: instrumentDb(prisma, { beforeFenceAttempt: () => { fenceAttempts += 1 } }), now: afterExpiry,
    })
    expect(fenceAttempts).toBe(1)
    expect(swept.expired).toBe(1)
    expect((await prisma.stockReservation.findUnique({ where: { id: quoteHold.id } })).status).toBe('EXPIRED')
    // Sweeping changed no number, which is exactly why it is safe to skip.
    const after = await availableToPromiseFor({ businessId: b(), productIds: [tumbler.id], viewer: member, now: afterExpiry })
    expect(after.products[0].available).toBe(1200)
  })

  it('AC-180.4 — converting a quote hold commits it with no moment in between where the stock is free', async () => {
    const hold = await createReservation({ businessId: b(), productId: powerbank.id, quantity: 300, quoteReference: 'QT-2026-0913' }, { viewer: owner, now: NOW })
    let fenceAttempts = 0
    const converted = await applyReservationAction(hold.id, { businessId: b(), action: 'CONVERT', version: hold.version, salesOrderId: 'so-ptt-9' }, {
      viewer: owner, db: instrumentDb(prisma, { beforeFenceAttempt: () => { fenceAttempts += 1 } }), now: NOW,
    })
    expect(fenceAttempts).toBe(1)

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

  it('returns one fenced ATP aggregate while a movement and reservation release race the read', async () => {
    const raceProduct = await createProduct({ businessId: b(), code: 'ATP-CONSISTENCY-RACE', productMasterId: master.id, name: 'ATP consistency race' }, { viewer: owner })
    await recordMovement({ businessId: b(), productId: raceProduct.id, kind: 'RECEIPT', quantity: 10, occurredAt: NOW }, { viewer: owner })
    const hold = await createReservation({ businessId: b(), productId: raceProduct.id, purpose: 'ORDER', salesOrderId: 'so-atp-consistency-race', quantity: 3 }, { viewer: owner, now: NOW })

    const onHandRead = deferred()
    const reservationsRead = deferred()
    const releaseOnHandRead = deferred()
    const releaseReservationsRead = deferred()
    let readerHasFence = false
    const readerDb = instrumentDb(prisma, {
      afterFenceAcquire: () => { readerHasFence = true },
      onHandRead: async (result) => {
        onHandRead.resolve()
        await releaseOnHandRead.promise
        return result
      },
      beforeReservationsRead: async () => {
        reservationsRead.resolve()
        await releaseReservationsRead.promise
      },
    })
    const movementTransactionStart = deferred()
    const releaseTransactionStart = deferred()
    const movementFenceAttempt = deferred()
    const releaseFenceAttempt = deferred()
    let movementFenceAttempted = false
    let releaseFenceAttempted = false
    const postgresProfile = /^(postgres|postgresql):/i.test(process.env.DATABASE_URL ?? '')
    let atpPromise, movementPromise, releasePromise
    const startMovement = () => recordMovement(
      { businessId: b(), productId: raceProduct.id, kind: 'ISSUE', quantity: 2, occurredAt: NOW },
      { viewer: owner, db: instrumentDb(movementDb, {
        beforeTransactionStart: () => movementTransactionStart.resolve(),
        beforeFenceAttempt: () => { movementFenceAttempted = true; movementFenceAttempt.resolve() },
      }) },
    )
    const startRelease = () => applyReservationAction(
      hold.id,
      { businessId: b(), action: 'RELEASE', version: hold.version },
      { viewer: owner, db: instrumentDb(releaseDb, {
        beforeTransactionStart: () => releaseTransactionStart.resolve(),
        beforeFenceAttempt: () => { releaseFenceAttempted = true; releaseFenceAttempt.resolve() },
      }), now: NOW },
    )
    try {
      atpPromise = availableToPromiseFor({ businessId: b(), productIds: [raceProduct.id], viewer: member, db: readerDb, now: NOW })
      await Promise.all([onHandRead.promise, reservationsRead.promise])

      if (readerHasFence) {
        movementPromise = startMovement()
        releasePromise = startRelease()
        if (postgresProfile) {
          // PostgreSQL enters both transaction callbacks while the reader is
          // paused, so prove each writer reaches the real row-fence attempt
          // before releasing either source-read gate.
          await Promise.all([movementFenceAttempt.promise, releaseFenceAttempt.promise])
        } else {
          // SQLite may block at BEGIN before a writer callback or row-fence
          // hook can run. Confirm both API calls started, then let the reader
          // commit so they can proceed serially.
          await Promise.all([movementTransactionStart.promise, releaseTransactionStart.promise])
        }
      } else {
        movementPromise = startMovement()
        await movementPromise
        releasePromise = startRelease()
        await releasePromise
      }

      releaseOnHandRead.resolve()
      releaseReservationsRead.resolve()
      const [atp] = await Promise.all([atpPromise, movementPromise, releasePromise])

      expect(Object.keys(atp).sort()).toEqual(['businessId', 'byProductId', 'products'])
      expect(Object.keys(atp.products[0]).sort()).toEqual(['available', 'code', 'committed', 'itemKind', 'onHand', 'overCommitted', 'productId', 'reservedForQuotes', 'stockPolicy', 'unit'])
      expect(atp.products[0].available).toBe(7)
      expect(atp.products[0]).toMatchObject({ productId: raceProduct.id, onHand: 10, committed: 3, reservedForQuotes: 0, available: 7 })
      expect(readerHasFence).toBe(true)
      expect(movementFenceAttempted).toBe(true)
      expect(releaseFenceAttempted).toBe(true)
      expect((await prisma.stockReservation.findUnique({ where: { id: hold.id } })).status).toBe('RELEASED')
      expect((await availableToPromiseFor({ businessId: b(), productIds: [raceProduct.id], viewer: member, now: NOW })).products[0])
        .toMatchObject({ onHand: 8, reservedForQuotes: 0, available: 8 })
    } finally {
      releaseOnHandRead.resolve()
      releaseReservationsRead.resolve()
      await Promise.allSettled([atpPromise, movementPromise, releasePromise].filter(Boolean))
    }
  })

  it('uses the post-fence default clock but honors an explicit time supplied by the caller', async () => {
    const clockProduct = await createProduct({ businessId: b(), code: 'ATP-CONSISTENCY-CLOCK', productMasterId: master.id, name: 'ATP clock consistency' }, { viewer: owner })
    await recordMovement({ businessId: b(), productId: clockProduct.id, kind: 'RECEIPT', quantity: 10, occurredAt: NOW }, { viewer: owner })
    const explicitNow = new Date()
    const expiresAt = new Date(explicitNow.getTime() + 1500)
    const hold = await createReservation({ businessId: b(), productId: clockProduct.id, purpose: 'QUOTE', quantity: 3, expiresAt }, { viewer: owner, now: explicitNow })

    const releaseFence = deferred()
    const readerFenceAttempt = deferred()
    let atpPromise
    try {
      atpPromise = availableToPromiseFor({
        businessId: b(), productIds: [clockProduct.id], viewer: member,
        db: instrumentDb(prisma, {
          beforeFenceAttempt: () => readerFenceAttempt.resolve(),
          beforeFenceAcquire: () => releaseFence.promise,
        }),
      })
      // Stall the real fence upsert, then let the reservation expire before
      // it runs. Source reads still use the disposable SQLite database.
      const reachedFence = await Promise.race([
        readerFenceAttempt.promise.then(() => true),
        atpPromise.then(() => false, () => false),
      ])
      expect(reachedFence).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, expiresAt.getTime() + 75 - Date.now())))
    } finally {
      releaseFence.resolve()
    }

    const afterFenceExpiry = await atpPromise
    expect(afterFenceExpiry.products[0]).toMatchObject({ onHand: 10, reservedForQuotes: 0, available: 10 })
    const explicitEarlierTime = await availableToPromiseFor({ businessId: b(), productIds: [clockProduct.id], viewer: member, now: explicitNow })
    expect(explicitEarlierTime.products[0]).toMatchObject({ reservedForQuotes: 3, available: 7 })
    const swept = await expireDueReservations({ businessId: b(), viewer: owner, now: new Date() })
    expect(swept.codes).toContain(hold.code)
  })

  it('keeps maxBuildableSets on the post-fence clock while preserving an explicit caller time', async () => {
    const explicitNow = new Date()
    const before = await maxBuildableSets({ businessId: b(), recipeId: recipe.id, quantity: 100, viewer: member, now: explicitNow })
    const expiresAt = new Date(explicitNow.getTime() + 1500)
    const hold = await createReservation({ businessId: b(), productId: powerbank.id, quantity: 1, expiresAt }, { viewer: owner, now: explicitNow })
    const releaseFence = deferred()
    const fenceAttempt = deferred()
    let buildPromise
    try {
      buildPromise = maxBuildableSets({
        businessId: b(), recipeId: recipe.id, quantity: 100, viewer: member,
        db: instrumentDb(prisma, {
          beforeFenceAttempt: () => fenceAttempt.resolve(),
          beforeFenceAcquire: () => releaseFence.promise,
        }),
      })
      const reachedFence = await Promise.race([
        fenceAttempt.promise.then(() => true),
        buildPromise.then(() => false, () => false),
      ])
      expect(reachedFence).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, expiresAt.getTime() + 75 - Date.now())))
      releaseFence.resolve()

      const afterExpiry = await buildPromise
      expect(afterExpiry.maxBuildable).toBe(before.maxBuildable)
      const explicitEarlierTime = await maxBuildableSets({ businessId: b(), recipeId: recipe.id, quantity: 100, viewer: member, now: explicitNow })
      expect(explicitEarlierTime.maxBuildable).toBe(before.maxBuildable - 1)
    } finally {
      releaseFence.resolve()
      await Promise.allSettled([buildPromise].filter(Boolean))
      await applyReservationAction(hold.id, { businessId: b(), action: 'RELEASE', version: hold.version }, { viewer: owner, now: new Date() }).catch(() => {})
    }
  })

  it('selects due reservations using the post-fence default clock', async () => {
    const clockProduct = await createProduct({ businessId: b(), code: 'ATP-EXPIRY-CLOCK', productMasterId: master.id, name: 'ATP expiry clock' }, { viewer: owner })
    await recordMovement({ businessId: b(), productId: clockProduct.id, kind: 'RECEIPT', quantity: 5, occurredAt: NOW }, { viewer: owner })
    const explicitNow = new Date()
    const expiresAt = new Date(explicitNow.getTime() + 1500)
    const hold = await createReservation({ businessId: b(), productId: clockProduct.id, purpose: 'QUOTE', quantity: 1, expiresAt }, { viewer: owner, now: explicitNow })

    const releaseFence = deferred()
    const fenceAttempt = deferred()
    let expirePromise
    try {
      expirePromise = expireDueReservations({
        businessId: b(), viewer: owner,
        db: instrumentDb(prisma, {
          beforeFenceAttempt: () => fenceAttempt.resolve(),
          beforeFenceAcquire: () => releaseFence.promise,
        }),
      })
      const reachedFence = await Promise.race([
        fenceAttempt.promise.then(() => true),
        expirePromise.then(() => false, () => false),
      ])
      expect(reachedFence).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, expiresAt.getTime() + 75 - Date.now())))
    } finally {
      releaseFence.resolve()
    }

    await expect(expirePromise).resolves.toMatchObject({ businessId: b(), expired: 1, codes: [hold.code] })
    expect((await prisma.stockReservation.findUnique({ where: { id: hold.id } })).status).toBe('EXPIRED')
  })

  it('does not write fence metadata before a denied ATP read', async () => {
    const denied = makeViewer({ visibleBusinessIds: [], ownedBusinessIds: [], visibleDomains: DOMAINS })
    let fenceAttempts = 0
    await expect(availableToPromiseFor({
      businessId: b(), productIds: [tumbler.id], viewer: denied,
      db: instrumentDb(prisma, { beforeFenceAttempt: () => { fenceAttempts += 1 } }), now: NOW,
    })).rejects.toMatchObject({ status: 404 })
    expect(fenceAttempts).toBe(0)
  })
})
