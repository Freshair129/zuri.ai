import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import {
  PRODUCT_LOT_ENTITY,
  SERIAL_UNIT_ENTITY,
  STOCK_MOVEMENT_ENTITY,
  allocateFefo,
  movementDelta,
  movementRule,
  serialStatusAfter,
  stockSummaryRow,
  zCreateLot,
  zRecordMovement,
} from '../domain/inventory'
import { dedicationRule, shelfLifeIssueRule } from '../domain/inventory-wip'
import { loadBusiness } from './inventory-authority'
import { INT32_MAX } from '../domain/inventory-stocktake'

// @req FR-155 — the only writer of the stock ledger. A movement is appended,
//   never edited: RECEIPT adds, ISSUE removes, ADJUSTMENT corrects with its
//   own sign. An UNTRACKED product is refused by code — it has no ledger. A
//   LOT-tracked receipt names or creates its lot (and the lot's receivedQty
//   follows); a LOT-tracked issue that names a lot may not exceed that lot's
//   on-hand, and one that names no lot is consumed FEFO — first expiry, first
//   out — across OPEN lots, one ledger row per lot touched, with any units
//   that no lot holds (an adjustment without a lot) taken last. A
//   SERIAL-tracked movement names exactly one serial per unit, creating the
//   unit on receipt and moving it to ISSUED on issue, and an ISSUE of a serial
//   that is not IN_STOCK is refused. An ISSUE that would take on-hand below
//   zero is refused. On-hand is never stored: the summary recomputes it from
//   the ledger on every read. Every write is one transaction with one audit
//   row; manager authority throughout. `appendMovement` is the transaction-
//   scoped core so a recipe build (FR-156) can issue several components and
//   receive the output atomically.
//
// @req FR-174, FR-175 — since ADR-074 a movement may also carry where it came
//   from, where it went and what one unit cost landed, in satang. All of those
//   are optional and none changes an existing rule: a row that names no
//   location is exactly what every row written before ADR-074 is.
// @req FR-176 — an ISSUE of a customer-dedicated SKU for the wrong customer or
//   the wrong sales order is refused here, before a row is written (BR-028).
// @req FR-179 — an ISSUE never takes stock out of a lot past its product's
//   storage limit; FEFO skips such lots entirely, and an issue that could only
//   be satisfied from them is refused as `INVENTORY_LOT_STORAGE_EXPIRED`
//   rather than as a shortage, because the two need different fixes (BR-030).
// @spec BR-002 (lot numbers and serials are attributes, never keys); SEC-001; FR-072;
//   ADR-074 D1, D2, D3, D4, D7; BR-026, BR-027, BR-028, BR-030
// @tested tests/integration/fr155-inventory-stock.test.js,
//   tests/integration/fr174-warehouse-locations.test.js,
//   tests/integration/fr179-shelf-life-guard.test.js

const failure = (status, message) => Object.assign(new Error(message), { status })
const actor = (viewer) => viewer?.principal?.id ?? null

const PRODUCT_SELECT = { id: true, code: true, tenantId: true, businessId: true, name: true, unit: true, stockPolicy: true, trackingMode: true, safetyStock: true, status: true, itemKind: true, dedicatedCustomerId: true, dedicatedSalesOrderId: true, maintenanceIntervalDays: true, maxStorageDays: true }
const LOT_SELECT = { id: true, code: true, tenantId: true, businessId: true, productId: true, factoryId: true, manufacturedAt: true, expiresAt: true, lastMaintainedAt: true, receivedQty: true, status: true, createdAt: true, updatedAt: true, version: true }
const SERIAL_SELECT = { id: true, serialNo: true, tenantId: true, businessId: true, productId: true, lotId: true, status: true, createdAt: true, updatedAt: true, version: true }
const MOVEMENT_SELECT = { id: true, tenantId: true, businessId: true, productId: true, lotId: true, serialUnitId: true, kind: true, quantity: true, reason: true, reference: true, actorId: true, occurredAt: true, createdAt: true, sourceLocationId: true, targetLocationId: true, costSatang: true, customerId: true, salesOrderId: true, workOrderId: true }

