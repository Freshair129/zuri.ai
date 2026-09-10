import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { PRODUCT_ENTITY } from '../domain/inventory'
import { customizationUnitCostSatang, weightedAverageUnitCostSatang } from '../domain/inventory-costing'
import {
  CUSTOMIZATION_WORK_ORDER_ENTITY,
  customizationCompletionRule,
  customizationWorkOrderCode,
  grossIssueQuantity,
  reconcileCustomizationRun,
  workOrderDayKey,
  zCancelWorkOrder,
  zCompleteCustomizationWorkOrder,
  zOpenCustomizationWorkOrder,
} from '../domain/inventory-wip'
import { loadBusiness, notFound } from './inventory-authority'
import { appendMovement } from './inventory-stock-service'
import { transferInTransaction } from './location-transfer-service'

// @req FR-176 — the only writer of `CustomizationWorkOrder`: the durable record
//   of blank hardware becoming a client's branded component.
//
//   OPEN computes the gross issue from the net order plus the declared scrap
//   allowance (BR-029) and, unless the caller names one, creates the branded
//   output SKU itself — `itemKind: CUSTOM_COMPONENT`, dedicated to that
//   customer and that sales order, which is what later makes it refusable
//   (BR-028). RELEASE moves the gross quantity from the raw store to the
//   workshop as a transfer, so on-hand is unchanged and only its location
//   moves. COMPLETE is the irreversible half, in one transaction: consume the
//   raw units that were worked on, issue the ruined ones out of stock, receive
//   the branded output with a landed cost that carries the raw cost plus this
//   run's amortised setup and per-piece run cost (FR-175), and put the unused
//   buffer back where it came from. A run that finished fewer than promised
//   lands in `BLOCKED_SHORTAGE` rather than quietly reading COMPLETED.
//
//   The raw SKU never comes back branded: that is why the output is a
//   different product row and not a flag. The only way out of a dedication is
//   an explicit ADJUSTMENT write-off, which a person decides and the audit
//   records.
// @spec ADR-074 D4; BR-028; BR-029; BR-002; SEC-001; FR-072; FR-155
// @tested tests/integration/fr176-customization-work-order.test.js

const failure = (status, message) => Object.assign(new Error(message), { status })
const actor = (viewer) => viewer?.principal?.id ?? null

/**
 * Run in the caller's transaction when there is one, else open our own. The
 * agent's Gate F action gate hands its own `tx` down (ADR-074 D9), and a
 * nested `$transaction` on a second client would deadlock against it.
 */
const inTx = (db, fn) => (typeof db?.$transaction === 'function' ? db.$transaction(fn) : fn(db))

export const CWO_SELECT = {
  id: true, code: true, tenantId: true, businessId: true, salesOrderId: true, customerId: true,
  rawProductId: true, outputProductId: true, technique: true, logoArtworkUrl: true, pantoneColorsJson: true,
  plannedQty: true, issuedQty: true, completedQty: true, scrapQty: true, scrapAllowanceFactor: true,
  setupCostSatang: true, runCostSatang: true, status: true,
  wipLocationId: true, scrapLocationId: true, sourceLocationId: true,
  scheduledDate: true, startedAt: true, completedAt: true, cancelledAt: true, notes: true,
  createdByPersonId: true, createdAt: true, updatedAt: true, version: true,
}
const PRODUCT_SELECT = {
  id: true, code: true, tenantId: true, businessId: true, productMasterId: true, name: true, unit: true,
  stockPolicy: true, trackingMode: true, status: true, itemKind: true, dedicatedCustomerId: true, dedicatedSalesOrderId: true,
  maintenanceIntervalDays: true, maxStorageDays: true, safetyStock: true,
}

