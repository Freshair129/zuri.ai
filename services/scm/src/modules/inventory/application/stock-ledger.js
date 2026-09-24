import { allocateFefo, movementDelta, movementRule, serialStatusAfter, stockSummaryRow } from '../../../kernel/inventory/inventory.js'
import { dedicationRule, shelfLifeIssueRule } from '../../../kernel/inventory/inventory-wip.js'
import { STOCK_MOVEMENT_ENTITY, SERIAL_UNIT_ENTITY } from '../domain/entities.js'
import { inventoryAuthority } from '../../../infrastructure/delegation.js'
import { recordAudit } from '../../../infrastructure/evidence.js'
import * as repo from '../adapters/inventory-repo.js'

// The Inventory core writer inside SCM — port of apps/server
// inventory-stock-service.appendMovement for RECEIPT and ISSUE, with the same
// order of checks: authority (read) → fence (first write-side statement) →
// product → movementRule (kernel, shared with legacy) → on-hand → lot →
// dedication (ISSUE) → shelf life (ISSUE of a named lot) → rows (serials; FEFO
// across OPEN, non-expired lots for a LOT issue without a lot, one row per lot,
// lot-less remainder last) → lot receivedQty (RECEIPT) → audit → fence advance.
// Append-only: the store's triggers refuse UPDATE/DELETE of StockMovement.
//
// Transitional scope (SHARED_TRANSITION, SCM-HANDOFF.md): ADJUSTMENT, serial
// ISSUE and non-base units stay in the legacy writer until their callers
// (stocktake, fulfilment of serial goods, unit-converting intakes) move whole;
// they are refused here explicitly instead of being half-implemented.

const failure = (status, code, details) => Object.assign(new Error(code), { status, code, retryable: false, ...(details ? { details } : {}) })

/**
 * Append one movement (several rows for a serial receipt or a FEFO issue)
 * inside the caller's unit of work. `input` has the legacy appendMovement shape.
 */
