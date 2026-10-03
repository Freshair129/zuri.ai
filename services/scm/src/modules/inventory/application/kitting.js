import { explodeRecipe } from '../../../kernel/inventory/inventory.js'
import { isFinishedSetSku, kittedUnitCostSatang, weightedAverageUnitCostSatang } from '../../../kernel/inventory/inventory-costing.js'
import {
  KITTING_WORK_ORDER_ENTITY, dedicationRule, explodeWithScrap, kittingRequirements, kittingWorkOrderCode, workOrderDayKey,
  zCancelWorkOrder, zCompleteKittingWorkOrder, zOpenKittingWorkOrder, zWorkOrderAction,
} from '../../../kernel/inventory/inventory-wip.js'
import { denied, inventoryAuthority } from '../../../infrastructure/delegation.js'
import { enqueueOutbox, recordAudit } from '../../../infrastructure/evidence.js'
import { availableToPromiseFor } from './atp.js'
import { appendMovement } from './stock-ledger.js'
import { transferInTransaction } from './transfers.js'
import * as catalogRepo from '../adapters/catalog-repo.js'
import * as repo from '../adapters/inventory-repo.js'
import * as wipRepo from '../adapters/wip-repo.js'

// Kitting work orders (FR-177) inside SCM — port of apps/server
// kitting-work-order-service with the same codes, order of refusals and audit
// actions. OPEN explodes the recipe with its scrap allowance (BR-029) and FREEZES
// the result on the order, refuses an output that is not a FlowAccount finished
// set (BR-032) and checks components against ATP, not raw on-hand (FR-180).
// RELEASE stages the gross quantities at the line. COMPLETE consumes per-set ×
// attempts (assembled + scrapped), receives the sets at a blended landed unit
// cost (FR-175) and returns the unused buffer; fewer than planned lands
// BLOCKED_SHORTAGE. CANCEL puts staged stock back.

const failure = (status, code, details) => Object.assign(new Error(code), { status, code, retryable: false }, details === undefined ? {} : { details })
const iso = (value) => (value instanceof Date ? value.toISOString() : value)
const KIND = 'kitting'