// @req FR-184 — every writer that reads the ledger obtains this lock-only
// per-Business fence before its first write-side ledger read. The revision is
// advanced after a successful append, so stocktake snapshots can detect a
// movement that happened after they were observed.
// @spec ADR-074 D1, D2; BR-008, BR-012, BR-026
// @tested tests/integration/fr184-inventory-stocktake.test.js
export async function acquireLedgerFence(tx, { tenantId, businessId } = {}) {
  return tx.inventoryLedgerFence.upsert({
    where: { tenantId_businessId: { tenantId, businessId } },
    create: { tenantId, businessId, mutationRevision: 0 },
    // An UPDATE is intentional even when the revision is unchanged: this is
    // the portable row lock for PostgreSQL and SQLite's writer reservation.
    update: { mutationRevision: { increment: 0 }, updatedAt: new Date() },
  })
}

export async function advanceLedgerFence(tx, { tenantId, businessId } = {}) {
  const result = await tx.inventoryLedgerFence.updateMany({
    where: { tenantId, businessId, mutationRevision: { lt: INT32_MAX } },
    data: { mutationRevision: { increment: 1 } },
  })
  if (result.count !== 1) throw failure(409, 'INVENTORY_LEDGER_FENCE_EXHAUSTED')
}

async function loadProductForWrite(tx, viewer, businessId, productId) {
  const business = await loadBusiness(tx, viewer, businessId, { write: true })
  const product = await tx.product.findUnique({ where: { id: productId }, select: PRODUCT_SELECT })
  if (!product || product.businessId !== business.id) throw failure(422, 'INVENTORY_PRODUCT_NOT_FOUND')
  return { business, product }
}

async function onHandOf(tx, productId) {
  const agg = await tx.stockMovement.aggregate({ where: { productId }, _sum: { quantity: true } })
  return agg._sum.quantity ?? 0
}

/** On-hand per lot of one product, from the ledger; lot-less rows sum under `null`. */
async function onHandByLot(tx, productId) {
  const groups = await tx.stockMovement.groupBy({ by: ['lotId'], where: { productId }, _sum: { quantity: true } })
  const map = new Map()
  for (const g of groups) map.set(g.lotId ?? null, g._sum.quantity ?? 0)
  return map
}

// ── Lot ─────────────────────────────────────────────────────────────────────

export async function createLot(input, { viewer, db = prisma } = {}) {
  const data = zCreateLot.parse(input)
  return db.$transaction(async (tx) => {
    const { business, product } = await loadProductForWrite(tx, viewer, data.businessId, data.productId)
    if (product.trackingMode === 'NONE' || product.stockPolicy !== 'TRACKED') throw failure(422, 'INVENTORY_LOT_NOT_TRACKED')
    if (data.factoryId) {
      const factory = await tx.factory.findUnique({ where: { id: data.factoryId }, select: { businessId: true } })
      if (!factory || factory.businessId !== business.id) throw failure(422, 'FACTORY_NOT_FOUND')
    }
    const taken = await tx.productLot.findUnique({ where: { productId_code: { productId: product.id, code: data.code } }, select: { id: true } })
    if (taken) throw failure(409, 'PRODUCT_LOT_CODE_TAKEN')
    const lot = await tx.productLot.create({
      data: { code: data.code, tenantId: business.tenantId, businessId: business.id, productId: product.id, factoryId: data.factoryId ?? null, manufacturedAt: data.manufacturedAt ?? null, expiresAt: data.expiresAt ?? null, status: data.status ?? 'OPEN' },
      select: LOT_SELECT,
    })
    await recordAudit(tx, { entityType: PRODUCT_LOT_ENTITY, entityId: lot.id, action: 'PRODUCT_LOT_CREATED', actorId: actor(viewer), payload: { businessId: business.id, productId: product.id, code: lot.code, factoryId: lot.factoryId, expiresAt: lot.expiresAt } })
    return lot
  })
}

export async function listLots({ businessId, productId, viewer, db = prisma } = {}) {
  const business = await loadBusiness(db, viewer, businessId)
  const lots = await db.productLot.findMany({ where: { businessId: business.id, ...(productId ? { productId } : {}) }, orderBy: [{ createdAt: 'asc' }], select: LOT_SELECT })
  if (!lots.length) return lots
  const groups = await db.stockMovement.groupBy({ by: ['lotId'], where: { lotId: { in: lots.map((l) => l.id) } }, _sum: { quantity: true } })
  const onHand = new Map(groups.map((g) => [g.lotId, g._sum.quantity ?? 0]))
  return lots.map((lot) => ({ ...lot, onHand: onHand.get(lot.id) ?? 0 }))
}