export function appendMovement(sql, scope, input, { now }) {
  const business = inventoryAuthority.require(scope, input.businessId, { write: true })
  repo.acquireFence(sql, { tenantId: business.tenantId, businessId: business.id, now })
  if (input.kind !== 'RECEIPT' && input.kind !== 'ISSUE') throw failure(409, 'SCM_MOVEMENT_KIND_NOT_MIGRATED', { kind: input.kind })
  const product = repo.productById(sql, input.productId)
  if (!product || product.businessId !== business.id || product.tenantId !== business.tenantId) throw failure(422, 'INVENTORY_PRODUCT_NOT_FOUND')
  if (input.unit && input.unit !== product.unit) throw failure(409, 'SCM_UNIT_CONVERSION_NOT_MIGRATED', { unit: input.unit, baseUnit: product.unit })
  const data = { ...input, unit: undefined }
  const rule = movementRule(product, data)
  if (!rule.ok) throw failure(rule.code === 'INVENTORY_PRODUCT_ARCHIVED' || rule.code === 'INVENTORY_PRODUCT_PHASED_OUT' ? 409 : 422, rule.code)
  if (data.kind === 'ISSUE' && product.trackingMode === 'SERIAL') throw failure(409, 'SCM_SERIAL_ISSUE_NOT_MIGRATED')

  const delta = movementDelta(data.kind, data.quantity)
  const before = repo.onHandOf(sql, product.id)
  if (before + delta < 0) throw failure(409, 'INVENTORY_INSUFFICIENT_STOCK')
  if (!Number.isSafeInteger(before + delta) || before + delta > 2_147_483_647) throw failure(409, 'INVENTORY_QUANTITY_OVERFLOW')

  let lot = null
  if (data.lotId) {
    lot = repo.lotById(sql, data.lotId)
    if (!lot || lot.productId !== product.id) throw failure(422, 'PRODUCT_LOT_NOT_FOUND')
    if (lot.status === 'CLOSED' && data.kind === 'RECEIPT') throw failure(409, 'PRODUCT_LOT_CLOSED')
  } else if (data.lotCode) {
    lot = repo.lotByCode(sql, product.id, data.lotCode)
    if (lot?.status === 'CLOSED' && data.kind === 'RECEIPT') throw failure(409, 'PRODUCT_LOT_CLOSED')
    if (!lot && data.kind !== 'RECEIPT') throw failure(422, 'PRODUCT_LOT_NOT_FOUND')
    lot ??= repo.createLot(sql, { code: data.lotCode, tenantId: business.tenantId, businessId: business.id, productId: product.id, now })
  }
  const occurredAt = data.occurredAt ?? now
  const occurredDate = new Date(occurredAt)
  if (data.kind === 'ISSUE') {
    const dedication = dedicationRule(product, { customerId: data.customerId ?? null, salesOrderId: data.salesOrderId ?? null })
    if (!dedication.ok) throw failure(409, dedication.code)
    if (lot) {
      const shelfLife = shelfLifeIssueRule(product, lot, occurredDate)
      if (!shelfLife.ok) throw failure(409, shelfLife.code, { lotId: lot.id, lotCode: lot.code, ageDays: shelfLife.ageDays, maxStorageDays: product.maxStorageDays })
    }
  }
  const base = {
    tenantId: business.tenantId, businessId: business.id, productId: product.id, lotId: lot?.id ?? null, kind: data.kind,
    reason: data.reason ?? null, reference: data.reference ?? null, actorId: scope.actorId, occurredAt, createdAt: now,
    sourceLocationId: data.sourceLocationId ?? null, targetLocationId: data.targetLocationId ?? null,
    costSatang: data.costSatang ?? null, customerId: data.customerId ?? null, salesOrderId: data.salesOrderId ?? null, workOrderId: data.workOrderId ?? null,
  }
  const rows = []
  const allocations = []
  if (product.trackingMode === 'SERIAL') {
    for (const serialNo of data.serialNos) {
      const existing = repo.serialByNo(sql, product.id, serialNo)
      if (existing && existing.status === serialStatusAfter('RECEIPT')) throw failure(409, 'INVENTORY_SERIAL_ALREADY_IN_STOCK')
      const unit = repo.receiveSerial(sql, { existing, serialNo, tenantId: business.tenantId, businessId: business.id, productId: product.id, lotId: lot?.id ?? null, now })
      const row = repo.insertMovement(sql, { ...base, lotId: unit.lotId ?? base.lotId, serialUnitId: unit.id, quantity: movementDelta(data.kind, 1) })
      recordAudit(sql, { entityType: SERIAL_UNIT_ENTITY, entityId: unit.id, action: 'SERIAL_UNIT_RECEIVED', actorId: scope.actorId, tenantId: business.tenantId, businessId: business.id, requestId: data.requestId, now, payload: { businessId: business.id, productId: product.id, serialNo, status: unit.status, movementId: row.id } })
      rows.push(row)
    }
  } else if (product.trackingMode === 'LOT' && data.kind === 'ISSUE') {
    const byLot = repo.onHandByLot(sql, product.id)
    if (lot) {
      if ((byLot.get(lot.id) ?? 0) < Math.abs(delta)) throw failure(409, 'INVENTORY_LOT_INSUFFICIENT_STOCK')
      rows.push(repo.insertMovement(sql, { ...base, quantity: delta }))
      allocations.push({ lotId: lot.id, qty: Math.abs(delta) })
    } else {
      const lots = repo.openLotsOf(sql, product.id)
      const issuable = lots.filter((l) => shelfLifeIssueRule(product, l, occurredDate).ok)
      const { allocations: picked, remainder } = allocateFefo(issuable.map((l) => ({ ...l, onHand: byLot.get(l.id) ?? 0 })), Math.abs(delta))
      if (remainder > (byLot.get(null) ?? 0)) {
        const blocked = lots.filter((l) => !shelfLifeIssueRule(product, l, occurredDate).ok && (byLot.get(l.id) ?? 0) > 0)
        if (blocked.length) throw failure(409, 'INVENTORY_LOT_STORAGE_EXPIRED', { blockedLots: blocked.map((l) => ({ lotId: l.id, lotCode: l.code, onHand: byLot.get(l.id) ?? 0 })), maxStorageDays: product.maxStorageDays })
        throw failure(409, 'INVENTORY_INSUFFICIENT_STOCK')
      }
      for (const pick of picked) { rows.push(repo.insertMovement(sql, { ...base, lotId: pick.lotId, quantity: -pick.qty })); allocations.push(pick) }
      if (remainder > 0) { rows.push(repo.insertMovement(sql, { ...base, lotId: null, quantity: -remainder })); allocations.push({ lotId: null, qty: remainder }) }
    }
  } else {
    rows.push(repo.insertMovement(sql, { ...base, quantity: delta }))
  }
  if (lot && data.kind === 'RECEIPT') repo.addLotReceivedQty(sql, lot.id, Math.abs(delta), now)
  const after = before + delta
  recordAudit(sql, {
    entityType: STOCK_MOVEMENT_ENTITY, entityId: rows[0].id, action: `STOCK_${data.kind}_RECORDED`, actorId: scope.actorId,
    tenantId: business.tenantId, businessId: business.id, requestId: data.requestId, now,
    payload: { businessId: business.id, productId: product.id, code: product.code, kind: data.kind, quantity: delta, lotId: lot?.id ?? null, allocations: allocations.length ? allocations : undefined, serials: data.serialNos?.length ?? 0, onHandBefore: before, onHandAfter: after, reference: data.reference ?? null, sourceLocationId: base.sourceLocationId, targetLocationId: base.targetLocationId, costSatang: base.costSatang, customerId: base.customerId, salesOrderId: base.salesOrderId, workOrderId: base.workOrderId },
  })
  if (repo.advanceFence(sql, { tenantId: business.tenantId, businessId: business.id }) !== 1) throw failure(409, 'INVENTORY_LEDGER_FENCE_EXHAUSTED')
  return { productId: product.id, kind: data.kind, quantity: delta, onHandBefore: before, onHandAfter: after, lotId: lot?.id ?? null, allocations, movements: rows, costSatang: base.costSatang }
}