function parseLines(json) {
  try {
    const value = JSON.parse(json || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}
export const kittingDto = (row) => ({ ...row, plannedLines: parseLines(row.plannedLinesJson), plannedLinesJson: undefined })

function evidence(sql, scope, { entityId, action, business, payload, version, ctx }) {
  recordAudit(sql, { entityType: KITTING_WORK_ORDER_ENTITY, entityId, action, actorId: scope.actorId, tenantId: business.tenantId, businessId: business.id, requestId: ctx.requestId, now: ctx.now, payload })
  enqueueOutbox(sql, { topic: `scm.inventory.${action.toLowerCase().replace(/_/g, '-')}`, aggregateType: KITTING_WORK_ORDER_ENTITY, aggregateId: entityId, aggregateVersion: version, now: ctx.now, payload: { businessId: business.id, workOrderId: entityId } })
}

function nextCode(sql, business, now) {
  const count = wipRepo.workOrderCodeCount(sql, KIND, business.tenantId, `KWO-${workOrderDayKey(now)}-`)
  for (let seq = count + 1; seq < count + 200; seq += 1) {
    const code = kittingWorkOrderCode(now, seq)
    if (!wipRepo.workOrderCodeTaken(sql, KIND, business.tenantId, code)) return code
  }
  throw failure(409, 'KITTING_WORK_ORDER_CODE_EXHAUSTED')
}

const unitCostOf = (sql, productId) => weightedAverageUnitCostSatang(wipRepo.receiptsOf(sql, productId))
/** How many of a component the attempts consumed, from the frozen line. */
const perAttempt = (line, attempts) => (line.fixed ? line.grossQty : Math.ceil((line.qtyPerBatch * attempts) / line.batchSize - 1e-9))

export const openerOf = (scope, body) => inventoryAuthority.require(scope, zOpenKittingWorkOrder.parse(body).businessId, { write: true }).id
export function actorOf(sql, scope, id, body) {
  const data = zWorkOrderAction.parse(body)
  const business = inventoryAuthority.require(scope, data.businessId, { write: true })
  const order = typeof id === 'string' && id.trim() ? wipRepo.workOrderById(sql, KIND, id.trim()) : null
  if (!order || order.businessId !== business.id) throw denied()
  return business.id
}

function loadOrder(sql, scope, id, businessId) {
  const order = typeof id === 'string' && id.trim() ? wipRepo.workOrderById(sql, KIND, id.trim()) : null
  if (!order) throw denied()
  const business = inventoryAuthority.require(scope, businessId, { write: true })
  if (order.businessId !== business.id) throw denied()
  return { order, business }
}

export function openKittingWorkOrder(sql, scope, input, ctx) {
  const data = zOpenKittingWorkOrder.parse(input)
  const business = inventoryAuthority.require(scope, data.businessId, { write: true })
  const recipe = wipRepo.recipeById(sql, data.recipeId)
  if (!recipe || recipe.businessId !== business.id) throw failure(422, 'PRODUCT_RECIPE_NOT_FOUND')
  if (recipe.status === 'ARCHIVED') throw failure(409, 'PRODUCT_RECIPE_ARCHIVED')

  const finished = catalogRepo.byId(sql, 'product', recipe.productId)
  if (!finished || finished.businessId !== business.id) throw failure(422, 'INVENTORY_PRODUCT_NOT_FOUND')
  if (finished.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
  if (finished.stockPolicy !== 'TRACKED') throw failure(422, 'INVENTORY_PRODUCT_UNTRACKED')
  if (finished.trackingMode === 'SERIAL') throw failure(422, 'INVENTORY_RECIPE_SERIAL_OUTPUT')
  // BR-032 — the code that will reach an invoice must be a FlowAccount set.
  const flowAccountSku = finished.flowAccountSku ?? null
  if (!flowAccountSku) throw failure(422, 'INVENTORY_FINISHED_SET_SKU_MISSING', { code: finished.code })
  if (!isFinishedSetSku(flowAccountSku)) throw failure(422, 'INVENTORY_FINISHED_SET_SKU_INVALID', { code: finished.code, flowAccountSku })
  if (finished.trackingMode === 'LOT' && !data.outputLotCode) throw failure(422, 'INVENTORY_LOT_REQUIRED')

  const explosion = explodeWithScrap(explodeRecipe(recipe, data.plannedQty), recipe.scrapAllowanceFactor)
  const byId = new Map()
  for (const line of explosion.lines) {
    const component = catalogRepo.byId(sql, 'product', line.componentProductId)
    if (!component || component.businessId !== business.id) throw failure(422, 'PRODUCT_NOT_FOUND')
    if (component.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
    if (component.stockPolicy === 'TRACKED' && component.trackingMode === 'SERIAL') throw failure(422, 'INVENTORY_RECIPE_SERIAL_COMPONENT')
    // BR-028 — a branded component may only be built into the order it was branded for.
    const dedication = dedicationRule(component, { customerId: data.customerId ?? null, salesOrderId: data.salesOrderId ?? null, allowUndedicated: false })
    if (!dedication.ok) throw failure(409, dedication.code, { componentProductId: component.id, code: component.code })
    byId.set(component.id, component)
  }

  // FR-180 — availability is ATP, not on-hand.
  const atp = availableToPromiseFor(sql, scope, { businessId: business.id, productIds: explosion.lines.map((l) => l.componentProductId), now: ctx.now })
  const requirements = kittingRequirements(explosion, atp.byProductId)
  if (!requirements.canBuild) {
    const short = requirements.lines.filter((l) => l.shortage > 0).map((l) => ({ componentProductId: l.componentProductId, code: byId.get(l.componentProductId)?.code ?? null, required: l.grossQty, available: l.available, shortage: l.shortage }))
    throw failure(409, 'INVENTORY_KITTING_SHORTAGE', short)
  }
  const frozen = requirements.lines.map((line) => ({
    componentProductId: line.componentProductId, code: byId.get(line.componentProductId)?.code ?? null,
    qtyPerBatch: line.qty, batchSize: recipe.batchSize, fixed: Boolean(line.fixed), netQty: line.netQty, grossQty: line.grossQty,
  }))

  const code = nextCode(sql, business, ctx.now)
  const created = wipRepo.insertWorkOrder(sql, KIND, {
    code, tenantId: business.tenantId, businessId: business.id, salesOrderId: data.salesOrderId ?? null, customerId: data.customerId ?? null,
    recipeId: recipe.id, finishedProductId: finished.id, plannedQty: data.plannedQty, assembledQty: 0, scrapQty: 0,
    laborCostSatang: data.laborCostSatang ?? 0, unitCostSatang: null, plannedLinesJson: JSON.stringify(frozen), status: 'DRAFT',
    sourceLocationId: data.sourceLocationId ?? null, wipLocationId: data.wipLocationId ?? null, targetLocationId: data.targetLocationId ?? null,
    scrapLocationId: data.scrapLocationId ?? null, outputLotCode: data.outputLotCode ?? null, notes: data.notes ?? null,
    createdByPersonId: scope.actorId, createdAt: ctx.now, updatedAt: ctx.now,
  })
  evidence(sql, scope, {
    entityId: created.id, action: 'KITTING_WORK_ORDER_OPENED', business, version: 1, ctx,
    payload: { businessId: business.id, code, recipeId: recipe.id, recipeCode: recipe.code, finishedProductId: finished.id, finishedCode: finished.code, plannedQty: data.plannedQty, scrapAllowanceFactor: recipe.scrapAllowanceFactor, lines: frozen, flowAccountSku, customerId: created.customerId, salesOrderId: created.salesOrderId },
  })
  return { response: { order: kittingDto(created) }, affected: { workOrderId: created.id, version: created.version } }
}

function release(sql, scope, id, data, ctx) {
  const { order, business } = loadOrder(sql, scope, id, data.businessId)
  if (order.version !== data.version) throw failure(409, 'KITTING_WORK_ORDER_VERSION_CONFLICT')
  if (order.status !== 'DRAFT') throw failure(409, 'KITTING_WORK_ORDER_ALREADY_RELEASED')
  const occurredAt = iso(data.occurredAt) ?? ctx.now
  const staged = []
  for (const line of parseLines(order.plannedLinesJson)) {
    if (line.grossQty <= 0) continue
    if (order.sourceLocationId && order.wipLocationId) {
      transferInTransaction(sql, scope, { productId: line.componentProductId, sourceLocationId: order.sourceLocationId, targetLocationId: order.wipLocationId, quantity: line.grossQty, reason: 'KITTING_ISSUE', reference: `KWO:${order.code}`, occurredAt }, { business, workOrderId: order.id, now: ctx.now, requestId: ctx.requestId })
    } else {
      const onHand = repo.onHandOf(sql, line.componentProductId)
      if (onHand < line.grossQty) throw failure(409, 'INVENTORY_INSUFFICIENT_STOCK', { componentProductId: line.componentProductId, required: line.grossQty, onHand })
    }
    staged.push({ componentProductId: line.componentProductId, quantity: line.grossQty })
  }
  if (wipRepo.casWorkOrder(sql, KIND, { id: order.id, version: order.version, change: { status: 'IN_PROGRESS', startedAt: occurredAt }, now: ctx.now }) !== 1) throw failure(409, 'KITTING_WORK_ORDER_VERSION_CONFLICT')
  evidence(sql, scope, { entityId: order.id, action: 'KITTING_WORK_ORDER_RELEASED', business, version: order.version + 1, ctx, payload: { businessId: business.id, code: order.code, staged, version: order.version + 1 } })
  const fresh = wipRepo.workOrderById(sql, KIND, order.id)
  return { response: { order: kittingDto(fresh) }, affected: { workOrderId: order.id, version: fresh.version, status: fresh.status } }
}

function complete(sql, scope, id, data, ctx) {
  const { order, business } = loadOrder(sql, scope, id, data.businessId)
  if (order.version !== data.version) throw failure(409, 'KITTING_WORK_ORDER_VERSION_CONFLICT')
  if (order.status === 'COMPLETED') throw failure(409, 'KITTING_WORK_ORDER_COMPLETED')
  if (order.status === 'CANCELLED') throw failure(409, 'KITTING_WORK_ORDER_CANCELLED')
  if (order.status === 'DRAFT') throw failure(409, 'KITTING_WORK_ORDER_NOT_RELEASED')

  const scrapQty = data.scrapQty ?? 0
  const attempts = data.assembledQty + scrapQty
  const lines = parseLines(order.plannedLinesJson)
  // A run may not DELIVER more than planned, but may ATTEMPT more: what bounds attempts is the stock staged (BR-029).
  const allowedAttempts = lines
    .filter((line) => !line.fixed && line.qtyPerBatch > 0)
    .reduce((limit, line) => Math.min(limit, Math.floor((line.grossQty * line.batchSize) / line.qtyPerBatch)), Number.POSITIVE_INFINITY)
  if (data.assembledQty > order.plannedQty) throw failure(409, 'KITTING_WORK_ORDER_OVER_ASSEMBLED', { plannedQty: order.plannedQty, assembledQty: data.assembledQty })
  if (Number.isFinite(allowedAttempts) && attempts > allowedAttempts) throw failure(409, 'KITTING_WORK_ORDER_OVER_ISSUED', { attempts, allowedAttempts })

  const finished = catalogRepo.byId(sql, 'product', order.finishedProductId)
  if (!finished || finished.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
  const occurredAt = iso(data.occurredAt) ?? ctx.now
  const reference = `KWO:${order.code}`
  const shared = { businessId: business.id, reference, occurredAt, customerId: order.customerId ?? null, salesOrderId: order.salesOrderId ?? null, workOrderId: order.id, requestId: ctx.requestId }

  // 1. Consume what the attempts used — a ruined set still ate its components.
  const consumed = []
  const costLines = []
  for (const line of lines) {
    const useQty = perAttempt(line, attempts)
    const qtyPerSet = line.fixed ? (data.assembledQty > 0 ? line.grossQty / data.assembledQty : 0) : line.qtyPerBatch / line.batchSize
    costLines.push({ productId: line.componentProductId, unitCostSatang: unitCostOf(sql, line.componentProductId), qtyPerSet })
    if (useQty <= 0) continue
    const result = appendMovement(sql, scope, { ...shared, productId: line.componentProductId, kind: 'ISSUE', quantity: useQty, reason: 'KITTING_CONSUMED', sourceLocationId: order.wipLocationId ?? order.sourceLocationId ?? null }, { now: ctx.now })
    consumed.push({ componentProductId: line.componentProductId, quantity: useQty, onHandAfter: result.onHandAfter })
  }
  // 2. The sets arrive carrying every component's landed cost plus the labour amortised across the run (FR-175).
  const blended = kittedUnitCostSatang({ components: costLines, laborCostSatang: order.laborCostSatang, batchQty: Math.max(1, data.assembledQty) })
  const produced = data.assembledQty > 0
    ? appendMovement(sql, scope, { ...shared, productId: finished.id, kind: 'RECEIPT', quantity: data.assembledQty, reason: 'KITTING_PRODUCED', targetLocationId: order.targetLocationId ?? null, costSatang: blended.complete ? blended.unitCostSatang : null, ...(finished.trackingMode === 'LOT' ? { lotCode: order.outputLotCode } : {}) }, { now: ctx.now })
    : null
  // 3. The buffer nobody needed goes back.
  const returned = []
  if (order.sourceLocationId && order.wipLocationId) {
    for (const line of lines) {
      const unused = line.grossQty - perAttempt(line, attempts)
      if (unused <= 0) continue
      transferInTransaction(sql, scope, { productId: line.componentProductId, sourceLocationId: order.wipLocationId, targetLocationId: order.sourceLocationId, quantity: unused, reason: 'KITTING_BUFFER_RETURNED', reference, occurredAt }, { business, workOrderId: order.id, now: ctx.now, requestId: ctx.requestId })
      returned.push({ componentProductId: line.componentProductId, quantity: unused })
    }
  }

  const blocked = data.assembledQty < order.plannedQty
  const change = { status: blocked ? 'BLOCKED_SHORTAGE' : 'COMPLETED', assembledQty: data.assembledQty, scrapQty, unitCostSatang: blended.complete ? blended.unitCostSatang : null, completedAt: blocked ? null : occurredAt }
  ctx.faults?.beforeOrderUpdate?.()
  if (wipRepo.casWorkOrder(sql, KIND, { id: order.id, version: order.version, change, now: ctx.now }) !== 1) throw failure(409, 'KITTING_WORK_ORDER_VERSION_CONFLICT')
  evidence(sql, scope, {
    entityId: order.id, action: blocked ? 'KITTING_WORK_ORDER_BLOCKED' : 'KITTING_WORK_ORDER_COMPLETED', business, version: order.version + 1, ctx,
    payload: { businessId: business.id, code: order.code, finishedProductId: finished.id, finishedCode: finished.code, plannedQty: order.plannedQty, assembledQty: data.assembledQty, scrapQty, attempts, unitCostSatang: blended.unitCostSatang, componentsSatang: blended.componentsSatang, laborPerUnitSatang: blended.laborPerUnitSatang, costComplete: blended.complete, consumed, returned, version: order.version + 1 },
  })
  const fresh = wipRepo.workOrderById(sql, KIND, order.id)
  return { response: { order: kittingDto(fresh), consumed, produced, returned, unitCost: blended }, affected: { workOrderId: order.id, version: fresh.version, status: fresh.status } }
}

function cancel(sql, scope, id, data, ctx) {
  const { order, business } = loadOrder(sql, scope, id, data.businessId)
  if (order.version !== data.version) throw failure(409, 'KITTING_WORK_ORDER_VERSION_CONFLICT')
  if (order.status === 'COMPLETED') throw failure(409, 'KITTING_WORK_ORDER_COMPLETED')
  if (order.status === 'CANCELLED') throw failure(409, 'KITTING_WORK_ORDER_CANCELLED')
  const occurredAt = iso(data.occurredAt) ?? ctx.now
  const returned = []
  if (order.status === 'IN_PROGRESS' && order.sourceLocationId && order.wipLocationId) {
    for (const line of parseLines(order.plannedLinesJson)) {
      if (line.grossQty <= 0) continue
      transferInTransaction(sql, scope, { productId: line.componentProductId, sourceLocationId: order.wipLocationId, targetLocationId: order.sourceLocationId, quantity: line.grossQty, reason: 'KITTING_CANCELLED', reference: `KWO:${order.code}`, occurredAt }, { business, workOrderId: order.id, now: ctx.now, requestId: ctx.requestId })
      returned.push({ componentProductId: line.componentProductId, quantity: line.grossQty })
    }
  }
  if (wipRepo.casWorkOrder(sql, KIND, { id: order.id, version: order.version, change: { status: 'CANCELLED', cancelledAt: occurredAt }, now: ctx.now }) !== 1) throw failure(409, 'KITTING_WORK_ORDER_VERSION_CONFLICT')
  evidence(sql, scope, { entityId: order.id, action: 'KITTING_WORK_ORDER_CANCELLED', business, version: order.version + 1, ctx, payload: { businessId: business.id, code: order.code, returned, reason: data.reason ?? null, version: order.version + 1 } })
  const fresh = wipRepo.workOrderById(sql, KIND, order.id)
  return { response: { order: kittingDto(fresh), returned }, affected: { workOrderId: order.id, version: fresh.version, status: fresh.status } }
}

/** The kitting half of the FR-182 dispatcher; same vocabulary, same reason. */
export function applyKittingWorkOrderAction(sql, scope, id, input, ctx) {
  const data = zWorkOrderAction.parse(input)
  const rest = { businessId: data.businessId, version: data.version, reason: data.reason ?? null, ...(data.occurredAt ? { occurredAt: data.occurredAt } : {}) }
  if (data.action === 'RELEASE') return release(sql, scope, id, zCancelWorkOrder.parse(rest), ctx)
  if (data.action === 'CANCEL') return cancel(sql, scope, id, zCancelWorkOrder.parse(rest), ctx)
  return complete(sql, scope, id, zCompleteKittingWorkOrder.parse({
    businessId: data.businessId, version: data.version, assembledQty: data.assembledQty ?? 0,
    ...(data.scrapQty !== undefined ? { scrapQty: data.scrapQty } : {}), reason: data.reason ?? null, ...(data.occurredAt ? { occurredAt: data.occurredAt } : {}),
  }), ctx)
}

export function listKittingWorkOrders(sql, scope, { businessId, status, salesOrderId } = {}) {
  const business = inventoryAuthority.require(scope, typeof businessId === 'string' ? businessId.trim() : '')
  return wipRepo.workOrdersOf(sql, KIND, business.id, { status: status || undefined, salesOrderId: salesOrderId || undefined }).map(kittingDto)
}

export function getKittingWorkOrder(sql, scope, id) {
  const row = typeof id === 'string' && id.trim() ? wipRepo.workOrderById(sql, KIND, id.trim()) : null
  if (!row || row.tenantId !== scope.tenantId) throw denied()
  inventoryAuthority.require(scope, row.businessId)
  return kittingDto(row)
}
