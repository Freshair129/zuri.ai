import { PRODUCT_ENTITY } from '../../../kernel/inventory/inventory.js'
import { customizationUnitCostSatang, weightedAverageUnitCostSatang } from '../../../kernel/inventory/inventory-costing.js'
import {
  CUSTOMIZATION_WORK_ORDER_ENTITY, customizationCompletionRule, customizationWorkOrderCode, grossIssueQuantity,
  reconcileCustomizationRun, workOrderDayKey, zCancelWorkOrder, zCompleteCustomizationWorkOrder, zOpenCustomizationWorkOrder, zWorkOrderAction,
} from '../../../kernel/inventory/inventory-wip.js'
import { denied, inventoryAuthority } from '../../../infrastructure/delegation.js'
import { enqueueOutbox, recordAudit } from '../../../infrastructure/evidence.js'
import { appendMovement } from './stock-ledger.js'
import { transferInTransaction } from './transfers.js'
import * as catalogRepo from '../adapters/catalog-repo.js'
import * as repo from '../adapters/inventory-repo.js'
import * as wipRepo from '../adapters/wip-repo.js'

// Customization work orders (FR-176) inside SCM — port of apps/server
// customization-work-order-service with the same codes, order of refusals and
// audit actions. OPEN computes the gross issue (net + BR-029 buffer) and, unless
// the caller names one, creates the branded CUSTOM_COMPONENT output SKU dedicated
// to the customer and order (BR-028). RELEASE moves the gross quantity to the
// workshop as a transfer (on-hand unchanged) or, with no locations modelled,
// proves the stock exists. COMPLETE consumes the worked units and the scrap
// SEPARATELY, receives the branded output at raw landed cost + amortised setup +
// per-piece run cost (FR-175), returns the unused buffer, and lands
// BLOCKED_SHORTAGE when short. CANCEL returns what was issued and never worked.

const failure = (status, code, details) => Object.assign(new Error(code), { status, code, retryable: false }, details === undefined ? {} : { details })
const iso = (value) => (value instanceof Date ? value.toISOString() : value)
const KIND = 'customization'