/**
 * An ACTIVE, physical location of this Business — the source of a POS issue.
 * `business` is the {id, tenantId} the CALLER already authorized (legacy POS
 * checks the location under Commerce authority; the Inventory write authority is
 * asked for by appendMovement only when a counted line is issued).
 */
export function requireIssuableLocation(sql, business, locationId) {
  const location = repo.locationById(sql, locationId)
  if (!location || location.tenantId !== business.tenantId || location.businessId !== business.id || location.status !== 'ACTIVE' || location.isVirtual) throw Object.assign(new Error('WAREHOUSE_LOCATION_NOT_FOUND'), { status: 422, code: 'WAREHOUSE_LOCATION_NOT_FOUND', retryable: false })
  return { id: location.id, code: location.code, name: location.name }
}

/** Inventory-owned lot fact update, offered to Procurement instead of a direct table write. */
export function setLotExpiryIfUnset(sql, scope, { businessId, lotId, expiresAt }, { now }) {
  inventoryAuthority.require(scope, businessId, { write: true })
  const lot = repo.lotById(sql, lotId)
  if (!lot || lot.businessId !== businessId) throw failure(422, 'PRODUCT_LOT_NOT_FOUND')
  return repo.setLotExpiryIfUnset(sql, lotId, expiresAt, now) === 1
}

/** Every product of the Business with on-hand recomputed from the ledger; uncounted → null, never 0. */
export function stockSummary(sql, scope, { businessId }) {
  const business = inventoryAuthority.require(scope, businessId)
  const onHand = repo.onHandByProduct(sql, business.id)
  const products = repo.productsOfBusiness(sql, business.id).filter((p) => p.tenantId === business.tenantId)
  const rows = products.map((p) => stockSummaryRow(p, [{ quantity: onHand.get(p.id) ?? 0 }]))
  return { businessId: business.id, products: rows }
}

export function listMovements(sql, scope, { businessId, productId, limit = 200 }) {
  const business = inventoryAuthority.require(scope, businessId)
  const take = Math.min(Math.max(1, Number(limit) || 200), 500)
  return repo.movementsOf(sql, { businessId: business.id, productId, limit: take })
}
