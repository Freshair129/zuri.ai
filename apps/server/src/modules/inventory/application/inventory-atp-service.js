import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { explodeRecipe, stockOnHand } from '../domain/inventory'
import {
  DEFAULT_QUOTE_RESERVATION_DAYS,
  STOCK_RESERVATION_ENTITY,
  availableToPromise,
  isReservationLive,
  maxBuildableFromAvailable,
  quoteExpiryAt,
  reservationCode,
  workOrderDayKey,
  zCreateReservation,
  zReservationAction,
} from '../domain/inventory-wip'
import { loadBusiness, notFound } from './inventory-authority'

// @req FR-180 — the only writer of `StockReservation`, and the reader that
//   turns the ledger plus the live reservations into Available-to-Promise.
//   A reservation is a promise, so it never writes the stock ledger: on-hand
//   still says what is on a shelf, and ATP says how much of it is still ours
//   to sell. A reservation is never deleted either — it ends RELEASED,
//   CONVERTED or EXPIRED — so a past refusal to promise stays explicable.
//   Expiry is decided on read against the clock, which is why an ATP figure is
//   right whether or not any worker has run; `expireDueReservations` only
//   stamps rows every reader already ignores, for reporting (BR-031).
// @spec ADR-074 D8; BR-031; BR-002; SEC-001; FR-072
// @tested tests/integration/fr180-atp-reservations.test.js

const failure = (status, message) => Object.assign(new Error(message), { status })
const actor = (viewer) => viewer?.principal?.id ?? null

/**
 * Run in the caller's transaction when there is one, else open our own. The
 * agent's Gate F action gate hands its own `tx` down (ADR-074 D9), and a
 * nested `$transaction` on a second client would deadlock against it.
 */
const inTx = (db, fn) => (typeof db?.$transaction === 'function' ? db.$transaction(fn) : fn(db))

export const RESERVATION_SELECT = {
  id: true, code: true, tenantId: true, businessId: true, productId: true, purpose: true, quantity: true, status: true,
  customerId: true, salesOrderId: true, quoteReference: true, customerCompany: true, contactHandle: true, notes: true,
  reservedAt: true, expiresAt: true, releasedAt: true, convertedAt: true, createdByPersonId: true,
  createdAt: true, updatedAt: true, version: true,
}
const PRODUCT_SELECT = { id: true, code: true, businessId: true, status: true, stockPolicy: true, trackingMode: true, itemKind: true, unit: true }

async function nextCode(tx, business, now) {
  const prefix = `RSV-${workOrderDayKey(now)}-`
  const count = await tx.stockReservation.count({ where: { tenantId: business.tenantId, code: { startsWith: prefix } } })
  for (let seq = count + 1; seq < count + 200; seq += 1) {
    const code = reservationCode(now, seq)
    const taken = await tx.stockReservation.findUnique({ where: { tenantId_code: { tenantId: business.tenantId, code } }, select: { id: true } })
    if (!taken) return code
  }
  throw failure(409, 'STOCK_RESERVATION_CODE_EXHAUSTED')
}

/** On-hand per product id, recomputed from the ledger; an uncounted product reports null. */
async function onHandFor(db, productIds) {
  if (!productIds.length) return {}
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, stockPolicy: true, movements: { select: { quantity: true } } },
  })
  return Object.fromEntries(products.map((p) => [p.id, p.stockPolicy === 'TRACKED' ? stockOnHand(p.movements) : null]))
}

/** Live reservations per product id — every ACTIVE row whose clock has not run out. */
async function reservationsFor(db, businessId, productIds, now) {
  if (!productIds.length) return {}
  const rows = await db.stockReservation.findMany({
    where: { businessId, productId: { in: productIds }, status: 'ACTIVE' },
    select: { productId: true, purpose: true, quantity: true, status: true, expiresAt: true },
  })
  const byProduct = {}
  for (const row of rows) {
    if (!isReservationLive(row, now)) continue
    if (!byProduct[row.productId]) byProduct[row.productId] = []
    byProduct[row.productId].push(row)
  }
  return byProduct
}

