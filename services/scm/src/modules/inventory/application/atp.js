import { explodeRecipe } from '../../../kernel/inventory/inventory.js'
import {
  DEFAULT_QUOTE_RESERVATION_DAYS, STOCK_RESERVATION_ENTITY, availableToPromise, isReservationLive, maxBuildableFromAvailable,
  quoteExpiryAt, reservationCode, workOrderDayKey, zCreateReservation, zReservationAction,
} from '../../../kernel/inventory/inventory-wip.js'
import { denied, inventoryAuthority } from '../../../infrastructure/delegation.js'
import { enqueueOutbox, recordAudit } from '../../../infrastructure/evidence.js'
import * as catalogRepo from '../adapters/catalog-repo.js'
import * as repo from '../adapters/inventory-repo.js'
import * as wipRepo from '../adapters/wip-repo.js'

// Available-to-Promise and reservations (FR-180) inside SCM — port of apps/server
// inventory-atp-service with the same codes, order of refusals and audit actions.
// A reservation is a promise: it never writes the ledger and is never deleted; it
// ends RELEASED, CONVERTED or EXPIRED. Liveness is decided on read against the
// clock (BR-031), so `expireDueReservations` only stamps rows every reader
// already ignores. ATP = on-hand from the ledger − live holds; an uncounted SKU
// reports `available: null`, never 0.
//
// Two hardenings over legacy (SCM-HANDOFF D-23): a new hold takes the Business's
// ledger fence before it reads on-hand and the live holds, so two holds — or a
// hold and a stock issue — cannot both spend the same units (F-16); RELEASE /
// CONVERT / EXPIRE compare-and-swap the row, so a hold cannot be converted twice
// (F-17).

const failure = (status, code, details) => Object.assign(new Error(code), { status, code, retryable: false }, details === undefined ? {} : { details })
const iso = (value) => (value instanceof Date ? value.toISOString() : value)
const ACTIONS = Object.freeze({ RELEASE: 'STOCK_RESERVATION_RELEASED', CONVERT: 'STOCK_RESERVATION_CONVERTED' })

function evidence(sql, scope, { entityId, action, business, payload, version, ctx }) {
  recordAudit(sql, { entityType: STOCK_RESERVATION_ENTITY, entityId, action, actorId: scope.actorId, tenantId: business.tenantId, businessId: business.id, requestId: ctx.requestId, now: ctx.now, payload })
  enqueueOutbox(sql, { topic: `scm.inventory.${action.toLowerCase().replace(/_/g, '-')}`, aggregateType: STOCK_RESERVATION_ENTITY, aggregateId: entityId, aggregateVersion: version, now: ctx.now, payload: { businessId: business.id, reservationId: entityId } })
}

function nextCode(sql, business, now) {
  const count = wipRepo.reservationCodeCount(sql, business.tenantId, `RSV-${workOrderDayKey(now)}-`)
  for (let seq = count + 1; seq < count + 200; seq += 1) {
    const code = reservationCode(now, seq)
    if (!wipRepo.reservationCodeTaken(sql, business.tenantId, code)) return code
  }
  throw failure(409, 'STOCK_RESERVATION_CODE_EXHAUSTED')
}

const liveHoldsOf = (sql, businessId, productIds, now) => {
  const live = {}
  for (const row of wipRepo.activeReservationsOf(sql, businessId, productIds)) {
    if (!isReservationLive(row, now)) continue
    ;(live[row.productId] ??= []).push(row)
  }
  return live
}

/**
 * Available-to-Promise for a set of SKUs (or every non-archived SKU of the
 * Business), ordered by code. `byProductId` maps each to its `available`.
 */
export function availableToPromiseFor(sql, scope, { businessId, productIds, now }) {
  const business = inventoryAuthority.require(scope, typeof businessId === 'string' ? businessId.trim() : '')
  const all = catalogRepo.productsOf(sql, business.id, {}).filter((p) => p.status !== 'ARCHIVED')
  const wanted = productIds?.length ? new Set(productIds) : null
  const products = (wanted ? all.filter((p) => wanted.has(p.id)) : all).sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
  const live = liveHoldsOf(sql, business.id, products.map((p) => p.id), now)
  const rows = products.map((product) => {
    if (product.stockPolicy !== 'TRACKED') {
      return { productId: product.id, code: product.code, unit: product.unit, itemKind: product.itemKind, stockPolicy: product.stockPolicy, onHand: null, committed: 0, reservedForQuotes: 0, available: null, overCommitted: 0 }
    }
    const atp = availableToPromise({ onHand: Number(repo.onHandOf(sql, product.id)), reservations: live[product.id] ?? [], now })
    return { productId: product.id, code: product.code, unit: product.unit, itemKind: product.itemKind, stockPolicy: product.stockPolicy, ...atp }
  })
  return { businessId: business.id, products: rows, byProductId: Object.fromEntries(rows.map((r) => [r.productId, r.available])) }
}

