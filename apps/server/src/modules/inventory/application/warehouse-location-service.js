import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import {
  WAREHOUSE_LOCATION_ENTITY,
  locatedStockSummary,
  zCreateLocation,
  zLocationAction,
} from '../domain/warehouse-location'
import { loadBusiness, notFound } from './inventory-authority'

// @req FR-174 — the only writer of `WarehouseLocation`: the places a Business's
//   stock can be, each typed by what kind of place it is. `code` is unique per
//   Tenant and is an attribute, never a key (BR-002). A location is archived,
//   never deleted, because ledger rows point at it and a deleted location
//   would make a past movement unreadable; archiving keeps the history and
//   stops new transfers (`transferRule` refuses an archived end).
//   `locationStock` is the read half: on-hand per location for one product or
//   for the whole Business, recomputed from the located ledger, reported with
//   the unlocated remainder beside it rather than folded into it (BR-026).
// @spec ADR-074 D1; BR-002; BR-026; SEC-001; FR-072
// @tested tests/integration/fr174-warehouse-locations.test.js

const failure = (status, message) => Object.assign(new Error(message), { status })
const actor = (viewer) => viewer?.principal?.id ?? null

/**
 * Run in the caller's transaction when there is one, else open our own. The
 * agent's Gate F action gate hands its own `tx` down (ADR-074 D9), and a
 * nested `$transaction` on a second client would deadlock against it.
 */
const inTx = (db, fn) => (typeof db?.$transaction === 'function' ? db.$transaction(fn) : fn(db))

export const LOCATION_SELECT = {
  id: true, code: true, tenantId: true, businessId: true, name: true, type: true, isVirtual: true,
  address: true, status: true, archivedAt: true, createdAt: true, updatedAt: true, version: true,
}

export async function createLocation(input, { viewer, db = prisma } = {}) {
  const data = zCreateLocation.parse(input)
  return inTx(db, async (tx) => {
    const business = await loadBusiness(tx, viewer, data.businessId, { write: true })
    const taken = await tx.warehouseLocation.findUnique({ where: { tenantId_code: { tenantId: business.tenantId, code: data.code } }, select: { id: true } })
    if (taken) throw failure(409, 'WAREHOUSE_LOCATION_CODE_TAKEN')
    const created = await tx.warehouseLocation.create({
      data: {
        code: data.code, tenantId: business.tenantId, businessId: business.id, name: data.name, type: data.type,
        isVirtual: data.isVirtual ?? false, address: data.address ?? null,
      },
      select: LOCATION_SELECT,
    })
    await recordAudit(tx, {
      entityType: WAREHOUSE_LOCATION_ENTITY, entityId: created.id, action: 'WAREHOUSE_LOCATION_CREATED', actorId: actor(viewer),
      payload: { businessId: business.id, code: created.code, type: created.type, isVirtual: created.isVirtual },
    })
    return created
  })
}

export async function listLocations({ businessId, type, includeArchived = false, viewer, db = prisma } = {}) {
  const business = await loadBusiness(db, viewer, businessId)
  return db.warehouseLocation.findMany({
    where: { businessId: business.id, ...(type ? { type } : {}), ...(includeArchived ? {} : { status: { not: 'ARCHIVED' } }) },
    orderBy: [{ code: 'asc' }],
    select: LOCATION_SELECT,
  })
}

export async function getLocation(id, { viewer, db = prisma } = {}) {
  const locationId = typeof id === 'string' ? id.trim() : ''
  if (!locationId) throw notFound()
  const row = await db.warehouseLocation.findUnique({ where: { id: locationId }, select: LOCATION_SELECT })
  if (!row) throw notFound()
  await loadBusiness(db, viewer, row.businessId)
  return row
}

const ACTIONS = Object.freeze({ UPDATE: 'WAREHOUSE_LOCATION_UPDATED', ARCHIVE: 'WAREHOUSE_LOCATION_ARCHIVED' })

