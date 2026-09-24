import { WAREHOUSE_LOCATION_ENTITY, locatedStockSummary, zCreateLocation, zLocationAction, zTransferStock } from '../../../kernel/inventory/warehouse-location.js'
import { denied, inventoryAuthority } from '../../../infrastructure/delegation.js'
import { enqueueOutbox, recordAudit } from '../../../infrastructure/evidence.js'
import { transferInTransaction } from './transfers.js'
import * as repo from '../adapters/inventory-repo.js'

// Warehouse locations (FR-174) inside SCM — port of apps/server
// warehouse-location-service and location-transfer-service.transferStock with the
// same codes, order of refusals and audit actions. A location is Business-scoped
// with a Tenant-unique code, typed, archived and never deleted (ledger rows point
// at it); a location still holding stock cannot be archived. The located view
// recomputes on-hand per location from the ledger and reports the unlocated
// remainder beside the total, never folded into it (BR-026).

const failure = (status, code, details) => Object.assign(new Error(code), { status, code, retryable: false }, details === undefined ? {} : { details })
const iso = (value) => (value instanceof Date ? value.toISOString() : value)
const ACTIONS = Object.freeze({ UPDATE: 'WAREHOUSE_LOCATION_UPDATED', ARCHIVE: 'WAREHOUSE_LOCATION_ARCHIVED' })

function evidence(sql, scope, { entityId, action, business, payload, version, ctx }) {
  recordAudit(sql, { entityType: WAREHOUSE_LOCATION_ENTITY, entityId, action, actorId: scope.actorId, tenantId: business.tenantId, businessId: business.id, requestId: ctx.requestId, now: ctx.now, payload })
  enqueueOutbox(sql, { topic: `scm.inventory.${action.toLowerCase().replace(/_/g, '-')}`, aggregateType: WAREHOUSE_LOCATION_ENTITY, aggregateId: entityId, aggregateVersion: version, now: ctx.now, payload: { businessId: business.id, locationId: entityId } })
}

export const creatorOf = (scope, body) => inventoryAuthority.require(scope, zCreateLocation.parse(body).businessId, { write: true }).id
export const transferrerOf = (scope, body) => inventoryAuthority.require(scope, zTransferStock.parse(body).businessId, { write: true }).id
/** The location an action targets, with Inventory write authority on its Business; 404 otherwise. */
export function locationForWrite(sql, scope, id) {
  const row = typeof id === 'string' && id.trim() ? repo.locationRow(sql, id.trim()) : null
  if (!row || row.tenantId !== scope.tenantId) throw denied()
  inventoryAuthority.require(scope, row.businessId, { write: true })
  return row
}

export function createLocation(sql, scope, input, ctx) {
  const data = zCreateLocation.parse(input)
  const business = inventoryAuthority.require(scope, data.businessId, { write: true })
  if (repo.locationCodeTaken(sql, business.tenantId, data.code)) throw failure(409, 'WAREHOUSE_LOCATION_CODE_TAKEN')
  const created = repo.insertLocation(sql, { code: data.code, tenantId: business.tenantId, businessId: business.id, name: data.name, type: data.type, isVirtual: data.isVirtual ?? false, address: data.address ?? null, now: ctx.now })
  evidence(sql, scope, { entityId: created.id, action: 'WAREHOUSE_LOCATION_CREATED', business, version: 1, ctx, payload: { businessId: business.id, code: created.code, type: created.type, isVirtual: created.isVirtual } })
  return { response: { location: created }, affected: { locationId: created.id, version: created.version } }
}

export function listLocations(sql, scope, { businessId, type, includeArchived = false }) {
  const business = inventoryAuthority.require(scope, typeof businessId === 'string' ? businessId.trim() : '')
  return repo.locationsOf(sql, business.id, { type: type || undefined, includeArchived })
}

export function getLocation(sql, scope, id) {
  const row = typeof id === 'string' && id.trim() ? repo.locationRow(sql, id.trim()) : null
  if (!row || row.tenantId !== scope.tenantId) throw denied()
  inventoryAuthority.require(scope, row.businessId)
  return row
}

export function applyLocationAction(sql, scope, id, input, ctx) {
  const data = zLocationAction.parse(input)
  const row = locationForWrite(sql, scope, id)
  const business = inventoryAuthority.require(scope, row.businessId, { write: true })
  if (row.version !== data.version) throw failure(409, 'WAREHOUSE_LOCATION_VERSION_CONFLICT')
  if (row.status === 'ARCHIVED') throw failure(409, 'WAREHOUSE_LOCATION_ARCHIVED')
  const change = {}
  const payload = { businessId: row.businessId, code: row.code }
  if (data.action === 'UPDATE') {
    for (const key of ['name', 'address', 'isVirtual']) if (data.fields[key] !== undefined) change[key] = data.fields[key]
    payload.fields = Object.keys(change)
  } else {
    // A location still holding stock cannot be archived: it would become unreachable by transfer while counting toward on-hand.
    const onHand = repo.locatedBalance(sql, row.id)
    if (onHand !== 0) throw failure(409, 'WAREHOUSE_LOCATION_NOT_EMPTY', { onHand })
    change.status = 'ARCHIVED'
    change.archivedAt = ctx.now
    payload.from = { status: row.status }
    payload.to = { status: 'ARCHIVED' }
  }
  if (repo.casLocation(sql, { id: row.id, version: row.version, change, now: ctx.now }) !== 1) throw failure(409, 'WAREHOUSE_LOCATION_VERSION_CONFLICT')
  evidence(sql, scope, { entityId: row.id, action: ACTIONS[data.action], business, version: row.version + 1, ctx, payload: { ...payload, version: row.version + 1 } })
  const fresh = repo.locationRow(sql, row.id)
  return { response: { location: fresh }, affected: { locationId: row.id, version: fresh.version, status: fresh.status } }
}

/** On-hand per location for one SKU, or one entry per SKU with any movement; the unlocated remainder is always reported. */
export function locationStock(sql, scope, { businessId, productId }) {
  const business = inventoryAuthority.require(scope, typeof businessId === 'string' ? businessId.trim() : '')
  const byId = new Map(repo.locationsOf(sql, business.id, { includeArchived: true }).map((l) => [l.id, l]))
  const movements = repo.locatedMovements(sql, business.id, productId ? [productId] : null)
  if (productId) return { businessId: business.id, productId, ...locatedStockSummary(movements, byId) }
  const byProduct = new Map()
  for (const movement of movements) {
    if (!byProduct.has(movement.productId)) byProduct.set(movement.productId, [])
    byProduct.get(movement.productId).push(movement)
  }
  return { businessId: business.id, products: [...byProduct.entries()].map(([id, rows]) => ({ productId: id, ...locatedStockSummary(rows, byId) })) }
}

/** Move stock between two locations in its own unit of work (legacy transferStock). */
export function transferStock(sql, scope, input, ctx) {
  const data = zTransferStock.parse(input)
  const business = inventoryAuthority.require(scope, data.businessId, { write: true })
  const result = transferInTransaction(sql, scope, { ...data, occurredAt: iso(data.occurredAt) }, { business, now: ctx.now, requestId: ctx.requestId })
  return { response: { transfer: result }, affected: { productId: result.productId, quantity: result.quantity, sourceLocationId: result.sourceLocationId, targetLocationId: result.targetLocationId } }
}