/** How many complete sets of a recipe's output ATP allows right now, with the per-component picture. */
export function maxBuildableSets(sql, scope, { businessId, recipeId, quantity, now }) {
  const business = inventoryAuthority.require(scope, typeof businessId === 'string' ? businessId.trim() : '')
  const recipe = wipRepo.recipeById(sql, typeof recipeId === 'string' ? recipeId.trim() : '')
  if (!recipe || recipe.businessId !== business.id) throw denied()
  if (recipe.status === 'ARCHIVED') throw failure(409, 'PRODUCT_RECIPE_ARCHIVED')
  const atp = availableToPromiseFor(sql, scope, { businessId: business.id, productIds: recipe.lines.map((l) => l.componentProductId), now })
  const available = atp.byProductId
  const requestedQty = Number.isInteger(Number(quantity)) && Number(quantity) > 0 ? Number(quantity) : recipe.batchSize
  const lines = explodeRecipe(recipe, requestedQty).lines.map((line) => {
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
  return { businessId: business.id, recipeId: recipe.id, recipeCode: recipe.code, finishedProductId: recipe.productId, quantity: requestedQty, maxBuildable: maxBuildableFromAvailable(recipe, available), canPromise: lines.every((l) => l.shortage === 0), lines }
}

/** Command authorization: validate first (legacy order), then Inventory write on the named Business. */
export const reserverOf = (scope, body) => inventoryAuthority.require(scope, zCreateReservation.parse(body).businessId, { write: true }).id
/** Action authorization: the body's Business (write), then a hold of that Business; 404 otherwise. */
export function reservationActorOf(sql, scope, id, body) {
  const data = zReservationAction.parse(body)
  const business = inventoryAuthority.require(scope, data.businessId, { write: true })
  const row = typeof id === 'string' && id.trim() ? wipRepo.reservationById(sql, id.trim()) : null
  if (!row || row.businessId !== business.id) throw denied()
  return business.id
}
export const sweeperOf = (scope, body) => inventoryAuthority.require(scope, typeof body?.businessId === 'string' ? body.businessId.trim() : '', { write: true }).id

/**
 * Place a hold: a QUOTE hold expires (7 days by default), an ORDER hold is
 * committed against a sales order and does not. Refused when it exceeds ATP.
 */
export function createReservation(sql, scope, input, ctx) {
  const data = zCreateReservation.parse(input)
  const business = inventoryAuthority.require(scope, data.businessId, { write: true })
  const product = repo.productById(sql, data.productId)
  if (!product || product.businessId !== business.id) throw failure(422, 'INVENTORY_PRODUCT_NOT_FOUND')
  if (product.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
  if (product.stockPolicy !== 'TRACKED') throw failure(422, 'INVENTORY_PRODUCT_UNTRACKED')
  const purpose = data.purpose ?? 'QUOTE'
  if (purpose === 'ORDER' && !data.salesOrderId) throw failure(422, 'STOCK_RESERVATION_ORDER_REQUIRES_SALES_ORDER')

  // F-16 / D-23: serialize with every other hold and every stock movement of the Business.
  repo.acquireFence(sql, { tenantId: business.tenantId, businessId: business.id, now: ctx.now })
  const existing = wipRepo.activeReservationsOf(sql, business.id, [product.id])
  const atp = availableToPromise({ onHand: Number(repo.onHandOf(sql, product.id)), reservations: existing, now: ctx.now })
  if (data.quantity > atp.available) throw failure(409, 'STOCK_RESERVATION_INSUFFICIENT_ATP', { requested: data.quantity, ...atp })

  const code = nextCode(sql, business, ctx.now)
  const expiresAt = purpose === 'ORDER'
    ? (iso(data.expiresAt) ?? null)
    : (iso(data.expiresAt) ?? quoteExpiryAt(ctx.now, data.holdDays ?? DEFAULT_QUOTE_RESERVATION_DAYS).toISOString())
  const created = wipRepo.insertReservation(sql, {
    code, tenantId: business.tenantId, businessId: business.id, productId: product.id, purpose, quantity: data.quantity,
    customerId: data.customerId ?? null, salesOrderId: data.salesOrderId ?? null, quoteReference: data.quoteReference ?? null,
    customerCompany: data.customerCompany ?? null, contactHandle: data.contactHandle ?? null, notes: data.notes ?? null,
    reservedAt: ctx.now, expiresAt, createdByPersonId: scope.actorId, createdAt: ctx.now, updatedAt: ctx.now,
  })
  evidence(sql, scope, { entityId: created.id, action: 'STOCK_RESERVATION_CREATED', business, version: 1, ctx, payload: { businessId: business.id, code, productId: product.id, productCode: product.code, purpose, quantity: data.quantity, expiresAt, availableBefore: atp.available } })
  return { response: { reservation: created }, affected: { reservationId: created.id, version: created.version } }
}

export function listReservations(sql, scope, { businessId, productId, status, now }) {
  const business = inventoryAuthority.require(scope, typeof businessId === 'string' ? businessId.trim() : '')
  // `live` is computed, never stored (BR-031).
  return wipRepo.reservationsOf(sql, business.id, { productId: productId || undefined, status: status || undefined }).map((row) => ({ ...row, live: isReservationLive(row, now) }))
}

/** Release a hold, or convert a quote hold into a committed one with no moment in between. Never a delete. */
export function applyReservationAction(sql, scope, id, input, ctx) {
  const data = zReservationAction.parse(input)
  const row = typeof id === 'string' && id.trim() ? wipRepo.reservationById(sql, id.trim()) : null
  if (!row) throw denied()
  const business = inventoryAuthority.require(scope, data.businessId, { write: true })
  if (row.businessId !== business.id) throw denied()
  if (row.version !== data.version) throw failure(409, 'STOCK_RESERVATION_VERSION_CONFLICT')
  if (row.status !== 'ACTIVE') throw failure(409, 'STOCK_RESERVATION_NOT_ACTIVE')
  const cas = (change) => {
    ctx.faults?.beforeReservationUpdate?.()
    if (wipRepo.casReservation(sql, { id: row.id, version: row.version, change, now: ctx.now }) !== 1) throw failure(409, 'STOCK_RESERVATION_VERSION_CONFLICT')
  }
  if (data.action === 'RELEASE') {
    cas({ status: 'RELEASED', releasedAt: ctx.now })
    evidence(sql, scope, { entityId: row.id, action: ACTIONS.RELEASE, business, version: row.version + 1, ctx, payload: { businessId: business.id, code: row.code, quantity: row.quantity, reason: data.reason ?? null, version: row.version + 1 } })
    const released = wipRepo.reservationById(sql, row.id)
    return { response: { released, committed: null }, affected: { reservationId: row.id, version: released.version, status: released.status } }
  }
  if (row.purpose === 'ORDER') throw failure(409, 'STOCK_RESERVATION_ALREADY_COMMITTED')
  const salesOrderId = data.salesOrderId ?? row.salesOrderId
  if (!salesOrderId) throw failure(422, 'STOCK_RESERVATION_ORDER_REQUIRES_SALES_ORDER')
  const code = nextCode(sql, business, ctx.now)
  const committed = wipRepo.insertReservation(sql, {
    code, tenantId: business.tenantId, businessId: business.id, productId: row.productId, purpose: 'ORDER', quantity: row.quantity,
    customerId: row.customerId, salesOrderId, quoteReference: row.quoteReference, customerCompany: row.customerCompany,
    contactHandle: row.contactHandle, notes: row.notes, reservedAt: ctx.now, expiresAt: null, createdByPersonId: scope.actorId, createdAt: ctx.now, updatedAt: ctx.now,
  })
  cas({ status: 'CONVERTED', convertedAt: ctx.now })
  evidence(sql, scope, { entityId: row.id, action: ACTIONS.CONVERT, business, version: row.version + 1, ctx, payload: { businessId: business.id, code: row.code, committedCode: committed.code, salesOrderId, quantity: row.quantity, version: row.version + 1 } })
  const released = wipRepo.reservationById(sql, row.id)
  return { response: { released, committed }, affected: { reservationId: row.id, committedReservationId: committed.id, version: released.version, status: released.status } }
}

/** Stamp EXPIRED on holds whose clock has run out — reporting only; no ATP figure changes. */
export function expireDueReservations(sql, scope, { businessId }, ctx) {
  const business = inventoryAuthority.require(scope, typeof businessId === 'string' ? businessId.trim() : '', { write: true })
  const codes = []
  for (const row of wipRepo.dueReservations(sql, business.id, ctx.now)) {
    if (wipRepo.expireReservation(sql, row.id, ctx.now) !== 1) continue
    evidence(sql, scope, { entityId: row.id, action: 'STOCK_RESERVATION_EXPIRED', business, version: Number(row.version) + 1, ctx, payload: { businessId: business.id, code: row.code, productId: row.productId, quantity: row.quantity } })
    codes.push(row.code)
  }
  return { response: { businessId: business.id, expired: codes.length, codes }, affected: { businessId: business.id, expired: codes.length } }
}