export async function applyLocationAction(id, input, { viewer, db = prisma } = {}) {
  const locationId = typeof id === 'string' ? id.trim() : ''
  if (!locationId) throw notFound()
  const data = zLocationAction.parse(input)
  return inTx(db, async (tx) => {
    const row = await tx.warehouseLocation.findUnique({ where: { id: locationId }, select: LOCATION_SELECT })
    if (!row) throw notFound()
    await loadBusiness(tx, viewer, row.businessId, { write: true })
    if (row.version !== data.version) throw failure(409, 'WAREHOUSE_LOCATION_VERSION_CONFLICT')
    if (row.status === 'ARCHIVED') throw failure(409, 'WAREHOUSE_LOCATION_ARCHIVED')
    const change = {}
    const payload = { businessId: row.businessId, code: row.code }
    if (data.action === 'UPDATE') {
      for (const key of ['name', 'address', 'isVirtual']) if (data.fields[key] !== undefined) change[key] = data.fields[key]
      payload.fields = Object.keys(change)
    } else {
      // A location still holding stock cannot be archived: the stock would
      // become unreachable by transfer while still counting toward on-hand.
      const held = await tx.stockMovement.aggregate({ where: { targetLocationId: row.id }, _sum: { quantity: true } })
      const left = await tx.stockMovement.aggregate({ where: { sourceLocationId: row.id }, _sum: { quantity: true } })
      const onHand = (held._sum.quantity ?? 0) + (left._sum.quantity ?? 0)
      if (onHand !== 0) throw Object.assign(failure(409, 'WAREHOUSE_LOCATION_NOT_EMPTY'), { details: { onHand } })
      change.status = 'ARCHIVED'
      change.archivedAt = new Date()
      payload.from = { status: row.status }
      payload.to = { status: 'ARCHIVED' }
    }
    const result = await tx.warehouseLocation.updateMany({ where: { id: row.id, version: row.version }, data: { version: { increment: 1 } } })
    if (result.count !== 1) throw failure(409, 'WAREHOUSE_LOCATION_VERSION_CONFLICT')
    await tx.warehouseLocation.update({ where: { id: row.id }, data: change })
    await recordAudit(tx, { entityType: WAREHOUSE_LOCATION_ENTITY, entityId: row.id, action: ACTIONS[data.action], actorId: actor(viewer), payload: { ...payload, version: row.version + 1 } })
    return tx.warehouseLocation.findUnique({ where: { id: row.id }, select: LOCATION_SELECT })
  })
}

/**
 * On-hand per location, recomputed from the located ledger. For one product
 * when `productId` is given, otherwise one entry per product that has any
 * located movement. `unlocated` is always reported: it is what every row
 * written before ADR-074 contributes, and folding it into a location would
 * invent a fact (BR-026).
 */
export async function locationStock({ businessId, productId, viewer, db = prisma } = {}) {
  const business = await loadBusiness(db, viewer, businessId)
  const [locations, movements] = await Promise.all([
    db.warehouseLocation.findMany({ where: { businessId: business.id }, select: LOCATION_SELECT }),
    db.stockMovement.findMany({
      where: { businessId: business.id, ...(productId ? { productId } : {}) },
      select: { productId: true, quantity: true, sourceLocationId: true, targetLocationId: true },
    }),
  ])
  const byId = new Map(locations.map((l) => [l.id, l]))
  if (productId) {
    return { businessId: business.id, productId, ...locatedStockSummary(movements, byId) }
  }
  const byProduct = new Map()
  for (const movement of movements) {
    if (!byProduct.has(movement.productId)) byProduct.set(movement.productId, [])
    byProduct.get(movement.productId).push(movement)
  }
  return {
    businessId: business.id,
    products: [...byProduct.entries()].map(([id, rows]) => ({ productId: id, ...locatedStockSummary(rows, byId) })),
  }
}