export async function listSerialUnits({ businessId, productId, lotId, status, viewer, db = prisma } = {}) {
  const business = await loadBusiness(db, viewer, businessId)
  return db.serialUnit.findMany({
    where: { businessId: business.id, ...(productId ? { productId } : {}), ...(lotId ? { lotId } : {}), ...(status ? { status } : {}) },
    orderBy: [{ serialNo: 'asc' }], select: SERIAL_SELECT,
  })
}

// ── Movement ────────────────────────────────────────────────────────────────

async function resolveLot(tx, business, product, data) {
  if (data.lotId) {
    const lot = await tx.productLot.findUnique({ where: { id: data.lotId }, select: LOT_SELECT })
    if (!lot || lot.productId !== product.id) throw failure(422, 'PRODUCT_LOT_NOT_FOUND')
    if (lot.status === 'CLOSED' && data.kind === 'RECEIPT') throw failure(409, 'PRODUCT_LOT_CLOSED')
    return lot
  }
  if (data.lotCode) {
    const existing = await tx.productLot.findUnique({ where: { productId_code: { productId: product.id, code: data.lotCode } }, select: LOT_SELECT })
    if (existing) {
      if (existing.status === 'CLOSED' && data.kind === 'RECEIPT') throw failure(409, 'PRODUCT_LOT_CLOSED')
      return existing
    }
    if (data.kind !== 'RECEIPT') throw failure(422, 'PRODUCT_LOT_NOT_FOUND')
    return tx.productLot.create({ data: { code: data.lotCode, tenantId: business.tenantId, businessId: business.id, productId: product.id }, select: LOT_SELECT })
  }
  return null
}

/**
 * The transaction-scoped core: append one movement (several rows for a
 * serial product or a FEFO issue) inside the caller's transaction. `data` is
 * an already-parsed `zRecordMovement` value.
 */
