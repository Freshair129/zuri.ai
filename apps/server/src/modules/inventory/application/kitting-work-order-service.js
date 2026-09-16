import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { explodeRecipe, stockOnHand } from '../domain/inventory'
import { isFinishedSetSku, kittedUnitCostSatang, weightedAverageUnitCostSatang } from '../domain/inventory-costing'
import { flowAccountSkuOf } from './inventory-catalog-service'
import {
  KITTING_WORK_ORDER_ENTITY,
  dedicationRule,
  explodeWithScrap,
  kittingRequirements,
  kittingWorkOrderCode,
  workOrderDayKey,
  zCancelWorkOrder,
  zCompleteKittingWorkOrder,
  zOpenKittingWorkOrder,
  zWorkOrderAction,
} from '../domain/inventory-wip'
import { loadBusiness, notFound } from './inventory-authority'
import { availableToPromiseFor } from './inventory-atp-service'
import { appendMovement } from './inventory-stock-service'
import { transferInTransaction } from './location-transfer-service'

// @req FR-177 — the only writer of `KittingWorkOrder`: the assembly of one
//   finished gift set from one bill of materials.
//
//   OPEN explodes the recipe with its declared scrap allowance (BR-029) and
//   FREEZES the result on the order (`plannedLinesJson`), so a recipe edited
//   between release and completion cannot silently change what this run is
//   reconciled against. It refuses an output SKU that is not a FlowAccount
//   finished set (BR-032) and checks availability against ATP rather than raw
//   on-hand (FR-180), so a run cannot be opened on components another quote
//   already promised. RELEASE stages the gross quantities at the assembly
//   line. COMPLETE consumes what the attempts actually used, receives the
//   assembled sets at the finished-goods location with a blended landed unit
//   cost (FR-175), and returns the unused buffer.
//
//   Components consumed = per-set × attempts, where attempts = assembled +
//   scrapped sets: a set that was ruined during assembly still ate its
//   tumbler.
// @spec ADR-074 D5; BR-029; BR-032; BR-027; BR-028; BR-002; SEC-001; FR-072; FR-155; FR-156
// @tested tests/integration/fr177-kitting-work-order.test.js

const failure = (status, message) => Object.assign(new Error(message), { status })
const actor = (viewer) => viewer?.principal?.id ?? null

/**
 * Run in the caller's transaction when there is one, else open our own. The
 * agent's Gate F action gate hands its own `tx` down (ADR-074 D9), and a
 * nested `$transaction` on a second client would deadlock against it.
 */
const inTx = (db, fn) => (typeof db?.$transaction === 'function' ? db.$transaction(fn) : fn(db))

export const KWO_SELECT = {
  id: true, code: true, tenantId: true, businessId: true, salesOrderId: true, customerId: true,
  recipeId: true, finishedProductId: true, plannedQty: true, assembledQty: true, scrapQty: true,
  laborCostSatang: true, unitCostSatang: true, plannedLinesJson: true, status: true,
  sourceLocationId: true, wipLocationId: true, targetLocationId: true, scrapLocationId: true, outputLotCode: true,
  startedAt: true, completedAt: true, cancelledAt: true, notes: true,
  createdByPersonId: true, createdAt: true, updatedAt: true, version: true,
}
const RECIPE_SELECT = {
  id: true, code: true, businessId: true, productId: true, name: true, batchSize: true, yieldQty: true,
  status: true, scrapAllowanceFactor: true,
  lines: { select: { componentProductId: true, qty: true, unit: true, fixed: true }, orderBy: { id: 'asc' } },
}
const PRODUCT_SELECT = {
  id: true, code: true, businessId: true, status: true, stockPolicy: true, trackingMode: true, unit: true,
  itemKind: true, dedicatedCustomerId: true, dedicatedSalesOrderId: true,
}

