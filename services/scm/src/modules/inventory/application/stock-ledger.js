import { movementDelta, movementRule, serialStatusAfter, stockSummaryRow } from '../../../kernel/inventory/inventory.js'
import { STOCK_MOVEMENT_ENTITY, SERIAL_UNIT_ENTITY } from '../domain/entities.js'
import { inventoryAuthority } from '../../../infrastructure/delegation.js'
import { recordAudit } from '../../../infrastructure/evidence.js'
import * as repo from '../adapters/inventory-repo.js'

// The Inventory core writer inside SCM — port of apps/server
// inventory-stock-service.appendMovement for the RECEIPT path, with the same
// order of checks: authority (read) → fence (first write-side statement) →
// product → movementRule (kernel, shared with legacy) → on-hand → lot → serials
// → rows → lot receivedQty → audit → fence advance. Append-only: the store's
// triggers refuse UPDATE/DELETE of StockMovement.
//
// Transitional scope (SHARED_TRANSITION, recorded in SCM-HANDOFF.md): ISSUE and
// ADJUSTMENT keep running in the legacy writer — their callers (POS, sales-order
// COMPLETE, recipe build, transfers, stocktake, work orders) have not moved, and
// half of an atomic use case may not move alone. Here they are refused
// explicitly instead of being half-implemented.

const failure = (status, code, details) => Object.assign(new Error(code), { status, code, retryable: false, ...(details ? { details } : {}) })

/**
 * Append one RECEIPT movement (several rows for a serial product) inside the
 * caller's unit of work. `input` has the legacy appendMovement shape.
 */
export function appendReceipt(sql, scope, input, { now }) {
  const business = inventoryAuthority.require(scope, input.businessId, { write: true })
  repo.acquireFence(sql, { tenantId: business.tenantId, businessId: business.id, now })
  if (input.kind !== 'RECEIPT') throw failure(409, 'SCM_MOVEMENT_KIND_NOT_MIGRATED', { kind: input.kind })
  const product = repo.productById(sql, input.productId)
  if (!product || product.businessId !== business.id || product.tenantId !== business.tenantId) throw failure(422, 'INVENTORY_PRODUCT_NOT_FOUND')
  if (input.unit && input.unit !== product.unit) throw failure(409, 'SCM_UNIT_CONVERSION_NOT_MIGRATED', { unit: input.unit, baseUnit: product.unit })
  const data = { ...input, unit: undefined }
  const rule = movementRule(product, data)
  if (!rule.ok) throw failure(rule.code === 'INVENTORY_PRODUCT_ARCHIVED' || rule.code === 'INVENTORY_PRODUCT_PHASED_OUT' ? 409 : 422, rule.code)

  const delta = movementDelta(data.kind, data.quantity)
  const before = repo.onHandOf(sql, product.id)
  if (!Number.isSafeInteger(before + delta) || before + delta > 2_147_483_647) throw failure(409, 'INVENTORY_QUANTITY_OVERFLOW')

  let lot = null
  if (data.lotId) {
    lot = repo.lotById(sql, data.lotId)
    if (!lot || lot.productId !== product.id) throw failure(422, 'PRODUCT_LOT_NOT_FOUND')
    if (lot.status === 'CLOSED') throw failure(409, 'PRODUCT_LOT_CLOSED')
  } else if (data.lotCode) {
    lot = repo.lotByCode(sql, product.id, data.lotCode)
    if (lot?.status === 'CLOSED') throw failure(409, 'PRODUCT_LOT_CLOSED')
    lot ??= repo.createLot(sql, { code: data.lotCode, tenantId: business.tenantId, businessId: business.id, productId: product.id, now })
  }
  const occurredAt = data.occurredAt ?? now
  const base = {
    tenantId: business.tenantId, businessId: business.id, productId: product.id, lotId: lot?.id ?? null, kind: data.kind,
    reason: data.reason ?? null, reference: data.reference ?? null, actorId: scope.actorId, occurredAt, createdAt: now,
    sourceLocationId: data.sourceLocationId ?? null, targetLocationId: data.targetLocationId ?? null,
    costSatang: data.costSatang ?? null, customerId: data.customerId ?? null, salesOrderId: data.salesOrderId ?? null, workOrderId: data.workOrderId ?? null,
  }
  const rows = []
  if (product.trackingMode === 'SERIAL') {
    for (const serialNo of data.serialNos) {
      const existing = repo.serialByNo(sql, product.id, serialNo)
      if (existing && existing.status === serialStatusAfter('RECEIPT')) throw failure(409, 'INVENTORY_SERIAL_ALREADY_IN_STOCK')
      const unit = repo.receiveSerial(sql, { existing, serialNo, tenantId: business.tenantId, businessId: business.id, productId: product.id, lotId: lot?.id ?? null, now })
      const row = repo.insertMovement(sql, { ...base, lotId: unit.lotId ?? base.lotId, serialUnitId: unit.id, quantity: movementDelta(data.kind, 1) })
      recordAudit(sql, { entityType: SERIAL_UNIT_ENTITY, entityId: unit.id, action: 'SERIAL_UNIT_RECEIVED', actorId: scope.actorId, tenantId: business.tenantId, businessId: business.id, requestId: data.requestId, now, payload: { businessId: business.id, productId: product.id, serialNo, status: unit.status, movementId: row.id } })
      rows.push(row)
    }
  } else {
    rows.push(repo.insertMovement(sql, { ...base, quantity: delta }))
  }
  if (lot) repo.addLotReceivedQty(sql, lot.id, Math.abs(delta), now)
  const after = before + delta
  recordAudit(sql, {
    entityType: STOCK_MOVEMENT_ENTITY, entityId: rows[0].id, action: `STOCK_${data.kind}_RECORDED`, actorId: scope.actorId,
    tenantId: business.tenantId, businessId: business.id, requestId: data.requestId, now,
    payload: { businessId: business.id, productId: product.id, code: product.code, kind: data.kind, quantity: delta, lotId: lot?.id ?? null, serials: data.serialNos?.length ?? 0, onHandBefore: before, onHandAfter: after, reference: data.reference ?? null, sourceLocationId: base.sourceLocationId, targetLocationId: base.targetLocationId, costSatang: base.costSatang, customerId: base.customerId, salesOrderId: base.salesOrderId, workOrderId: base.workOrderId },
  })
  if (repo.advanceFence(sql, { tenantId: business.tenantId, businessId: business.id }) !== 1) throw failure(409, 'INVENTORY_LEDGER_FENCE_EXHAUSTED')
  return { productId: product.id, kind: data.kind, quantity: delta, onHandBefore: before, onHandAfter: after, lotId: lot?.id ?? null, movements: rows, costSatang: base.costSatang }
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