export async function appendMovement(tx, data, { viewer } = {}) {
  // Authorization is a read and must precede the fence. After it succeeds,
  // acquiring the fence is the first write-side statement in this writer;
  // reading Product or on-hand before it would let a stocktake observe a
  // moving ledger. Provider-specific concurrency is proven by the real DB
  // tests rather than by this ordering comment.
  const business = await loadBusiness(tx, viewer, data.businessId, { write: true })
  await acquireLedgerFence(tx, { tenantId: business.tenantId, businessId: business.id })
  const product = await tx.product.findUnique({ where: { id: data.productId }, select: PRODUCT_SELECT })
  if (!product || product.businessId !== business.id) throw failure(422, 'INVENTORY_PRODUCT_NOT_FOUND')
  const rule = movementRule(product, data)
  if (!rule.ok) throw failure(rule.code === 'INVENTORY_PRODUCT_ARCHIVED' ? 409 : 422, rule.code)

  const delta = movementDelta(data.kind, data.quantity)
  const before = await onHandOf(tx, product.id)
  if (before + delta < 0) throw failure(409, 'INVENTORY_INSUFFICIENT_STOCK')

  const lot = await resolveLot(tx, business, product, data)
  const occurredAt = data.occurredAt ?? new Date()

  // @req FR-176 — a customer-dedicated SKU (BR-028) leaves stock only for the
  //   customer and the order it was branded for. An issue that names neither
  //   is a write-off or a correction and is allowed; one that names the wrong
  //   party is refused here, before a single row is written.
  if (data.kind === 'ISSUE') {
    const dedication = dedicationRule(product, { customerId: data.customerId ?? null, salesOrderId: data.salesOrderId ?? null })
    if (!dedication.ok) throw failure(409, dedication.code)
  }
  // @req FR-179 — an issue never takes stock out of a lot that has been in
  //   storage past its product's limit (BR-030). FEFO below additionally skips
  //   such lots when no lot is named, so a pick refuses rather than dispatches
  //   a dead battery.
  if (data.kind === 'ISSUE' && lot) {
    const shelfLife = shelfLifeIssueRule(product, lot, occurredAt)
    if (!shelfLife.ok) throw Object.assign(failure(409, shelfLife.code), { details: { lotId: lot.id, lotCode: lot.code, ageDays: shelfLife.ageDays, maxStorageDays: product.maxStorageDays } })
  }

  const base = {
    tenantId: business.tenantId, businessId: business.id, productId: product.id, lotId: lot?.id ?? null, kind: data.kind,
    reason: data.reason ?? null, reference: data.reference ?? null, actorId: actor(viewer), occurredAt,
    // @req FR-174, FR-175 — a movement carries where it moved and what a unit
    //   cost. An ISSUE leaves its source; a RECEIPT arrives at its target; a
    //   transfer is the pair (BR-026).
    sourceLocationId: data.sourceLocationId ?? null,
    targetLocationId: data.targetLocationId ?? null,
    costSatang: data.costSatang ?? null,
    customerId: data.customerId ?? null,
    salesOrderId: data.salesOrderId ?? null,
    workOrderId: data.workOrderId ?? null,
  }
  const rows = []
  const allocations = []

  if (product.trackingMode === 'SERIAL') {
    const nextStatus = serialStatusAfter(data.kind)
    for (const serialNo of data.serialNos) {
      let unit = await tx.serialUnit.findUnique({ where: { productId_serialNo: { productId: product.id, serialNo } }, select: SERIAL_SELECT })
      if (data.kind === 'RECEIPT') {
        if (unit && unit.status === 'IN_STOCK') throw failure(409, 'INVENTORY_SERIAL_ALREADY_IN_STOCK')
        unit = unit
          ? await tx.serialUnit.update({ where: { id: unit.id }, data: { status: nextStatus, lotId: lot?.id ?? unit.lotId, version: { increment: 1 } }, select: SERIAL_SELECT })
          : await tx.serialUnit.create({ data: { serialNo, tenantId: business.tenantId, businessId: business.id, productId: product.id, lotId: lot?.id ?? null, status: nextStatus }, select: SERIAL_SELECT })
      } else {
        if (!unit || unit.status !== 'IN_STOCK') throw failure(409, 'INVENTORY_SERIAL_NOT_IN_STOCK')
        unit = await tx.serialUnit.update({ where: { id: unit.id }, data: { status: nextStatus, version: { increment: 1 } }, select: SERIAL_SELECT })
      }
      const row = await tx.stockMovement.create({ data: { ...base, lotId: unit.lotId ?? base.lotId, serialUnitId: unit.id, quantity: movementDelta(data.kind, 1) }, select: MOVEMENT_SELECT })
      await recordAudit(tx, { entityType: SERIAL_UNIT_ENTITY, entityId: unit.id, action: data.kind === 'RECEIPT' ? 'SERIAL_UNIT_RECEIVED' : 'SERIAL_UNIT_ISSUED', actorId: actor(viewer), payload: { businessId: business.id, productId: product.id, serialNo, status: unit.status, movementId: row.id } })
      rows.push(row)
    }
  } else if (product.trackingMode === 'LOT' && data.kind === 'ISSUE') {
    const byLot = await onHandByLot(tx, product.id)
    if (lot) {
      // An issue that names its lot may not take more than that lot holds.
      if ((byLot.get(lot.id) ?? 0) < Math.abs(delta)) throw failure(409, 'INVENTORY_LOT_INSUFFICIENT_STOCK')
      const row = await tx.stockMovement.create({ data: { ...base, quantity: delta }, select: MOVEMENT_SELECT })
      rows.push(row)
      allocations.push({ lotId: lot.id, qty: Math.abs(delta) })
    } else {
      // FEFO across open lots; whatever no lot holds (an adjustment without a lot) goes last.
      const lots = await tx.productLot.findMany({ where: { productId: product.id, status: 'OPEN' }, select: { id: true, code: true, expiresAt: true, manufacturedAt: true, lastMaintainedAt: true, createdAt: true, status: true } })
      // @req FR-179 — a lot past its storage limit is not a candidate. FEFO
      //   still orders by expiry among the rest; this only removes the ones no
      //   pick may take (BR-030).
      const issuable = lots.filter((l) => shelfLifeIssueRule(product, l, occurredAt).ok)
      const { allocations: picked, remainder } = allocateFefo(issuable.map((l) => ({ ...l, onHand: byLot.get(l.id) ?? 0 })), Math.abs(delta))
      if (remainder > (byLot.get(null) ?? 0)) {
        // Distinguish "there is not enough" from "there is enough, but the only
        // lots holding it may not leave the shelf" — the second is a
        // maintenance job, not a purchase order.
        const blocked = lots.filter((l) => !shelfLifeIssueRule(product, l, occurredAt).ok && (byLot.get(l.id) ?? 0) > 0)
        if (blocked.length) {
          throw Object.assign(failure(409, 'INVENTORY_LOT_STORAGE_EXPIRED'), {
            details: { blockedLots: blocked.map((l) => ({ lotId: l.id, lotCode: l.code, onHand: byLot.get(l.id) ?? 0 })), maxStorageDays: product.maxStorageDays },
          })
        }
        throw failure(409, 'INVENTORY_INSUFFICIENT_STOCK')
      }
      for (const pick of picked) {
        rows.push(await tx.stockMovement.create({ data: { ...base, lotId: pick.lotId, quantity: -pick.qty }, select: MOVEMENT_SELECT }))
        allocations.push(pick)
      }
      if (remainder > 0) {
        rows.push(await tx.stockMovement.create({ data: { ...base, lotId: null, quantity: -remainder }, select: MOVEMENT_SELECT }))
        allocations.push({ lotId: null, qty: remainder })
      }
    }
  } else {
    rows.push(await tx.stockMovement.create({ data: { ...base, quantity: delta }, select: MOVEMENT_SELECT }))
  }

  if (lot && data.kind === 'RECEIPT') {
    await tx.productLot.update({ where: { id: lot.id }, data: { receivedQty: { increment: Math.abs(delta) }, version: { increment: 1 } } })
  }
  const after = before + delta
  await recordAudit(tx, {
    entityType: STOCK_MOVEMENT_ENTITY, entityId: rows[0].id, action: `STOCK_${data.kind}_RECORDED`, actorId: actor(viewer),
    payload: {
      businessId: business.id, productId: product.id, code: product.code, kind: data.kind, quantity: delta, lotId: lot?.id ?? null,
      allocations: allocations.length ? allocations : undefined, serials: data.serialNos?.length ?? 0,
      onHandBefore: before, onHandAfter: after, reference: data.reference ?? null,
      sourceLocationId: base.sourceLocationId, targetLocationId: base.targetLocationId, costSatang: base.costSatang,
      customerId: base.customerId, salesOrderId: base.salesOrderId, workOrderId: base.workOrderId,
    },
  })
  await advanceLedgerFence(tx, { tenantId: business.tenantId, businessId: business.id })
  return { productId: product.id, kind: data.kind, quantity: delta, onHandBefore: before, onHandAfter: after, lotId: lot?.id ?? null, allocations, movements: rows, costSatang: base.costSatang }
}

