import { STOCK_MOVEMENT_ENTITY } from '../../../kernel/inventory/inventory.js'
import { transferRule } from '../../../kernel/inventory/warehouse-location.js'
import { recordAudit } from '../../../infrastructure/evidence.js'
import { appendMovement } from './stock-ledger.js'
import * as repo from '../adapters/inventory-repo.js'
import * as wipRepo from '../adapters/wip-repo.js'

// The transaction-scoped transfer core (FR-174) inside SCM — port of apps/server
// location-transfer-service.transferInTransaction: one ISSUE at the source and
// one RECEIPT per lot the issue touched at the target, both through the ledger
// writer (so FEFO, the below-zero refusal and the shelf-life guard apply), the
// receipt half's lot-intake increment undone (a transfer is not an arrival), and
// one STOCK_TRANSFER_RECORDED audit. Business-wide on-hand is unchanged by
// construction (BR-026). Used by the work orders' release / complete / cancel.
//
// Transitional scope: the standalone transfer command (transferStock) and the
// location writers move with the stocktake/transfers group; only this core moves
// now, because a work order cannot stage stock without it.

const failure = (status, code, details) => Object.assign(new Error(code), { status, code, retryable: false }, details === undefined ? {} : { details })

function requireLocation(sql, id, businessId) {
  if (!id) throw failure(422, 'WAREHOUSE_LOCATION_NOT_FOUND')
  const location = repo.locationById(sql, id)
  if (!location || location.businessId !== businessId) throw failure(422, 'WAREHOUSE_LOCATION_NOT_FOUND')
  return location
}

/**
 * Move `quantity` of one product between two locations inside the caller's unit
 * of work. `business` is the {id, tenantId} the caller already authorized for
 * Inventory write; `data` has the legacy zTransferStock shape (already parsed).
 */
export function transferInTransaction(sql, scope, data, { business, workOrderId = null, now, requestId }) {
  const product = repo.productById(sql, data.productId)
  if (!product || product.businessId !== business.id) throw failure(422, 'INVENTORY_PRODUCT_NOT_FOUND')
  const source = requireLocation(sql, data.sourceLocationId, business.id)
  const target = requireLocation(sql, data.targetLocationId, business.id)
  const rule = transferRule({ product, source, target })
  if (!rule.ok) throw failure(rule.code === 'INVENTORY_PRODUCT_NOT_FOUND' ? 422 : 409, rule.code)

  const occurredAt = data.occurredAt ?? now
  const reference = data.reference ?? `TRANSFER:${source.code}->${target.code}`
  const shared = {
    businessId: business.id, productId: product.id, quantity: data.quantity, reason: data.reason ?? 'STOCK_TRANSFER',
    reference, occurredAt, costSatang: data.costSatang ?? null, workOrderId, requestId,
    ...(data.serialNos?.length ? { serialNos: data.serialNos } : {}),
  }
  const issued = appendMovement(sql, scope, { ...shared, kind: 'ISSUE', sourceLocationId: source.id, ...(data.lotId ? { lotId: data.lotId } : {}), ...(data.lotCode ? { lotCode: data.lotCode } : {}) }, { now })

  const lotTracked = product.trackingMode === 'LOT'
  const mirror = lotTracked && issued.allocations.length ? issued.allocations : [{ lotId: lotTracked ? issued.lotId : null, qty: data.quantity }]
  if (lotTracked && mirror.some((allocation) => !allocation.lotId)) throw failure(409, 'INVENTORY_TRANSFER_LOT_UNKNOWN')

  const received = []
  for (const allocation of mirror) {
    received.push(appendMovement(sql, scope, { ...shared, kind: 'RECEIPT', quantity: allocation.qty, targetLocationId: target.id, ...(allocation.lotId ? { lotId: allocation.lotId } : {}) }, { now }))
    if (allocation.lotId) wipRepo.undoLotReceivedQty(sql, allocation.lotId, allocation.qty, now)
  }
  recordAudit(sql, {
    entityType: STOCK_MOVEMENT_ENTITY, entityId: received[0].movements[0].id, action: 'STOCK_TRANSFER_RECORDED', actorId: scope.actorId,
    tenantId: business.tenantId, businessId: business.id, requestId, now,
    payload: { businessId: business.id, productId: product.id, code: product.code, quantity: data.quantity, sourceLocationId: source.id, sourceLocationCode: source.code, targetLocationId: target.id, targetLocationCode: target.code, allocations: mirror, workOrderId, reference },
  })
  return {
    productId: product.id, quantity: data.quantity, sourceLocationId: source.id, targetLocationId: target.id,
    allocations: mirror, lotId: mirror[0]?.lotId ?? null, reference, onHandAfter: received[received.length - 1].onHandAfter, issued, received,
  }
}
