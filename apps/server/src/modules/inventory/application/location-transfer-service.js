import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { STOCK_MOVEMENT_ENTITY } from '../domain/inventory'
import { transferRule, zTransferStock } from '../domain/warehouse-location'
import { loadBusiness } from './inventory-authority'
import { LOCATION_SELECT } from './warehouse-location-service'
import { appendMovement } from './inventory-stock-service'

// @req FR-174 — the only way stock changes place: one ISSUE at the source and
//   one RECEIPT at the target, in one transaction, both through the FR-155
//   ledger writer, so a transfer obeys every rule an ordinary movement obeys —
//   FEFO on a lot-tracked issue, the refusal to go below zero, the shelf-life
//   guard (FR-179), one audit row per half — and Business-wide on-hand is
//   unchanged by construction (BR-026). `transferInTransaction` is the
//   transaction-scoped core so a work order (FR-176, FR-177) can move stock to
//   a workshop as part of its own atomic release.
// @spec ADR-074 D2; BR-026; BR-028 (a branded SKU may never be transferred
//   into a generic-stock location); SEC-001; FR-072
// @tested tests/integration/fr174-warehouse-locations.test.js

const failure = (status, message) => Object.assign(new Error(message), { status })
const actor = (viewer) => viewer?.principal?.id ?? null

/**
 * Run in the caller's transaction when there is one, else open our own. The
 * agent's Gate F action gate hands its own `tx` down (ADR-074 D9), and a
 * nested `$transaction` on a second client would deadlock against it.
 */
const inTx = (db, fn) => (typeof db?.$transaction === 'function' ? db.$transaction(fn) : fn(db))

const PRODUCT_SELECT = { id: true, code: true, businessId: true, status: true, stockPolicy: true, trackingMode: true, itemKind: true, dedicatedCustomerId: true, dedicatedSalesOrderId: true }

/** One end of a transfer, once the viewer is allowed to see the Business it belongs to. */
async function requireLocation(tx, id, businessId) {
  if (!id) throw failure(422, 'WAREHOUSE_LOCATION_NOT_FOUND')
  const location = await tx.warehouseLocation.findUnique({ where: { id }, select: LOCATION_SELECT })
  if (!location || location.businessId !== businessId) throw failure(422, 'WAREHOUSE_LOCATION_NOT_FOUND')
  return location
}

/**
 * Move `quantity` of one product from one location to another inside the
 * caller's transaction. `data` is an already-parsed `zTransferStock` value.
 *
 * The issue names the source and the receipt names the target — deliberately
 * not one row with both, because on-hand is the sum of `quantity` and a single
 * signed row could not be counted at two places at once without every existing
 * reader learning about locations.
 */
export async function transferInTransaction(tx, data, { viewer, business, workOrderId = null } = {}) {
  const scope = business ?? await loadBusiness(tx, viewer, data.businessId, { write: true })
  const product = await tx.product.findUnique({ where: { id: data.productId }, select: PRODUCT_SELECT })
  if (!product || product.businessId !== scope.id) throw failure(422, 'INVENTORY_PRODUCT_NOT_FOUND')

  const source = await requireLocation(tx, data.sourceLocationId, scope.id)
  const target = await requireLocation(tx, data.targetLocationId, scope.id)
  const rule = transferRule({ product, source, target })
  if (!rule.ok) throw failure(rule.code === 'INVENTORY_PRODUCT_NOT_FOUND' ? 422 : 409, rule.code)

  const occurredAt = data.occurredAt ?? new Date()
  const reference = data.reference ?? `TRANSFER:${source.code}->${target.code}`
  const shared = {
    businessId: scope.id,
    productId: product.id,
    quantity: data.quantity,
    reason: data.reason ?? 'STOCK_TRANSFER',
    reference,
    occurredAt,
    costSatang: data.costSatang ?? null,
    workOrderId,
    ...(data.serialNos?.length ? { serialNos: data.serialNos } : {}),
  }

  // The issue picks the lots (named, or FEFO through the ledger). The receipt
  // then MIRRORS that pick, one row per lot the issue actually touched, so a
  // batch keeps its identity across the move instead of arriving at the far
  // end as an anonymous quantity — or, worse, as a single lot the issue only
  // partly came from.
  const issued = await appendMovement(tx, {
    ...shared,
    kind: 'ISSUE',
    sourceLocationId: source.id,
    ...(data.lotId ? { lotId: data.lotId } : {}),
    ...(data.lotCode ? { lotCode: data.lotCode } : {}),
  }, { viewer })

  const lotTracked = product.trackingMode === 'LOT'
  const mirror = lotTracked && issued.allocations.length
    ? issued.allocations
    : [{ lotId: lotTracked ? issued.lotId : null, qty: data.quantity }]
  if (lotTracked && mirror.some((allocation) => !allocation.lotId)) {
    // The source held units that belong to no lot — rows written before this
    // SKU became lot-tracked. There is no honest lot to receive them into, so
    // the move is refused rather than inventing one.
    throw failure(409, 'INVENTORY_TRANSFER_LOT_UNKNOWN')
  }

  const received = []
  for (const allocation of mirror) {
    const half = await appendMovement(tx, {
      ...shared,
      kind: 'RECEIPT',
      quantity: allocation.qty,
      targetLocationId: target.id,
      ...(allocation.lotId ? { lotId: allocation.lotId } : {}),
    }, { viewer })
    received.push(half)
    if (allocation.lotId) {
      // `receivedQty` counts arrivals from OUTSIDE the Business; a transfer is
      // not one. `appendMovement` incremented it for the receipt half, so the
      // increment is undone here rather than left to inflate a batch's intake
      // by every shelf it ever moves between.
      await tx.productLot.update({ where: { id: allocation.lotId }, data: { receivedQty: { decrement: allocation.qty } } })
    }
  }

  await recordAudit(tx, {
    entityType: STOCK_MOVEMENT_ENTITY, entityId: received[0].movements[0].id, action: 'STOCK_TRANSFER_RECORDED', actorId: actor(viewer),
    payload: {
      businessId: scope.id, productId: product.id, code: product.code, quantity: data.quantity,
      sourceLocationId: source.id, sourceLocationCode: source.code, targetLocationId: target.id, targetLocationCode: target.code,
      allocations: mirror, workOrderId, reference,
    },
  })

  return {
    productId: product.id,
    quantity: data.quantity,
    sourceLocationId: source.id,
    targetLocationId: target.id,
    allocations: mirror,
    lotId: mirror[0]?.lotId ?? null,
    reference,
    // Business-wide on-hand is unchanged by a transfer: the halves sum to
    // zero. Reported so a caller can assert it rather than trust the sentence.
    onHandAfter: received[received.length - 1].onHandAfter,
    issued,
    received,
  }
}

/** Move stock between two locations in its own transaction. */
export async function transferStock(input, { viewer, db = prisma } = {}) {
  const data = zTransferStock.parse(input)
  return inTx(db, (tx) => transferInTransaction(tx, data, { viewer }))
}
