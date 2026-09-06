import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import {
  PRODUCT_LOT_ENTITY,
  SERIAL_UNIT_ENTITY,
  STOCK_MOVEMENT_ENTITY,
  movementDelta,
  movementRule,
  serialStatusAfter,
  stockSummaryRow,
  zCreateLot,
  zRecordMovement,
} from '../domain/inventory'
import { loadBusiness } from './inventory-authority'

// @req FR-155 — the only writer of the stock ledger. A movement is appended,
//   never edited: RECEIPT adds, ISSUE removes, ADJUSTMENT corrects with its
//   own sign. An UNTRACKED product is refused by code — it has no ledger. A
//   LOT-tracked receipt names or creates its lot (and the lot's receivedQty
//   follows); a SERIAL-tracked movement names exactly one serial per unit,
//   creating the unit on receipt and moving it to ISSUED on issue, and an
//   ISSUE of a serial that is not IN_STOCK is refused. An ISSUE that would
//   take on-hand below zero is refused. On-hand is never stored: the summary
//   recomputes it from the ledger on every read. Every write is one
//   transaction with one audit row; manager authority throughout.
// @spec BR-002 (lot numbers and serials are attributes, never keys); SEC-001; FR-072
// @tested tests/integration/fr155-inventory-stock.test.js

const failure = (status, message) => Object.assign(new Error(message), { status })
const actor = (viewer) => viewer?.principal?.id ?? null

const PRODUCT_SELECT = { id: true, code: true, tenantId: true, businessId: true, name: true, unit: true, stockPolicy: true, trackingMode: true, safetyStock: true, status: true }
const LOT_SELECT = { id: true, code: true, tenantId: true, businessId: true, productId: true, factoryId: true, manufacturedAt: true, expiresAt: true, receivedQty: true, status: true, createdAt: true, updatedAt: true, version: true }
const SERIAL_SELECT = { id: true, serialNo: true, tenantId: true, businessId: true, productId: true, lotId: true, status: true, createdAt: true, updatedAt: true, version: true }
const MOVEMENT_SELECT = { id: true, tenantId: true, businessId: true, productId: true, lotId: true, serialUnitId: true, kind: true, quantity: true, reason: true, reference: true, actorId: true, occurredAt: true, createdAt: true }

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
  return db.productLot.findMany({ where: { businessId: business.id, ...(productId ? { productId } : {}) }, orderBy: [{ createdAt: 'asc' }], select: LOT_SELECT })
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
 * Append one movement. For a SERIAL product, one ledger row per serial (so a
 * unit's history is its own rows); otherwise one row with the whole quantity.
 */
export async function recordMovement(input, { viewer, db = prisma } = {}) {
  const data = zRecordMovement.parse(input)
  return db.$transaction(async (tx) => {
    const { business, product } = await loadProductForWrite(tx, viewer, data.businessId, data.productId)
    const rule = movementRule(product, data)
    if (!rule.ok) throw failure(rule.code === 'INVENTORY_PRODUCT_ARCHIVED' ? 409 : 422, rule.code)

    const delta = movementDelta(data.kind, data.quantity)
    const before = await onHandOf(tx, product.id)
    if (before + delta < 0) throw failure(409, 'INVENTORY_INSUFFICIENT_STOCK')

    const lot = await resolveLot(tx, business, product, data)
    const occurredAt = data.occurredAt ?? new Date()
    const base = { tenantId: business.tenantId, businessId: business.id, productId: product.id, lotId: lot?.id ?? null, kind: data.kind, reason: data.reason ?? null, reference: data.reference ?? null, actorId: actor(viewer), occurredAt }
    const rows = []

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
    } else {
      rows.push(await tx.stockMovement.create({ data: { ...base, quantity: delta }, select: MOVEMENT_SELECT }))
    }

    if (lot && data.kind === 'RECEIPT') {
      await tx.productLot.update({ where: { id: lot.id }, data: { receivedQty: { increment: Math.abs(delta) }, version: { increment: 1 } } })
    }
    const after = before + delta
    await recordAudit(tx, {
      entityType: STOCK_MOVEMENT_ENTITY, entityId: rows[0].id, action: `STOCK_${data.kind}_RECORDED`, actorId: actor(viewer),
      payload: { businessId: business.id, productId: product.id, code: product.code, kind: data.kind, quantity: delta, lotId: lot?.id ?? null, serials: data.serialNos?.length ?? 0, onHandBefore: before, onHandAfter: after, reference: data.reference ?? null },
    })
    return { productId: product.id, kind: data.kind, quantity: delta, onHandBefore: before, onHandAfter: after, lotId: lot?.id ?? null, movements: rows }
  })
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