const parseLines = (json) => {
  try {
    const value = JSON.parse(json || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

export const kittingDto = (row) => ({ ...row, plannedLines: parseLines(row.plannedLinesJson), plannedLinesJson: undefined })

async function nextCode(tx, business, now) {
  const prefix = `KWO-${workOrderDayKey(now)}-`
  const count = await tx.kittingWorkOrder.count({ where: { tenantId: business.tenantId, code: { startsWith: prefix } } })
  for (let seq = count + 1; seq < count + 200; seq += 1) {
    const code = kittingWorkOrderCode(now, seq)
    const taken = await tx.kittingWorkOrder.findUnique({ where: { tenantId_code: { tenantId: business.tenantId, code } }, select: { id: true } })
    if (!taken) return code
  }
  throw failure(409, 'KITTING_WORK_ORDER_CODE_EXHAUSTED')
}

async function unitCostOf(tx, productId) {
  const receipts = await tx.stockMovement.findMany({ where: { productId, kind: 'RECEIPT' }, select: { quantity: true, costSatang: true } })
  return weightedAverageUnitCostSatang(receipts)
}

/** How many of a component one *attempt* at a set consumes, from the frozen line. */
const perAttempt = (line, attempts) => (line.fixed ? line.grossQty : Math.ceil((line.qtyPerBatch * attempts) / line.batchSize - 1e-9))

export async function openKittingWorkOrder(input, { viewer, db = prisma, now = new Date() } = {}) {
  const data = zOpenKittingWorkOrder.parse(input)
  return inTx(db, async (tx) => {
    const business = await loadBusiness(tx, viewer, data.businessId, { write: true })
    const recipe = await tx.productRecipe.findUnique({ where: { id: data.recipeId }, select: RECIPE_SELECT })
    if (!recipe || recipe.businessId !== business.id) throw failure(422, 'PRODUCT_RECIPE_NOT_FOUND')
    if (recipe.status === 'ARCHIVED') throw failure(409, 'PRODUCT_RECIPE_ARCHIVED')

    const finished = await tx.product.findUnique({ where: { id: recipe.productId }, select: PRODUCT_SELECT })
    if (!finished || finished.businessId !== business.id) throw failure(422, 'INVENTORY_PRODUCT_NOT_FOUND')
    if (finished.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
    if (finished.stockPolicy !== 'TRACKED') throw failure(422, 'INVENTORY_PRODUCT_UNTRACKED')
    if (finished.trackingMode === 'SERIAL') throw failure(422, 'INVENTORY_RECIPE_SERIAL_OUTPUT')
    // BR-032 — the code that will reach an invoice must be a FlowAccount set.
    // It is FlowAccount's id for our product, not ours, so it lives on
    // `ExternalRef` (BR-002) and not on `Product.code` — whose own pattern
    // deliberately has no room for the parentheses a set code carries.
    const flowAccountSku = await flowAccountSkuOf(tx, finished.id)
    if (!flowAccountSku) throw Object.assign(failure(422, 'INVENTORY_FINISHED_SET_SKU_MISSING'), { details: { code: finished.code } })
    if (!isFinishedSetSku(flowAccountSku)) throw Object.assign(failure(422, 'INVENTORY_FINISHED_SET_SKU_INVALID'), { details: { code: finished.code, flowAccountSku } })
    if (finished.trackingMode === 'LOT' && !data.outputLotCode) throw failure(422, 'INVENTORY_LOT_REQUIRED')

    const explosion = explodeWithScrap(explodeRecipe(recipe, data.plannedQty), recipe.scrapAllowanceFactor)
    const components = await tx.product.findMany({ where: { id: { in: explosion.lines.map((l) => l.componentProductId) } }, select: PRODUCT_SELECT })
    const byId = new Map(components.map((c) => [c.id, c]))
    for (const line of explosion.lines) {
      const component = byId.get(line.componentProductId)
      if (!component || component.businessId !== business.id) throw failure(422, 'PRODUCT_NOT_FOUND')
      if (component.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
      if (component.stockPolicy === 'TRACKED' && component.trackingMode === 'SERIAL') throw failure(422, 'INVENTORY_RECIPE_SERIAL_COMPONENT')
      // BR-028 — a branded component may only be built into the order it was
      // branded for. This is the assembly-line half of the same refusal the
      // ledger makes on issue.
      const dedication = dedicationRule(component, { customerId: data.customerId ?? null, salesOrderId: data.salesOrderId ?? null, allowUndedicated: false })
      if (!dedication.ok) throw Object.assign(failure(409, dedication.code), { details: { componentProductId: component.id, code: component.code } })
    }

    // FR-180 — availability is ATP, not on-hand: a component another quote has
    // already promised is not available to this build.
    const atp = await availableToPromiseFor({ businessId: business.id, productIds: explosion.lines.map((l) => l.componentProductId), viewer, db: tx, now })
    const requirements = kittingRequirements(explosion, atp.byProductId)
    if (!requirements.canBuild) {
      const short = requirements.lines.filter((l) => l.shortage > 0).map((l) => ({ componentProductId: l.componentProductId, code: byId.get(l.componentProductId)?.code ?? null, required: l.grossQty, available: l.available, shortage: l.shortage }))
      throw Object.assign(failure(409, 'INVENTORY_KITTING_SHORTAGE'), { details: short })
    }

    const frozen = requirements.lines.map((line) => ({
      componentProductId: line.componentProductId,
      code: byId.get(line.componentProductId)?.code ?? null,
      qtyPerBatch: line.qty,
      batchSize: recipe.batchSize,
      fixed: Boolean(line.fixed),
      netQty: line.netQty,
      grossQty: line.grossQty,
    }))

    const code = await nextCode(tx, business, now)
    const created = await tx.kittingWorkOrder.create({
      data: {
        code, tenantId: business.tenantId, businessId: business.id,
        salesOrderId: data.salesOrderId ?? null, customerId: data.customerId ?? null,
        recipeId: recipe.id, finishedProductId: finished.id, plannedQty: data.plannedQty,
        laborCostSatang: data.laborCostSatang ?? 0,
        plannedLinesJson: JSON.stringify(frozen),
        sourceLocationId: data.sourceLocationId ?? null,
        wipLocationId: data.wipLocationId ?? null,
        targetLocationId: data.targetLocationId ?? null,
        scrapLocationId: data.scrapLocationId ?? null,
        outputLotCode: data.outputLotCode ?? null,
        notes: data.notes ?? null,
        createdByPersonId: actor(viewer),
      },
      select: KWO_SELECT,
    })
    await recordAudit(tx, {
      entityType: KITTING_WORK_ORDER_ENTITY, entityId: created.id, action: 'KITTING_WORK_ORDER_OPENED', actorId: actor(viewer),
      payload: {
        businessId: business.id, code, recipeId: recipe.id, recipeCode: recipe.code, finishedProductId: finished.id, finishedCode: finished.code,
        plannedQty: data.plannedQty, scrapAllowanceFactor: recipe.scrapAllowanceFactor, lines: frozen, flowAccountSku,
        customerId: created.customerId, salesOrderId: created.salesOrderId,
      },
    })
    return kittingDto(created)
  })
}

/** Stage the frozen gross quantities at the assembly line. On-hand is unchanged. */
export async function releaseKittingWorkOrder(id, input, { viewer, db = prisma, now = new Date() } = {}) {
  const orderId = typeof id === 'string' ? id.trim() : ''
  if (!orderId) throw notFound()
  const data = zCancelWorkOrder.parse(input)
  return inTx(db, async (tx) => {
    const order = await tx.kittingWorkOrder.findUnique({ where: { id: orderId }, select: KWO_SELECT })
    if (!order) throw notFound()
    const business = await loadBusiness(tx, viewer, data.businessId, { write: true })
    if (order.businessId !== business.id) throw notFound()
    if (order.version !== data.version) throw failure(409, 'KITTING_WORK_ORDER_VERSION_CONFLICT')
    if (order.status !== 'DRAFT') throw failure(409, 'KITTING_WORK_ORDER_ALREADY_RELEASED')

    const occurredAt = data.occurredAt ?? now
    const lines = parseLines(order.plannedLinesJson)
    const staged = []
    for (const line of lines) {
      if (line.grossQty <= 0) continue
      if (order.sourceLocationId && order.wipLocationId) {
        await transferInTransaction(tx, {
          businessId: business.id, productId: line.componentProductId,
          sourceLocationId: order.sourceLocationId, targetLocationId: order.wipLocationId,
          quantity: line.grossQty, reason: 'KITTING_ISSUE', reference: `KWO:${order.code}`, occurredAt,
        }, { viewer, business, workOrderId: order.id })
      } else {
        const movements = await tx.stockMovement.findMany({ where: { productId: line.componentProductId }, select: { quantity: true } })
        const onHand = stockOnHand(movements)
        if (onHand < line.grossQty) throw Object.assign(failure(409, 'INVENTORY_INSUFFICIENT_STOCK'), { details: { componentProductId: line.componentProductId, required: line.grossQty, onHand } })
      }
      staged.push({ componentProductId: line.componentProductId, quantity: line.grossQty })
    }

    const updated = await tx.kittingWorkOrder.update({ where: { id: order.id }, data: { status: 'IN_PROGRESS', startedAt: occurredAt, version: { increment: 1 } }, select: KWO_SELECT })
    await recordAudit(tx, {
      entityType: KITTING_WORK_ORDER_ENTITY, entityId: order.id, action: 'KITTING_WORK_ORDER_RELEASED', actorId: actor(viewer),
      payload: { businessId: business.id, code: order.code, staged, version: order.version + 1 },
    })
    return kittingDto(updated)
  })
}

/**
 * Consume what the attempts used, receive the assembled sets at their blended
 * landed cost, and return the unused buffer.
 */
export async function completeKittingWorkOrder(id, input, { viewer, db = prisma, now = new Date() } = {}) {
  const orderId = typeof id === 'string' ? id.trim() : ''
  if (!orderId) throw notFound()
  const data = zCompleteKittingWorkOrder.parse(input)
  return inTx(db, async (tx) => {
    const order = await tx.kittingWorkOrder.findUnique({ where: { id: orderId }, select: KWO_SELECT })
    if (!order) throw notFound()
    const business = await loadBusiness(tx, viewer, data.businessId, { write: true })
    if (order.businessId !== business.id) throw notFound()
    if (order.version !== data.version) throw failure(409, 'KITTING_WORK_ORDER_VERSION_CONFLICT')
    if (order.status === 'COMPLETED') throw failure(409, 'KITTING_WORK_ORDER_COMPLETED')
    if (order.status === 'CANCELLED') throw failure(409, 'KITTING_WORK_ORDER_CANCELLED')
    if (order.status === 'DRAFT') throw failure(409, 'KITTING_WORK_ORDER_NOT_RELEASED')

    const scrapQty = data.scrapQty ?? 0
    const attempts = data.assembledQty + scrapQty
    const lines = parseLines(order.plannedLinesJson)
    // Two different ceilings, and they are not the same number. A run may not
    // DELIVER more sets than it planned — that is an order, not a target. But it
    // may ATTEMPT more than it planned, because the scrap buffer was issued
    // precisely so a ruined set could be replaced from the line; what bounds
    // attempts is the stock actually staged, not the plan (BR-029).
    const allowedAttempts = lines
      .filter((line) => !line.fixed && line.qtyPerBatch > 0)
      .reduce((limit, line) => Math.min(limit, Math.floor((line.grossQty * line.batchSize) / line.qtyPerBatch)), Number.POSITIVE_INFINITY)
    if (data.assembledQty > order.plannedQty) throw Object.assign(failure(409, 'KITTING_WORK_ORDER_OVER_ASSEMBLED'), { details: { plannedQty: order.plannedQty, assembledQty: data.assembledQty } })
    if (Number.isFinite(allowedAttempts) && attempts > allowedAttempts) {
      throw Object.assign(failure(409, 'KITTING_WORK_ORDER_OVER_ISSUED'), { details: { attempts, allowedAttempts } })
    }

    const finished = await tx.product.findUnique({ where: { id: order.finishedProductId }, select: PRODUCT_SELECT })
    if (!finished || finished.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')

    const occurredAt = data.occurredAt ?? now
    const reference = `KWO:${order.code}`

    // 1. Consume what the attempts actually used. A set ruined during assembly
    //    still ate its components, so `attempts` — not `assembledQty` — is the
    //    multiplier.
    const consumed = []
    const costLines = []
    for (const line of lines) {
      const useQty = perAttempt(line, attempts)
      const unitCostSatang = await unitCostOf(tx, line.componentProductId)
      // A scaled line costs its per-set quantity; a fixed line (one crate per
      // batch) spreads across the sets that were actually assembled.
      const qtyPerSet = line.fixed
        ? (data.assembledQty > 0 ? line.grossQty / data.assembledQty : 0)
        : line.qtyPerBatch / line.batchSize
      costLines.push({ productId: line.componentProductId, unitCostSatang, qtyPerSet })
      if (useQty <= 0) continue
      const result = await appendMovement(tx, {
        businessId: business.id, productId: line.componentProductId, kind: 'ISSUE', quantity: useQty,
        reason: 'KITTING_CONSUMED', reference, occurredAt,
        sourceLocationId: order.wipLocationId ?? order.sourceLocationId ?? null,
        customerId: order.customerId ?? null, salesOrderId: order.salesOrderId ?? null, workOrderId: order.id,
      }, { viewer })
      consumed.push({ componentProductId: line.componentProductId, quantity: useQty, onHandAfter: result.onHandAfter })
    }

    // 2. The sets arrive at finished goods, carrying every component's landed
    //    cost plus the assembly labour amortised across the run (FR-175).
    const blended = kittedUnitCostSatang({ components: costLines, laborCostSatang: order.laborCostSatang, batchQty: Math.max(1, data.assembledQty) })
    let produced = null
    if (data.assembledQty > 0) {
      produced = await appendMovement(tx, {
        businessId: business.id, productId: finished.id, kind: 'RECEIPT', quantity: data.assembledQty,
        reason: 'KITTING_PRODUCED', reference, occurredAt,
        targetLocationId: order.targetLocationId ?? null,
        costSatang: blended.complete ? blended.unitCostSatang : null,
        customerId: order.customerId ?? null, salesOrderId: order.salesOrderId ?? null, workOrderId: order.id,
        ...(finished.trackingMode === 'LOT' ? { lotCode: order.outputLotCode } : {}),
      }, { viewer })
    }

    // 3. The buffer nobody needed is still good stock and goes back.
    const returned = []
    if (order.sourceLocationId && order.wipLocationId) {
      for (const line of lines) {
        const unused = line.grossQty - perAttempt(line, attempts)
        if (unused <= 0) continue
        await transferInTransaction(tx, {
          businessId: business.id, productId: line.componentProductId,
          sourceLocationId: order.wipLocationId, targetLocationId: order.sourceLocationId,
          quantity: unused, reason: 'KITTING_BUFFER_RETURNED', reference, occurredAt,
        }, { viewer, business, workOrderId: order.id })
        returned.push({ componentProductId: line.componentProductId, quantity: unused })
      }
    }

    const blocked = data.assembledQty < order.plannedQty
    const updated = await tx.kittingWorkOrder.update({
      where: { id: order.id },
      data: {
        status: blocked ? 'BLOCKED_SHORTAGE' : 'COMPLETED',
        assembledQty: data.assembledQty, scrapQty,
        unitCostSatang: blended.complete ? blended.unitCostSatang : null,
        completedAt: blocked ? null : occurredAt,
        version: { increment: 1 },
      },
      select: KWO_SELECT,
    })
    await recordAudit(tx, {
      entityType: KITTING_WORK_ORDER_ENTITY, entityId: order.id,
      action: blocked ? 'KITTING_WORK_ORDER_BLOCKED' : 'KITTING_WORK_ORDER_COMPLETED', actorId: actor(viewer),
      payload: {
        businessId: business.id, code: order.code, finishedProductId: finished.id, finishedCode: finished.code,
        plannedQty: order.plannedQty, assembledQty: data.assembledQty, scrapQty, attempts,
        unitCostSatang: blended.unitCostSatang, componentsSatang: blended.componentsSatang, laborPerUnitSatang: blended.laborPerUnitSatang,
        costComplete: blended.complete, consumed, returned, version: order.version + 1,
      },
    })
    return { order: kittingDto(updated), consumed, produced, returned, unitCost: blended }
  })
}

export async function cancelKittingWorkOrder(id, input, { viewer, db = prisma, now = new Date() } = {}) {
  const orderId = typeof id === 'string' ? id.trim() : ''
  if (!orderId) throw notFound()
  const data = zCancelWorkOrder.parse(input)
  return inTx(db, async (tx) => {
    const order = await tx.kittingWorkOrder.findUnique({ where: { id: orderId }, select: KWO_SELECT })
    if (!order) throw notFound()
    const business = await loadBusiness(tx, viewer, data.businessId, { write: true })
    if (order.businessId !== business.id) throw notFound()
    if (order.version !== data.version) throw failure(409, 'KITTING_WORK_ORDER_VERSION_CONFLICT')
    if (order.status === 'COMPLETED') throw failure(409, 'KITTING_WORK_ORDER_COMPLETED')
    if (order.status === 'CANCELLED') throw failure(409, 'KITTING_WORK_ORDER_CANCELLED')

    const occurredAt = data.occurredAt ?? now
    const returned = []
    if (order.status === 'IN_PROGRESS' && order.sourceLocationId && order.wipLocationId) {
      for (const line of parseLines(order.plannedLinesJson)) {
        if (line.grossQty <= 0) continue
        await transferInTransaction(tx, {
          businessId: business.id, productId: line.componentProductId,
          sourceLocationId: order.wipLocationId, targetLocationId: order.sourceLocationId,
          quantity: line.grossQty, reason: 'KITTING_CANCELLED', reference: `KWO:${order.code}`, occurredAt,
        }, { viewer, business, workOrderId: order.id })
        returned.push({ componentProductId: line.componentProductId, quantity: line.grossQty })
      }
    }
    const updated = await tx.kittingWorkOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED', cancelledAt: occurredAt, version: { increment: 1 } }, select: KWO_SELECT })
    await recordAudit(tx, {
      entityType: KITTING_WORK_ORDER_ENTITY, entityId: order.id, action: 'KITTING_WORK_ORDER_CANCELLED', actorId: actor(viewer),
      payload: { businessId: business.id, code: order.code, returned, reason: data.reason ?? null, version: order.version + 1 },
    })
    return { order: kittingDto(updated), returned }
  })
}

export async function listKittingWorkOrders({ businessId, status, salesOrderId, viewer, db = prisma } = {}) {
  const business = await loadBusiness(db, viewer, businessId)
  const rows = await db.kittingWorkOrder.findMany({
    where: { businessId: business.id, ...(status ? { status } : {}), ...(salesOrderId ? { salesOrderId } : {}) },
    orderBy: [{ createdAt: 'desc' }],
    select: KWO_SELECT,
  })
  return rows.map(kittingDto)
}

export async function getKittingWorkOrder(id, { viewer, db = prisma } = {}) {
  const orderId = typeof id === 'string' ? id.trim() : ''
  if (!orderId) throw notFound()
  const row = await db.kittingWorkOrder.findUnique({ where: { id: orderId }, select: KWO_SELECT })
  if (!row) throw notFound()
  await loadBusiness(db, viewer, row.businessId)
  return kittingDto(row)
}

/** The kitting half of the FR-182 dispatcher; same vocabulary, same reason. */
export async function applyKittingWorkOrderAction(id, input, options = {}) {
  const data = zWorkOrderAction.parse(input)
  const rest = { businessId: data.businessId, version: data.version, reason: data.reason ?? null, ...(data.occurredAt ? { occurredAt: data.occurredAt } : {}) }
  if (data.action === 'RELEASE') return releaseKittingWorkOrder(id, rest, options)
  if (data.action === 'CANCEL') return cancelKittingWorkOrder(id, rest, options)
  return completeKittingWorkOrder(id, {
    businessId: data.businessId,
    version: data.version,
    assembledQty: data.assembledQty ?? 0,
    ...(data.scrapQty !== undefined ? { scrapQty: data.scrapQty } : {}),
    reason: data.reason ?? null,
    ...(data.occurredAt ? { occurredAt: data.occurredAt } : {}),
  }, options)
}