/** Append one movement in its own transaction. */
export async function recordMovement(input, { viewer, db = prisma } = {}) {
  const data = zRecordMovement.parse(input)
  return db.$transaction((tx) => appendMovement(tx, data, { viewer }))
}

export async function listMovements({ businessId, productId, limit = 200, viewer, db = prisma } = {}) {
  const business = await loadBusiness(db, viewer, businessId)
  const take = Math.min(Math.max(1, Number(limit) || 200), 500)
  return db.stockMovement.findMany({ where: { businessId: business.id, ...(productId ? { productId } : {}) }, orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }], take, select: MOVEMENT_SELECT })
}

/** Every product of the Business with its recomputed on-hand; uncounted products carry null, never zero. */
export async function stockSummary({ businessId, includeArchived = false, viewer, db = prisma } = {}) {
  const business = await loadBusiness(db, viewer, businessId)
  const products = await db.product.findMany({
    where: { businessId: business.id, ...(includeArchived ? {} : { status: { not: 'ARCHIVED' } }) },
    orderBy: [{ code: 'asc' }],
    select: { ...PRODUCT_SELECT, movements: { select: { quantity: true } } },
  })
  const rows = products.map(({ movements, ...product }) => stockSummaryRow(product, movements))
  return {
    businessId: business.id,
    products: rows,
    counts: {
      products: rows.length,
      tracked: rows.filter((r) => r.stockPolicy === 'TRACKED').length,
      untracked: rows.filter((r) => r.stockPolicy !== 'TRACKED').length,
      belowSafetyStock: rows.filter((r) => r.belowSafetyStock).length,
    },
  }
}