function parsePantone(json) {
  try {
    const value = JSON.parse(json || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

export const customizationDto = (row) => ({ ...row, pantoneColors: parsePantone(row.pantoneColorsJson), pantoneColorsJson: undefined, grossIssueQty: grossIssueQuantity(row.plannedQty, row.scrapAllowanceFactor), run: reconcileCustomizationRun(row) })

function evidence(sql, scope, { entityType = CUSTOMIZATION_WORK_ORDER_ENTITY, entityId, action, business, payload, version, ctx }) {
  recordAudit(sql, { entityType, entityId, action, actorId: scope.actorId, tenantId: business.tenantId, businessId: business.id, requestId: ctx.requestId, now: ctx.now, payload })
  enqueueOutbox(sql, { topic: `scm.inventory.${action.toLowerCase().replace(/_/g, '-')}`, aggregateType: entityType, aggregateId: entityId, aggregateVersion: version, now: ctx.now, payload: { businessId: business.id, [entityType === PRODUCT_ENTITY ? 'productId' : 'workOrderId']: entityId } })
}

function nextCode(sql, business, now) {
  const count = wipRepo.workOrderCodeCount(sql, KIND, business.tenantId, `CWO-${workOrderDayKey(now)}-`)
  for (let seq = count + 1; seq < count + 200; seq += 1) {
    const code = customizationWorkOrderCode(now, seq)
    if (!wipRepo.workOrderCodeTaken(sql, KIND, business.tenantId, code)) return code
  }
  throw failure(409, 'CUSTOMIZATION_WORK_ORDER_CODE_EXHAUSTED')
}

function requireProduct(sql, id, businessId, code = 'INVENTORY_PRODUCT_NOT_FOUND') {
  const product = catalogRepo.byId(sql, 'product', id)
  if (!product || product.businessId !== businessId) throw failure(422, code)
  if (product.status === 'ARCHIVED') throw failure(409, 'PRODUCT_ARCHIVED')
  return product
}

/** The branded SKU a run produces: the same hardware, dedicated; its identity is the order that branded it. */
function createOutputProduct(sql, scope, { business, raw, code, customerId, salesOrderId, technique, ctx }) {
  const id = wipRepo.insertProduct(sql, {
    code, tenantId: business.tenantId, businessId: business.id, productMasterId: raw.productMasterId,
    name: raw.name ? `${raw.name} (${technique})` : null, unit: raw.unit, stockPolicy: 'TRACKED', trackingMode: raw.trackingMode,
    safetyStock: 0, itemKind: 'CUSTOM_COMPONENT', dedicatedCustomerId: customerId ?? null, dedicatedSalesOrderId: salesOrderId ?? null,
    maintenanceIntervalDays: raw.maintenanceIntervalDays, maxStorageDays: raw.maxStorageDays, createdAt: ctx.now, updatedAt: ctx.now,
  })
  const created = catalogRepo.byId(sql, 'product', id)
  evidence(sql, scope, { entityType: PRODUCT_ENTITY, entityId: created.id, action: 'PRODUCT_CREATED', business, version: 1, ctx, payload: { businessId: business.id, code: created.code, itemKind: 'CUSTOM_COMPONENT', dedicatedCustomerId: customerId ?? null, dedicatedSalesOrderId: salesOrderId ?? null, fromProductId: raw.id } })
  return created
}

/** Command authorization for OPEN: validate first, then Inventory write on the named Business. */
export const openerOf = (scope, body) => inventoryAuthority.require(scope, zOpenCustomizationWorkOrder.parse(body).businessId, { write: true }).id
/** Command authorization for an action: the body's Business (write), then an order of that Business; 404 otherwise. */
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

export function openCustomizationWorkOrder(sql, scope, input, ctx) {
  const data = zOpenCustomizationWorkOrder.parse(input)
  const business = inventoryAuthority.require(scope, data.businessId, { write: true })
  const raw = requireProduct(sql, data.rawProductId, business.id)
  if (raw.stockPolicy !== 'TRACKED') throw failure(422, 'INVENTORY_PRODUCT_UNTRACKED')
  if (raw.trackingMode === 'SERIAL') throw failure(422, 'INVENTORY_CUSTOMIZATION_SERIAL_UNSUPPORTED')
  if (raw.itemKind === 'CUSTOM_COMPONENT') throw failure(409, 'INVENTORY_CUSTOM_COMPONENT_ALREADY_BRANDED')

  const code = nextCode(sql, business, ctx.now)
  let output
  if (data.outputProductId) {
    output = requireProduct(sql, data.outputProductId, business.id, 'INVENTORY_OUTPUT_PRODUCT_NOT_FOUND')
    if (output.itemKind !== 'CUSTOM_COMPONENT') throw failure(422, 'INVENTORY_OUTPUT_NOT_CUSTOM_COMPONENT')
    if (output.id === raw.id) throw failure(422, 'INVENTORY_CUSTOMIZATION_SELF_OUTPUT')
    if (data.customerId && output.dedicatedCustomerId && output.dedicatedCustomerId !== data.customerId) throw failure(409, 'INVENTORY_CUSTOM_COMPONENT_WRONG_CUSTOMER')
    if (data.salesOrderId && output.dedicatedSalesOrderId && output.dedicatedSalesOrderId !== data.salesOrderId) throw failure(409, 'INVENTORY_CUSTOM_COMPONENT_WRONG_SALES_ORDER')
  } else {
    const outputCode = `${raw.code}-${code}`.slice(0, 64)
    if (catalogRepo.codeTaken(sql, 'product', business.tenantId, outputCode)) throw failure(409, 'PRODUCT_CODE_TAKEN')
    output = createOutputProduct(sql, scope, { business, raw, code: outputCode, customerId: data.customerId ?? null, salesOrderId: data.salesOrderId ?? null, technique: data.technique, ctx })
  }

  const created = wipRepo.insertWorkOrder(sql, KIND, {
    code, tenantId: business.tenantId, businessId: business.id, salesOrderId: data.salesOrderId ?? null, customerId: data.customerId ?? null,
    rawProductId: raw.id, outputProductId: output.id, technique: data.technique, logoArtworkUrl: data.logoArtworkUrl ?? null,
    pantoneColorsJson: data.pantoneColors?.length ? JSON.stringify(data.pantoneColors) : null,
    plannedQty: data.netQuantity, issuedQty: 0, completedQty: 0, scrapQty: 0, scrapAllowanceFactor: data.scrapAllowanceFactor ?? 0.02,
    setupCostSatang: data.setupCostSatang ?? 0, runCostSatang: data.runCostSatang ?? 0, status: 'DRAFT',
    sourceLocationId: data.sourceLocationId ?? null, wipLocationId: data.wipLocationId ?? null, scrapLocationId: data.scrapLocationId ?? null,
    scheduledDate: iso(data.scheduledDate) ?? null, notes: data.notes ?? null, createdByPersonId: scope.actorId, createdAt: ctx.now, updatedAt: ctx.now,
  })
  evidence(sql, scope, {
    entityId: created.id, action: 'CUSTOMIZATION_WORK_ORDER_OPENED', business, version: 1, ctx,
    payload: { businessId: business.id, code, rawProductId: raw.id, rawCode: raw.code, outputProductId: output.id, outputCode: output.code, technique: created.technique, plannedQty: created.plannedQty, grossIssueQty: grossIssueQuantity(created.plannedQty, created.scrapAllowanceFactor), customerId: created.customerId, salesOrderId: created.salesOrderId },
  })
  return { response: { order: customizationDto(created) }, affected: { workOrderId: created.id, version: created.version, outputProductId: output.id } }
}

function release(sql, scope, id, data, ctx) {
  const { order, business } = loadOrder(sql, scope, id, data.businessId)
  if (order.version !== data.version) throw failure(409, 'CUSTOMIZATION_WORK_ORDER_VERSION_CONFLICT')
  if (order.status !== 'DRAFT') throw failure(409, 'CUSTOMIZATION_WORK_ORDER_ALREADY_RELEASED')
  const grossQty = grossIssueQuantity(order.plannedQty, order.scrapAllowanceFactor)
  const occurredAt = iso(data.occurredAt) ?? ctx.now
  let transfer = null
  if (order.sourceLocationId && order.wipLocationId) {
    transfer = transferInTransaction(sql, scope, { productId: order.rawProductId, sourceLocationId: order.sourceLocationId, targetLocationId: order.wipLocationId, quantity: grossQty, reason: 'CUSTOMIZATION_ISSUE', reference: `CWO:${order.code}`, occurredAt }, { business, workOrderId: order.id, now: ctx.now, requestId: ctx.requestId })
  } else {
    const onHand = repo.onHandOf(sql, order.rawProductId)
    if (onHand < grossQty) throw failure(409, 'INVENTORY_INSUFFICIENT_STOCK', { required: grossQty, onHand })
  }
  if (wipRepo.casWorkOrder(sql, KIND, { id: order.id, version: order.version, change: { status: 'IN_PROGRESS', issuedQty: grossQty, startedAt: occurredAt }, now: ctx.now }) !== 1) throw failure(409, 'CUSTOMIZATION_WORK_ORDER_VERSION_CONFLICT')
  evidence(sql, scope, { entityId: order.id, action: 'CUSTOMIZATION_WORK_ORDER_RELEASED', business, version: order.version + 1, ctx, payload: { businessId: business.id, code: order.code, issuedQty: grossQty, plannedQty: order.plannedQty, scrapBufferQty: grossQty - order.plannedQty, transferred: Boolean(transfer), version: order.version + 1 } })
  const fresh = wipRepo.workOrderById(sql, KIND, order.id)
  return { response: { order: customizationDto(fresh) }, affected: { workOrderId: order.id, version: fresh.version, status: fresh.status } }
}

function complete(sql, scope, id, data, ctx) {
  const { order, business } = loadOrder(sql, scope, id, data.businessId)
  if (order.version !== data.version) throw failure(409, 'CUSTOMIZATION_WORK_ORDER_VERSION_CONFLICT')
  const scrapQty = data.scrapQty ?? 0
  const rule = customizationCompletionRule(order, { completedQty: data.completedQty, scrapQty })
  if (!rule.ok) throw failure(409, rule.code, { issuedQty: order.issuedQty, completedQty: data.completedQty, scrapQty })
  const raw = requireProduct(sql, order.rawProductId, business.id)
  const output = requireProduct(sql, order.outputProductId, business.id, 'INVENTORY_OUTPUT_PRODUCT_NOT_FOUND')
  if (output.trackingMode === 'LOT' && !data.outputLotCode && data.completedQty > 0) throw failure(422, 'INVENTORY_LOT_REQUIRED')

  const occurredAt = iso(data.occurredAt) ?? ctx.now
  const reference = `CWO:${order.code}`
  const at = order.wipLocationId ?? order.sourceLocationId ?? null
  const shared = { businessId: business.id, reference, occurredAt, customerId: order.customerId ?? null, salesOrderId: order.salesOrderId ?? null, workOrderId: order.id, requestId: ctx.requestId }
  // 1. The worked units and the ruined ones leave raw stock as SEPARATE issues.
  const consumed = rule.run.completedQty > 0 ? appendMovement(sql, scope, { ...shared, productId: raw.id, kind: 'ISSUE', quantity: rule.run.completedQty, reason: 'CUSTOMIZATION_CONSUMED', sourceLocationId: at }, { now: ctx.now }) : null
  const scrapped = rule.run.scrapQty > 0 ? appendMovement(sql, scope, { ...shared, productId: raw.id, kind: 'ISSUE', quantity: rule.run.scrapQty, reason: 'CUSTOMIZATION_SCRAP', sourceLocationId: at }, { now: ctx.now }) : null
  // 2. The branded output arrives at raw landed cost + this run's added cost (null when the raw cost is unknown).
  const rawCost = weightedAverageUnitCostSatang(wipRepo.receiptsOf(sql, raw.id))
  const addedCost = customizationUnitCostSatang({ setupCostSatang: order.setupCostSatang, runCostSatang: order.runCostSatang, plannedQty: order.plannedQty })
  const unitCostSatang = rawCost === null ? null : rawCost + addedCost
  const produced = rule.run.completedQty > 0
    ? appendMovement(sql, scope, { ...shared, productId: output.id, kind: 'RECEIPT', quantity: rule.run.completedQty, reason: 'CUSTOMIZATION_PRODUCED', targetLocationId: order.wipLocationId ?? null, costSatang: unitCostSatang, ...(output.trackingMode === 'LOT' ? { lotCode: data.outputLotCode } : {}) }, { now: ctx.now })
    : null
  // 3. The unused buffer is still blank hardware: back to the raw store.
  const returned = rule.run.unusedBufferQty > 0 && order.wipLocationId && order.sourceLocationId
    ? transferInTransaction(sql, scope, { productId: raw.id, sourceLocationId: order.wipLocationId, targetLocationId: order.sourceLocationId, quantity: rule.run.unusedBufferQty, reason: 'CUSTOMIZATION_BUFFER_RETURNED', reference, occurredAt }, { business, workOrderId: order.id, now: ctx.now, requestId: ctx.requestId })
    : null

  const status = rule.blocked ? 'BLOCKED_SHORTAGE' : 'COMPLETED'
  ctx.faults?.beforeOrderUpdate?.()
  if (wipRepo.casWorkOrder(sql, KIND, { id: order.id, version: order.version, change: { status, completedQty: rule.run.completedQty, scrapQty: rule.run.scrapQty, completedAt: rule.blocked ? null : occurredAt }, now: ctx.now }) !== 1) throw failure(409, 'CUSTOMIZATION_WORK_ORDER_VERSION_CONFLICT')
  evidence(sql, scope, {
    entityId: order.id, action: rule.blocked ? 'CUSTOMIZATION_WORK_ORDER_BLOCKED' : 'CUSTOMIZATION_WORK_ORDER_COMPLETED', business, version: order.version + 1, ctx,
    payload: { businessId: business.id, code: order.code, rawProductId: raw.id, outputProductId: output.id, outputCode: output.code, issuedQty: order.issuedQty, completedQty: rule.run.completedQty, scrapQty: rule.run.scrapQty, unusedBufferQty: rule.run.unusedBufferQty, scrapRate: rule.run.scrapRate, shortfall: rule.shortfall, unitCostSatang, rawUnitCostSatang: rawCost, customizationUnitCostSatang: addedCost, scrapLocationId: order.scrapLocationId ?? null, version: order.version + 1 },
  })
  const fresh = wipRepo.workOrderById(sql, KIND, order.id)
  return {
    response: { order: customizationDto(fresh), consumed, scrapped, produced, returned, unitCostSatang, shortfall: rule.shortfall, scrapThresholdExceeded: rule.run.scrapQty > Math.max(0, order.issuedQty - order.plannedQty) },
    affected: { workOrderId: order.id, version: fresh.version, status: fresh.status },
  }
}

function cancel(sql, scope, id, data, ctx) {
  const { order, business } = loadOrder(sql, scope, id, data.businessId)
  if (order.version !== data.version) throw failure(409, 'CUSTOMIZATION_WORK_ORDER_VERSION_CONFLICT')
  if (order.status === 'COMPLETED') throw failure(409, 'CUSTOMIZATION_WORK_ORDER_COMPLETED')
  if (order.status === 'CANCELLED') throw failure(409, 'CUSTOMIZATION_WORK_ORDER_CANCELLED')
  const occurredAt = iso(data.occurredAt) ?? ctx.now
  // What was issued and never worked is blank stock and goes back; what was already branded is a write-off a person decides (BR-028).
  const unworked = Math.max(0, order.issuedQty - order.completedQty - order.scrapQty)
  const returned = unworked > 0 && order.wipLocationId && order.sourceLocationId
    ? transferInTransaction(sql, scope, { productId: order.rawProductId, sourceLocationId: order.wipLocationId, targetLocationId: order.sourceLocationId, quantity: unworked, reason: 'CUSTOMIZATION_CANCELLED', reference: `CWO:${order.code}`, occurredAt }, { business, workOrderId: order.id, now: ctx.now, requestId: ctx.requestId })
    : null
  if (wipRepo.casWorkOrder(sql, KIND, { id: order.id, version: order.version, change: { status: 'CANCELLED', cancelledAt: occurredAt }, now: ctx.now }) !== 1) throw failure(409, 'CUSTOMIZATION_WORK_ORDER_VERSION_CONFLICT')
  evidence(sql, scope, { entityId: order.id, action: 'CUSTOMIZATION_WORK_ORDER_CANCELLED', business, version: order.version + 1, ctx, payload: { businessId: business.id, code: order.code, returnedQty: unworked, reason: data.reason ?? null, version: order.version + 1 } })
  const fresh = wipRepo.workOrderById(sql, KIND, order.id)
  return { response: { order: customizationDto(fresh), returned }, affected: { workOrderId: order.id, version: fresh.version, status: fresh.status } }
}

/** The FR-182 dispatcher: a declared action to the function that implements it. */
export function applyCustomizationWorkOrderAction(sql, scope, id, input, ctx) {
  const data = zWorkOrderAction.parse(input)
  const rest = { businessId: data.businessId, version: data.version, reason: data.reason ?? null, ...(data.occurredAt ? { occurredAt: data.occurredAt } : {}) }
  if (data.action === 'RELEASE') return release(sql, scope, id, zCancelWorkOrder.parse(rest), ctx)
  if (data.action === 'CANCEL') return cancel(sql, scope, id, zCancelWorkOrder.parse(rest), ctx)
  return complete(sql, scope, id, zCompleteCustomizationWorkOrder.parse({
    businessId: data.businessId, version: data.version, completedQty: data.completedQty ?? 0,
    ...(data.scrapQty !== undefined ? { scrapQty: data.scrapQty } : {}), ...(data.outputLotCode ? { outputLotCode: data.outputLotCode } : {}),
    reason: data.reason ?? null, ...(data.occurredAt ? { occurredAt: data.occurredAt } : {}),
  }), ctx)
}

export function listCustomizationWorkOrders(sql, scope, { businessId, status, salesOrderId } = {}) {
  const business = inventoryAuthority.require(scope, typeof businessId === 'string' ? businessId.trim() : '')
  return wipRepo.workOrdersOf(sql, KIND, business.id, { status: status || undefined, salesOrderId: salesOrderId || undefined }).map(customizationDto)
}

export function getCustomizationWorkOrder(sql, scope, id) {
  const row = typeof id === 'string' && id.trim() ? wipRepo.workOrderById(sql, KIND, id.trim()) : null
  if (!row || row.tenantId !== scope.tenantId) throw denied()
  inventoryAuthority.require(scope, row.businessId)
  return customizationDto(row)
}