/**
 * Available-to-Promise for a set of products (or every counted product of the
 * Business). An uncounted product reports `available: null` rather than a
 * zero — it has no ledger to subtract from, and a zero would read as
 * "measured and empty".
 */
export async function availableToPromiseFor({ businessId, productIds, viewer, db = prisma, now = new Date() } = {}) {
  const business = await loadBusiness(db, viewer, businessId)
  const products = await db.product.findMany({
    where: { businessId: business.id, ...(productIds?.length ? { id: { in: productIds } } : {}), status: { not: 'ARCHIVED' } },
    select: PRODUCT_SELECT,
    orderBy: [{ code: 'asc' }],
  })
  const ids = products.map((p) => p.id)
  const [onHand, reservations] = await Promise.all([onHandFor(db, ids), reservationsFor(db, business.id, ids, now)])
  const rows = products.map((product) => {
    if (product.stockPolicy !== 'TRACKED') {
      return { productId: product.id, code: product.code, unit: product.unit, itemKind: product.itemKind, stockPolicy: product.stockPolicy, onHand: null, committed: 0, reservedForQuotes: 0, available: null, overCommitted: 0 }
    }
    const atp = availableToPromise({ onHand: onHand[product.id] ?? 0, reservations: reservations[product.id] ?? [], now })
    return { productId: product.id, code: product.code, unit: product.unit, itemKind: product.itemKind, stockPolicy: product.stockPolicy, ...atp }
  })
  return { businessId: business.id, products: rows, byProductId: Object.fromEntries(rows.map((r) => [r.productId, r.available])) }
}

/**
 * How many complete sets of one finished SKU could be promised right now: the
 * recipe exploded against ATP rather than on-hand, so two quotes cannot both
 * promise the same tumblers. Returns the per-component picture as well as the
 * count, because "why only 120" is the next question every time.
 */
export async function maxBuildableSets({ businessId, recipeId, quantity, viewer, db = prisma, now = new Date() } = {}) {
  const business = await loadBusiness(db, viewer, businessId)
  const recipe = await db.productRecipe.findUnique({
    where: { id: typeof recipeId === 'string' ? recipeId.trim() : '' },
    select: { id: true, code: true, businessId: true, productId: true, batchSize: true, yieldQty: true, status: true, scrapAllowanceFactor: true, lines: { select: { componentProductId: true, qty: true, unit: true, fixed: true }, orderBy: { id: 'asc' } } },
  })
  if (!recipe || recipe.businessId !== business.id) throw notFound()
  if (recipe.status === 'ARCHIVED') throw failure(409, 'PRODUCT_RECIPE_ARCHIVED')

  const componentIds = recipe.lines.map((l) => l.componentProductId)
  const atp = await availableToPromiseFor({ businessId: business.id, productIds: componentIds, viewer, db, now })
  const available = atp.byProductId
  const requestedQty = Number.isInteger(Number(quantity)) && Number(quantity) > 0 ? Number(quantity) : recipe.batchSize
  const explosion = explodeRecipe(recipe, requestedQty)
  const lines = explosion.lines.map((line) => {
    const free = available[line.componentProductId]
    const needed = Math.ceil(line.required - 1e-9)
    return {
      componentProductId: line.componentProductId,
      code: atp.products.find((p) => p.productId === line.componentProductId)?.code ?? null,
      required: needed,
      available: free ?? null,
      shortage: free === null || free === undefined ? 0 : Math.max(0, needed - free),
    }
  })
  return {
    businessId: business.id,
    recipeId: recipe.id,
    recipeCode: recipe.code,
    finishedProductId: recipe.productId,
    quantity: requestedQty,
    maxBuildable: maxBuildableFromAvailable(recipe, available),
    canPromise: lines.every((l) => l.shortage === 0),
    lines,
  }
}

/**
 * Place a hold. A `QUOTE` hold expires (7 days by default) and is the one a
 * sales conversation places; an `ORDER` hold is committed against a confirmed
 * sales order and does not expire. Refused when the quantity exceeds what is
 * still available — the whole point is that two quotes cannot promise the same
 * stock.
 */