const parsePantone = (json) => {
  try {
    const value = JSON.parse(json || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

export const customizationDto = (row) => ({
  ...row,
  pantoneColors: parsePantone(row.pantoneColorsJson),
  pantoneColorsJson: undefined,
  grossIssueQty: grossIssueQuantity(row.plannedQty, row.scrapAllowanceFactor),
  run: reconcileCustomizationRun(row),
})

async function nextCode(tx, business, now) {
  const prefix = `CWO-${workOrderDayKey(now)}-`
  const count = await tx.customizationWorkOrder.count({ where: { tenantId: business.tenantId, code: { startsWith: prefix } } })
  for (let seq = count + 1; seq < count + 200; seq += 1) {
    const code = customizationWorkOrderCode(now, seq)
    const taken = await tx.customizationWorkOrder.findUnique({ where: { tenantId_code: { tenantId: business.tenantId, code } }, select: { id: true } })
    if (!taken) return code
  }
  throw failure(409, 'CUSTOMIZATION_WORK_ORDER_CODE_EXHAUSTED')
}

async function requireProduct(tx, id, businessId, code = 'INVENTORY_PRODUCT_NOT_FOUND') {
  const product = await tx.product.findUnique({ where: { id }, select: PRODUCT_SELECT })
  if (!product || product.businessId !== businessId) throw failure(422, code)
  if (product.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
  return product
}

/** The raw SKU's landed unit cost, weighted across everything it has received (FR-175). */
async function rawUnitCostSatang(tx, productId) {
  const receipts = await tx.stockMovement.findMany({ where: { productId, kind: 'RECEIPT' }, select: { quantity: true, costSatang: true } })
  return weightedAverageUnitCostSatang(receipts)
}

/**
 * The branded SKU this run produces. Created here rather than asked of the
 * caller because it is not a catalogue decision a human makes: it is the same
 * hardware, dedicated, and its identity is the work order that branded it.
 */
async function createOutputProduct(tx, { business, raw, code, customerId, salesOrderId, technique, viewer }) {
  const created = await tx.product.create({
    data: {
      code,
      tenantId: business.tenantId,
      businessId: business.id,
      productMasterId: raw.productMasterId,
      name: raw.name ? `${raw.name} (${technique})` : null,
      unit: raw.unit,
      stockPolicy: 'TRACKED',
      trackingMode: raw.trackingMode,
      safetyStock: 0,
      itemKind: 'CUSTOM_COMPONENT',
      dedicatedCustomerId: customerId ?? null,
      dedicatedSalesOrderId: salesOrderId ?? null,
      maintenanceIntervalDays: raw.maintenanceIntervalDays,
      maxStorageDays: raw.maxStorageDays,
    },
    select: PRODUCT_SELECT,
  })
  await recordAudit(tx, {
    entityType: PRODUCT_ENTITY, entityId: created.id, action: 'PRODUCT_CREATED', actorId: actor(viewer),
    payload: { businessId: business.id, code: created.code, itemKind: 'CUSTOM_COMPONENT', dedicatedCustomerId: customerId ?? null, dedicatedSalesOrderId: salesOrderId ?? null, fromProductId: raw.id },
  })
  return created
}

export async function openCustomizationWorkOrder(input, { viewer, db = prisma, now = new Date() } = {}) {
  const data = zOpenCustomizationWorkOrder.parse(input)
  return inTx(db, async (tx) => {
    const business = await loadBusiness(tx, viewer, data.businessId, { write: true })
    const raw = await requireProduct(tx, data.rawProductId, business.id)
    if (raw.stockPolicy !== 'TRACKED') throw failure(422, 'INVENTORY_PRODUCT_UNTRACKED')
    // A serial-tracked blank would need every unit mapped to a branded unit,
    // and a work order cannot choose serials. Refused rather than guessed.
    if (raw.trackingMode === 'SERIAL') throw failure(422, 'INVENTORY_CUSTOMIZATION_SERIAL_UNSUPPORTED')
    if (raw.itemKind === 'CUSTOM_COMPONENT') throw failure(409, 'INVENTORY_CUSTOM_COMPONENT_ALREADY_BRANDED')

    const code = await nextCode(tx, business, now)
    let output = null
    if (data.outputProductId) {
      output = await requireProduct(tx, data.outputProductId, business.id, 'INVENTORY_OUTPUT_PRODUCT_NOT_FOUND')
      if (output.itemKind !== 'CUSTOM_COMPONENT') throw failure(422, 'INVENTORY_OUTPUT_NOT_CUSTOM_COMPONENT')
      if (output.id === raw.id) throw failure(422, 'INVENTORY_CUSTOMIZATION_SELF_OUTPUT')
      // A named output must already belong to this customer and order, or the
      // run would put one client's logo into another client's locked stock.
      if (data.customerId && output.dedicatedCustomerId && output.dedicatedCustomerId !== data.customerId) throw failure(409, 'INVENTORY_CUSTOM_COMPONENT_WRONG_CUSTOMER')
      if (data.salesOrderId && output.dedicatedSalesOrderId && output.dedicatedSalesOrderId !== data.salesOrderId) throw failure(409, 'INVENTORY_CUSTOM_COMPONENT_WRONG_SALES_ORDER')
    } else {
      const outputCode = `${raw.code}-${code}`.slice(0, 64)
      const taken = await tx.product.findUnique({ where: { tenantId_code: { tenantId: business.tenantId, code: outputCode } }, select: { id: true } })
      if (taken) throw failure(409, 'PRODUCT_CODE_TAKEN')
      output = await createOutputProduct(tx, { business, raw, code: outputCode, customerId: data.customerId ?? null, salesOrderId: data.salesOrderId ?? null, technique: data.technique, viewer })
    }

    const created = await tx.customizationWorkOrder.create({
      data: {
        code, tenantId: business.tenantId, businessId: business.id,
        salesOrderId: data.salesOrderId ?? null, customerId: data.customerId ?? null,
        rawProductId: raw.id, outputProductId: output.id, technique: data.technique,
        logoArtworkUrl: data.logoArtworkUrl ?? null,
        pantoneColorsJson: data.pantoneColors?.length ? JSON.stringify(data.pantoneColors) : null,
        plannedQty: data.netQuantity,
        scrapAllowanceFactor: data.scrapAllowanceFactor ?? 0.02,
        setupCostSatang: data.setupCostSatang ?? 0,
        runCostSatang: data.runCostSatang ?? 0,
        sourceLocationId: data.sourceLocationId ?? null,
        wipLocationId: data.wipLocationId ?? null,
        scrapLocationId: data.scrapLocationId ?? null,
        scheduledDate: data.scheduledDate ?? null,
        notes: data.notes ?? null,
        createdByPersonId: actor(viewer),
      },
      select: CWO_SELECT,
    })
    await recordAudit(tx, {
      entityType: CUSTOMIZATION_WORK_ORDER_ENTITY, entityId: created.id, action: 'CUSTOMIZATION_WORK_ORDER_OPENED', actorId: actor(viewer),
      payload: {
        businessId: business.id, code, rawProductId: raw.id, rawCode: raw.code, outputProductId: output.id, outputCode: output.code,
        technique: created.technique, plannedQty: created.plannedQty, grossIssueQty: grossIssueQuantity(created.plannedQty, created.scrapAllowanceFactor),
        customerId: created.customerId, salesOrderId: created.salesOrderId,
      },
    })
    return customizationDto(created)
  })
}

/**
 * Move the gross quantity (net + scrap buffer) from the raw store to the
 * workshop. On-hand is unchanged; only where the stock is changes. When the
 * order names no locations the stock stays where it is and only the order's
 * `issuedQty` is recorded — a Business that has not modelled its locations
 * yet still gets a work order that reconciles.
 */
export async function releaseCustomizationWorkOrder(id, input, { viewer, db = prisma, now = new Date() } = {}) {
  const orderId = typeof id === 'string' ? id.trim() : ''
  if (!orderId) throw notFound()
  const data = zCancelWorkOrder.parse(input)
  return inTx(db, async (tx) => {
    const order = await tx.customizationWorkOrder.findUnique({ where: { id: orderId }, select: CWO_SELECT })
    if (!order) throw notFound()
    const business = await loadBusiness(tx, viewer, data.businessId, { write: true })
    if (order.businessId !== business.id) throw notFound()
    if (order.version !== data.version) throw failure(409, 'CUSTOMIZATION_WORK_ORDER_VERSION_CONFLICT')
    if (order.status !== 'DRAFT') throw failure(409, 'CUSTOMIZATION_WORK_ORDER_ALREADY_RELEASED')

    const grossQty = grossIssueQuantity(order.plannedQty, order.scrapAllowanceFactor)
    const occurredAt = data.occurredAt ?? now
    let transfer = null
    if (order.sourceLocationId && order.wipLocationId) {
      transfer = await transferInTransaction(tx, {
        businessId: business.id,
        productId: order.rawProductId,
        sourceLocationId: order.sourceLocationId,
        targetLocationId: order.wipLocationId,
        quantity: grossQty,
        reason: 'CUSTOMIZATION_ISSUE',
        reference: `CWO:${order.code}`,
        occurredAt,
      }, { viewer, business, workOrderId: order.id })
    } else {
      // No locations modelled: prove the stock exists before promising the
      // shop floor it does, using the same recomputed on-hand the ledger uses.
      const movements = await tx.stockMovement.findMany({ where: { productId: order.rawProductId }, select: { quantity: true } })
      const onHand = movements.reduce((sum, m) => sum + m.quantity, 0)
      if (onHand < grossQty) throw Object.assign(failure(409, 'INVENTORY_INSUFFICIENT_STOCK'), { details: { required: grossQty, onHand } })
    }

    const updated = await tx.customizationWorkOrder.update({
      where: { id: order.id },
      data: { status: 'IN_PROGRESS', issuedQty: grossQty, startedAt: occurredAt, version: { increment: 1 } },
      select: CWO_SELECT,
    })
    await recordAudit(tx, {
      entityType: CUSTOMIZATION_WORK_ORDER_ENTITY, entityId: order.id, action: 'CUSTOMIZATION_WORK_ORDER_RELEASED', actorId: actor(viewer),
      payload: { businessId: business.id, code: order.code, issuedQty: grossQty, plannedQty: order.plannedQty, scrapBufferQty: grossQty - order.plannedQty, transferred: Boolean(transfer), version: order.version + 1 },
    })
    return customizationDto(updated)
  })
}

/**
 * The irreversible half. In one transaction: consume the raw units that were
 * worked on, issue the ruined ones out of stock, receive the branded output at
 * its landed cost, and return the unused buffer to the raw store.
 */
export async function completeCustomizationWorkOrder(id, input, { viewer, db = prisma, now = new Date() } = {}) {
  const orderId = typeof id === 'string' ? id.trim() : ''
  if (!orderId) throw notFound()
  const data = zCompleteCustomizationWorkOrder.parse(input)
  return inTx(db, async (tx) => {
    const order = await tx.customizationWorkOrder.findUnique({ where: { id: orderId }, select: CWO_SELECT })
    if (!order) throw notFound()
    const business = await loadBusiness(tx, viewer, data.businessId, { write: true })
    if (order.businessId !== business.id) throw notFound()
    if (order.version !== data.version) throw failure(409, 'CUSTOMIZATION_WORK_ORDER_VERSION_CONFLICT')

    const scrapQty = data.scrapQty ?? 0
    const rule = customizationCompletionRule(order, { completedQty: data.completedQty, scrapQty })
    if (!rule.ok) throw Object.assign(failure(409, rule.code), { details: { issuedQty: order.issuedQty, completedQty: data.completedQty, scrapQty } })

    const raw = await requireProduct(tx, order.rawProductId, business.id)
    const output = await requireProduct(tx, order.outputProductId, business.id, 'INVENTORY_OUTPUT_PRODUCT_NOT_FOUND')
    if (output.trackingMode === 'LOT' && !data.outputLotCode && data.completedQty > 0) throw failure(422, 'INVENTORY_LOT_REQUIRED')

    const occurredAt = data.occurredAt ?? now
    const reference = `CWO:${order.code}`

    // 1. The units that went under the laser leave raw stock for good. They are
    //    not "moved" anywhere: the thing they were no longer exists. The good
    //    ones and the ruined ones are issued SEPARATELY, so scrap is a row that
    //    can be counted and costed rather than a number folded into a
    //    consumption total nobody can decompose later.
    let consumed = null
    if (rule.run.completedQty > 0) {
      consumed = await appendMovement(tx, {
        businessId: business.id, productId: raw.id, kind: 'ISSUE', quantity: rule.run.completedQty,
        reason: 'CUSTOMIZATION_CONSUMED', reference, occurredAt,
        sourceLocationId: order.wipLocationId ?? order.sourceLocationId ?? null,
        customerId: order.customerId ?? null, salesOrderId: order.salesOrderId ?? null, workOrderId: order.id,
      }, { viewer })
    }
    // A misprinted tumbler is a loss, not inventory: it is issued out of stock
    // and never received into the quarantine location as though it could still
    // be sold. (A supplier-defective arrival is the opposite case and IS
    // received there — that is FR-165's goods receipt, unchanged.)
    let scrapped = null
    if (rule.run.scrapQty > 0) {
      scrapped = await appendMovement(tx, {
        businessId: business.id, productId: raw.id, kind: 'ISSUE', quantity: rule.run.scrapQty,
        reason: 'CUSTOMIZATION_SCRAP', reference, occurredAt,
        sourceLocationId: order.wipLocationId ?? order.sourceLocationId ?? null,
        customerId: order.customerId ?? null, salesOrderId: order.salesOrderId ?? null, workOrderId: order.id,
      }, { viewer })
    }

    // 2. The branded output arrives, carrying the raw landed cost plus this
    //    run's amortised setup and per-piece run cost (FR-175). A raw SKU whose
    //    receipts never carried a cost yields a null cost rather than a zero.
    const rawCost = await rawUnitCostSatang(tx, raw.id)
    const addedCost = customizationUnitCostSatang({ setupCostSatang: order.setupCostSatang, runCostSatang: order.runCostSatang, plannedQty: order.plannedQty })
    const unitCostSatang = rawCost === null ? null : rawCost + addedCost
    let produced = null
    if (rule.run.completedQty > 0) {
      produced = await appendMovement(tx, {
        businessId: business.id, productId: output.id, kind: 'RECEIPT', quantity: rule.run.completedQty,
        reason: 'CUSTOMIZATION_PRODUCED', reference, occurredAt,
        targetLocationId: order.wipLocationId ?? null,
        costSatang: unitCostSatang,
        customerId: order.customerId ?? null, salesOrderId: order.salesOrderId ?? null, workOrderId: order.id,
        ...(output.trackingMode === 'LOT' ? { lotCode: data.outputLotCode } : {}),
      }, { viewer })
    }

    // 3. The unused buffer is still blank hardware. It goes back to the raw
    //    store rather than sitting on a bench nobody counts.
    let returned = null
    if (rule.run.unusedBufferQty > 0 && order.wipLocationId && order.sourceLocationId) {
      returned = await transferInTransaction(tx, {
        businessId: business.id, productId: raw.id,
        sourceLocationId: order.wipLocationId, targetLocationId: order.sourceLocationId,
        quantity: rule.run.unusedBufferQty, reason: 'CUSTOMIZATION_BUFFER_RETURNED', reference, occurredAt,
      }, { viewer, business, workOrderId: order.id })
    }

    const status = rule.blocked ? 'BLOCKED_SHORTAGE' : 'COMPLETED'
    const updated = await tx.customizationWorkOrder.update({
      where: { id: order.id },
      data: {
        status,
        completedQty: rule.run.completedQty,
        scrapQty: rule.run.scrapQty,
        completedAt: rule.blocked ? null : occurredAt,
        version: { increment: 1 },
      },
      select: CWO_SELECT,
    })
    await recordAudit(tx, {
      entityType: CUSTOMIZATION_WORK_ORDER_ENTITY, entityId: order.id,
      action: rule.blocked ? 'CUSTOMIZATION_WORK_ORDER_BLOCKED' : 'CUSTOMIZATION_WORK_ORDER_COMPLETED',
      actorId: actor(viewer),
      payload: {
        businessId: business.id, code: order.code, rawProductId: raw.id, outputProductId: output.id, outputCode: output.code,
        issuedQty: order.issuedQty, completedQty: rule.run.completedQty, scrapQty: rule.run.scrapQty,
        unusedBufferQty: rule.run.unusedBufferQty, scrapRate: rule.run.scrapRate, shortfall: rule.shortfall,
        unitCostSatang, rawUnitCostSatang: rawCost, customizationUnitCostSatang: addedCost,
        scrapLocationId: order.scrapLocationId ?? null, version: order.version + 1,
      },
    })
    return {
      order: customizationDto(updated),
      consumed,
      scrapped,
      produced,
      returned,
      unitCostSatang,
      shortfall: rule.shortfall,
      // A run that scrapped more than its buffer allowed is the one the shop
      // floor must be told about: the order is short and Procurement has to
      // replace the difference (ADR-074 D4, the scrap-overrun path).
      scrapThresholdExceeded: rule.run.scrapQty > Math.max(0, order.issuedQty - order.plannedQty),
    }
  })
}

export async function cancelCustomizationWorkOrder(id, input, { viewer, db = prisma, now = new Date() } = {}) {
  const orderId = typeof id === 'string' ? id.trim() : ''
  if (!orderId) throw notFound()
  const data = zCancelWorkOrder.parse(input)
  return inTx(db, async (tx) => {
    const order = await tx.customizationWorkOrder.findUnique({ where: { id: orderId }, select: CWO_SELECT })
    if (!order) throw notFound()
    const business = await loadBusiness(tx, viewer, data.businessId, { write: true })
    if (order.businessId !== business.id) throw notFound()
    if (order.version !== data.version) throw failure(409, 'CUSTOMIZATION_WORK_ORDER_VERSION_CONFLICT')
    if (order.status === 'COMPLETED') throw failure(409, 'CUSTOMIZATION_WORK_ORDER_COMPLETED')
    if (order.status === 'CANCELLED') throw failure(409, 'CUSTOMIZATION_WORK_ORDER_CANCELLED')

    const occurredAt = data.occurredAt ?? now
    // Whatever was issued to the workshop and never worked on is blank stock
    // and goes back. What was already branded is not this method's business:
    // it is a write-off a person decides (BR-028).
    let returned = null
    const unworked = Math.max(0, order.issuedQty - order.completedQty - order.scrapQty)
    if (unworked > 0 && order.wipLocationId && order.sourceLocationId) {
      returned = await transferInTransaction(tx, {
        businessId: business.id, productId: order.rawProductId,
        sourceLocationId: order.wipLocationId, targetLocationId: order.sourceLocationId,
        quantity: unworked, reason: 'CUSTOMIZATION_CANCELLED', reference: `CWO:${order.code}`, occurredAt,
      }, { viewer, business, workOrderId: order.id })
    }
    const updated = await tx.customizationWorkOrder.update({
      where: { id: order.id },
      data: { status: 'CANCELLED', cancelledAt: occurredAt, version: { increment: 1 } },
      select: CWO_SELECT,
    })
    await recordAudit(tx, {
      entityType: CUSTOMIZATION_WORK_ORDER_ENTITY, entityId: order.id, action: 'CUSTOMIZATION_WORK_ORDER_CANCELLED', actorId: actor(viewer),
      payload: { businessId: business.id, code: order.code, returnedQty: unworked, reason: data.reason ?? null, version: order.version + 1 },
    })
    return { order: customizationDto(updated), returned }
  })
}

export async function listCustomizationWorkOrders({ businessId, status, salesOrderId, viewer, db = prisma } = {}) {
  const business = await loadBusiness(db, viewer, businessId)
  const rows = await db.customizationWorkOrder.findMany({
    where: { businessId: business.id, ...(status ? { status } : {}), ...(salesOrderId ? { salesOrderId } : {}) },
    orderBy: [{ createdAt: 'desc' }],
    select: CWO_SELECT,
  })
  return rows.map(customizationDto)
}

export async function getCustomizationWorkOrder(id, { viewer, db = prisma } = {}) {
  const orderId = typeof id === 'string' ? id.trim() : ''
  if (!orderId) throw notFound()
  const row = await db.customizationWorkOrder.findUnique({ where: { id: orderId }, select: CWO_SELECT })
  if (!row) throw notFound()
  await loadBusiness(db, viewer, row.businessId)
  return customizationDto(row)
}