export async function createReservation(input, { viewer, db = prisma, now = new Date() } = {}) {
  const data = zCreateReservation.parse(input)
  return inTx(db, async (tx) => {
    const business = await loadBusiness(tx, viewer, data.businessId, { write: true })
    const product = await tx.product.findUnique({ where: { id: data.productId }, select: PRODUCT_SELECT })
    if (!product || product.businessId !== business.id) throw failure(422, 'INVENTORY_PRODUCT_NOT_FOUND')
    if (product.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
    if (product.stockPolicy !== 'TRACKED') throw failure(422, 'INVENTORY_PRODUCT_UNTRACKED')

    const purpose = data.purpose ?? 'QUOTE'
    if (purpose === 'ORDER' && !data.salesOrderId) throw failure(422, 'STOCK_RESERVATION_ORDER_REQUIRES_SALES_ORDER')

    const movements = await tx.stockMovement.findMany({ where: { productId: product.id }, select: { quantity: true } })
    const existing = await tx.stockReservation.findMany({
      where: { businessId: business.id, productId: product.id, status: 'ACTIVE' },
      select: { purpose: true, quantity: true, status: true, expiresAt: true },
    })
    const atp = availableToPromise({ onHand: stockOnHand(movements), reservations: existing, now })
    if (data.quantity > atp.available) {
      throw Object.assign(failure(409, 'STOCK_RESERVATION_INSUFFICIENT_ATP'), { details: { requested: data.quantity, ...atp } })
    }

    const code = await nextCode(tx, business, now)
    const expiresAt = purpose === 'ORDER'
      ? (data.expiresAt ?? null)
      : (data.expiresAt ?? quoteExpiryAt(now, data.holdDays ?? DEFAULT_QUOTE_RESERVATION_DAYS))
    const created = await tx.stockReservation.create({
      data: {
        code, tenantId: business.tenantId, businessId: business.id, productId: product.id, purpose, quantity: data.quantity,
        customerId: data.customerId ?? null, salesOrderId: data.salesOrderId ?? null, quoteReference: data.quoteReference ?? null,
        customerCompany: data.customerCompany ?? null, contactHandle: data.contactHandle ?? null, notes: data.notes ?? null,
        reservedAt: now, expiresAt, createdByPersonId: actor(viewer),
      },
      select: RESERVATION_SELECT,
    })
    await recordAudit(tx, {
      entityType: STOCK_RESERVATION_ENTITY, entityId: created.id, action: 'STOCK_RESERVATION_CREATED', actorId: actor(viewer),
      payload: { businessId: business.id, code, productId: product.id, productCode: product.code, purpose, quantity: data.quantity, expiresAt, availableBefore: atp.available },
    })
    return created
  })
}

export async function listReservations({ businessId, productId, status, viewer, db = prisma, now = new Date() } = {}) {
  const business = await loadBusiness(db, viewer, businessId)
  const rows = await db.stockReservation.findMany({
    where: { businessId: business.id, ...(productId ? { productId } : {}), ...(status ? { status } : {}) },
    orderBy: [{ reservedAt: 'desc' }],
    select: RESERVATION_SELECT,
  })
  // `live` is computed, never stored: a row whose clock ran out an hour ago is
  // still ACTIVE in the database and must already read as spent (BR-031).
  return rows.map((row) => ({ ...row, live: isReservationLive(row, now) }))
}

const ACTIONS = Object.freeze({ RELEASE: 'STOCK_RESERVATION_RELEASED', CONVERT: 'STOCK_RESERVATION_CONVERTED' })

/** Release a hold, or convert a quote hold into a committed one. Never a delete. */
export async function applyReservationAction(id, input, { viewer, db = prisma, now = new Date() } = {}) {
  const reservationId = typeof id === 'string' ? id.trim() : ''
  if (!reservationId) throw notFound()
  const data = zReservationAction.parse(input)
  return inTx(db, async (tx) => {
    const row = await tx.stockReservation.findUnique({ where: { id: reservationId }, select: RESERVATION_SELECT })
    if (!row) throw notFound()
    const business = await loadBusiness(tx, viewer, data.businessId, { write: true })
    if (row.businessId !== business.id) throw notFound()
    if (row.version !== data.version) throw failure(409, 'STOCK_RESERVATION_VERSION_CONFLICT')
    if (row.status !== 'ACTIVE') throw failure(409, 'STOCK_RESERVATION_NOT_ACTIVE')

    const change = { version: { increment: 1 } }
    if (data.action === 'RELEASE') {
      change.status = 'RELEASED'
      change.releasedAt = now
    } else {
      if (row.purpose === 'ORDER') throw failure(409, 'STOCK_RESERVATION_ALREADY_COMMITTED')
      const salesOrderId = data.salesOrderId ?? row.salesOrderId
      if (!salesOrderId) throw failure(422, 'STOCK_RESERVATION_ORDER_REQUIRES_SALES_ORDER')
      // The quote hold ends CONVERTED and a committed one takes its place, so
      // the stock is never briefly free between the two.
      change.status = 'CONVERTED'
      change.convertedAt = now
      const code = await nextCode(tx, business, now)
      const committed = await tx.stockReservation.create({
        data: {
          code, tenantId: business.tenantId, businessId: business.id, productId: row.productId, purpose: 'ORDER', quantity: row.quantity,
          customerId: row.customerId, salesOrderId, quoteReference: row.quoteReference, customerCompany: row.customerCompany,
          contactHandle: row.contactHandle, notes: row.notes, reservedAt: now, expiresAt: null, createdByPersonId: actor(viewer),
        },
        select: RESERVATION_SELECT,
      })
      await tx.stockReservation.update({ where: { id: row.id }, data: change })
      await recordAudit(tx, {
        entityType: STOCK_RESERVATION_ENTITY, entityId: row.id, action: ACTIONS.CONVERT, actorId: actor(viewer),
        payload: { businessId: business.id, code: row.code, committedCode: committed.code, salesOrderId, quantity: row.quantity, version: row.version + 1 },
      })
      return { released: await tx.stockReservation.findUnique({ where: { id: row.id }, select: RESERVATION_SELECT }), committed }
    }
    await tx.stockReservation.update({ where: { id: row.id }, data: change })
    await recordAudit(tx, {
      entityType: STOCK_RESERVATION_ENTITY, entityId: row.id, action: ACTIONS.RELEASE, actorId: actor(viewer),
      payload: { businessId: business.id, code: row.code, quantity: row.quantity, reason: data.reason ?? null, version: row.version + 1 },
    })
    return { released: await tx.stockReservation.findUnique({ where: { id: row.id }, select: RESERVATION_SELECT }), committed: null }
  })
}

/**
 * Stamp `EXPIRED` on quote holds whose clock has run out. Purely for
 * reporting: every reader already ignores them (`isReservationLive`), so this
 * changes no ATP figure — which is exactly why it is safe to run, or not run,
 * on any schedule at all.
 */
export async function expireDueReservations({ businessId, viewer, db = prisma, now = new Date() } = {}) {
  const business = await loadBusiness(db, viewer, businessId, { write: true })
  const due = await db.stockReservation.findMany({
    where: { businessId: business.id, status: 'ACTIVE', expiresAt: { not: null, lte: now } },
    select: { id: true, code: true, quantity: true, productId: true },
  })
  if (!due.length) return { businessId: business.id, expired: 0, codes: [] }
  await inTx(db, async (tx) => {
    for (const row of due) {
      await tx.stockReservation.update({ where: { id: row.id }, data: { status: 'EXPIRED', version: { increment: 1 } } })
      await recordAudit(tx, {
        entityType: STOCK_RESERVATION_ENTITY, entityId: row.id, action: 'STOCK_RESERVATION_EXPIRED', actorId: actor(viewer),
        payload: { businessId: business.id, code: row.code, productId: row.productId, quantity: row.quantity },
      })
    }
  })
  return { businessId: business.id, expired: due.length, codes: due.map((r) => r.code) }
}
