import { randomUUID } from 'node:crypto'
import { INT32_MAX } from '../../../kernel/inventory/inventory-stocktake.js'

// Inventory's SQL adapter — the ONLY code that writes Product, ProductLot,
// SerialUnit, StockMovement and InventoryLedgerFence (module-boundaries test).
// Every function takes the unit-of-work handle, never opens its own transaction.

const PRODUCT_COLUMNS = 'id, code, tenantId, businessId, name, unit, stockPolicy, trackingMode, safetyStock, status, itemKind, dedicatedCustomerId, dedicatedSalesOrderId, maintenanceIntervalDays, maxStorageDays, reorderPoint'
const LOT_COLUMNS = 'id, code, tenantId, businessId, productId, factoryId, manufacturedAt, expiresAt, receivedQty, status, lastMaintainedAt, createdAt, updatedAt, version'
const SERIAL_COLUMNS = 'id, serialNo, tenantId, businessId, productId, lotId, status, createdAt, updatedAt, version'
export const MOVEMENT_COLUMNS = 'id, tenantId, businessId, productId, lotId, serialUnitId, kind, quantity, reason, reference, actorId, occurredAt, createdAt, sourceLocationId, targetLocationId, costSatang, customerId, salesOrderId, workOrderId'

export const productById = (sql, id) => sql.get(`SELECT ${PRODUCT_COLUMNS} FROM Product WHERE id = ?`, id) ?? null
export const productsByIds = (sql, ids) => (ids.length ? sql.all(`SELECT ${PRODUCT_COLUMNS} FROM Product WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids) : [])
export const productsOfBusiness = (sql, businessId) => sql.all(`SELECT ${PRODUCT_COLUMNS} FROM Product WHERE businessId = ? AND status != 'ARCHIVED' ORDER BY code`, businessId)

export const activeConversionsOf = (sql, productId) => sql.all("SELECT unit, factor, status FROM ProductUnitConversion WHERE productId = ? AND status = 'ACTIVE'", productId).map((r) => ({ ...r }))

export const onHandOf = (sql, productId) => sql.get('SELECT COALESCE(SUM(quantity), 0) AS q FROM StockMovement WHERE productId = ?', productId).q
export const onHandByProduct = (sql, businessId) => new Map(sql.all('SELECT productId, SUM(quantity) AS q FROM StockMovement WHERE businessId = ? GROUP BY productId', businessId).map((r) => [r.productId, r.q]))

/** On-hand per lot of one product, from the ledger; lot-less rows sum under `null`. */
export const onHandByLot = (sql, productId) => new Map(sql.all('SELECT lotId, SUM(quantity) AS q FROM StockMovement WHERE productId = ? GROUP BY lotId', productId).map((r) => [r.lotId ?? null, r.q]))
export const openLotsOf = (sql, productId) => sql.all(`SELECT ${LOT_COLUMNS} FROM ProductLot WHERE productId = ? AND status = 'OPEN'`, productId)
export const locationById = (sql, id) => sql.get('SELECT id, code, tenantId, businessId, name, type, isVirtual, status FROM WarehouseLocation WHERE id = ?', id) ?? null

export function acquireFence(sql, { tenantId, businessId, now }) {
  // An UPDATE even when nothing changes: the writer reservation on SQLite and the
  // row lock on PostgreSQL — the same portable fence the legacy writer takes.
  sql.run(
    `INSERT INTO InventoryLedgerFence (id, tenantId, businessId, mutationRevision, createdAt, updatedAt) VALUES (?,?,?,0,?,?)
     ON CONFLICT (tenantId, businessId) DO UPDATE SET mutationRevision = InventoryLedgerFence.mutationRevision + 0, updatedAt = excluded.updatedAt`,
    randomUUID(), tenantId, businessId, now, now,
  )
  return sql.get('SELECT mutationRevision FROM InventoryLedgerFence WHERE tenantId = ? AND businessId = ?', tenantId, businessId).mutationRevision
}

export function advanceFence(sql, { tenantId, businessId }) {
  const result = sql.run('UPDATE InventoryLedgerFence SET mutationRevision = mutationRevision + 1 WHERE tenantId = ? AND businessId = ? AND mutationRevision < ?', tenantId, businessId, INT32_MAX)
  return Number(result.changes)
}

export const lotById = (sql, id) => sql.get(`SELECT ${LOT_COLUMNS} FROM ProductLot WHERE id = ?`, id) ?? null
export const lotByCode = (sql, productId, code) => sql.get(`SELECT ${LOT_COLUMNS} FROM ProductLot WHERE productId = ? AND code = ?`, productId, code) ?? null

export function createLot(sql, { code, tenantId, businessId, productId, now }) {
  const id = randomUUID()
  sql.run('INSERT INTO ProductLot (id, code, tenantId, businessId, productId, receivedQty, status, createdAt, updatedAt, version) VALUES (?,?,?,?,?,0,\'OPEN\',?,?,1)', id, code, tenantId, businessId, productId, now, now)
  return lotById(sql, id)
}

/** An explicit lot (FR-155 createLot): code, optional factory and dates, status. */
export function insertLot(sql, { code, tenantId, businessId, productId, factoryId, manufacturedAt, expiresAt, status, now }) {
  const id = randomUUID()
  sql.run('INSERT INTO ProductLot (id, code, tenantId, businessId, productId, factoryId, manufacturedAt, expiresAt, receivedQty, status, createdAt, updatedAt, version) VALUES (?,?,?,?,?,?,?,?,0,?,?,?,1)', id, code, tenantId, businessId, productId, factoryId ?? null, manufacturedAt ?? null, expiresAt ?? null, status ?? 'OPEN', now, now)
  return lotById(sql, id)
}
/** Lots of a Business (optionally one SKU), oldest first, with on-hand per lot from the ledger. */
export function lotsWithOnHand(sql, businessId, productId) {
  const lots = sql.all(`SELECT ${LOT_COLUMNS} FROM ProductLot WHERE businessId = ? ${productId ? 'AND productId = ?' : ''} ORDER BY createdAt, id`, ...[businessId, ...(productId ? [productId] : [])])
  if (!lots.length) return lots
  const onHand = new Map(sql.all(`SELECT lotId, COALESCE(SUM(quantity), 0) AS q FROM StockMovement WHERE lotId IN (${lots.map(() => '?').join(',')}) GROUP BY lotId`, ...lots.map((l) => l.id)).map((r) => [r.lotId, Number(r.q)]))
  return lots.map((lot) => ({ ...lot, onHand: onHand.get(lot.id) ?? 0 }))
}

export function addLotReceivedQty(sql, lotId, qty, now) {
  sql.run('UPDATE ProductLot SET receivedQty = receivedQty + ?, version = version + 1, updatedAt = ? WHERE id = ?', qty, now, lotId)
}

/** FR-179: a lock-only touch, so two maintenance records of one lot serialize and each audits the value it replaced (D-27). */
export const lockLot = (sql, lotId) => Number(sql.run('UPDATE ProductLot SET version = version WHERE id = ?', lotId).changes)
/** FR-179: a recorded maintenance resets the lot's clock. */
export function maintainLot(sql, lotId, maintainedAt, now) {
  sql.run('UPDATE ProductLot SET lastMaintainedAt = ?, version = version + 1, updatedAt = ? WHERE id = ?', maintainedAt, now, lotId)
  return lotById(sql, lotId)
}

export function setLotExpiryIfUnset(sql, lotId, expiresAt, now) {
  return Number(sql.run('UPDATE ProductLot SET expiresAt = ?, updatedAt = ?, version = version + 1 WHERE id = ? AND expiresAt IS NULL', expiresAt, now, lotId).changes)
}

export const serialByNo = (sql, productId, serialNo) => sql.get(`SELECT ${SERIAL_COLUMNS} FROM SerialUnit WHERE productId = ? AND serialNo = ?`, productId, serialNo) ?? null

export function receiveSerial(sql, { existing, serialNo, tenantId, businessId, productId, lotId, now }) {
  if (existing) {
    sql.run('UPDATE SerialUnit SET status = \'IN_STOCK\', lotId = ?, version = version + 1, updatedAt = ? WHERE id = ?', lotId ?? existing.lotId, now, existing.id)
    return serialByNo(sql, productId, serialNo)
  }
  const id = randomUUID()
  sql.run('INSERT INTO SerialUnit (id, serialNo, tenantId, businessId, productId, lotId, status, createdAt, updatedAt, version) VALUES (?,?,?,?,?,?,\'IN_STOCK\',?,?,1)', id, serialNo, tenantId, businessId, productId, lotId ?? null, now, now)
  return serialByNo(sql, productId, serialNo)
}

/** A serial unit leaves stock (FR-155): IN_STOCK → ISSUED. */
export function issueSerial(sql, unit, now) {
  sql.run("UPDATE SerialUnit SET status = 'ISSUED', version = version + 1, updatedAt = ? WHERE id = ?", now, unit.id)
  return serialByNo(sql, unit.productId, unit.serialNo)
}
export function serialsOf(sql, businessId, { productId, lotId, status } = {}) {
  return sql.all(
    `SELECT ${SERIAL_COLUMNS} FROM SerialUnit WHERE businessId = ? ${productId ? 'AND productId = ?' : ''} ${lotId ? 'AND lotId = ?' : ''} ${status ? 'AND status = ?' : ''} ORDER BY serialNo`,
    ...[businessId, ...(productId ? [productId] : []), ...(lotId ? [lotId] : []), ...(status ? [status] : [])],
  )
}

// ── Warehouse locations (FR-174): the only SQL writing WarehouseLocation ────
export const LOCATION_COLUMNS = 'id, code, tenantId, businessId, name, type, isVirtual, address, status, archivedAt, createdAt, updatedAt, version'
const location = (row) => (row ? { ...row, isVirtual: Boolean(row.isVirtual) } : null)
export const locationRow = (sql, id) => location(sql.get(`SELECT ${LOCATION_COLUMNS} FROM WarehouseLocation WHERE id = ?`, id))
export const locationCodeTaken = (sql, tenantId, code) => Boolean(sql.get('SELECT id FROM WarehouseLocation WHERE tenantId = ? AND code = ?', tenantId, code))
export function insertLocation(sql, { code, tenantId, businessId, name, type, isVirtual, address, now }) {
  const id = randomUUID()
  sql.run(`INSERT INTO WarehouseLocation (${LOCATION_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,'ACTIVE',NULL,?,?,1)`, id, code, tenantId, businessId, name, type, isVirtual ? 1 : 0, address ?? null, now, now)
  return locationRow(sql, id)
}
export function locationsOf(sql, businessId, { type, includeArchived = false } = {}) {
  return sql.all(
    `SELECT ${LOCATION_COLUMNS} FROM WarehouseLocation WHERE businessId = ? ${type ? 'AND type = ?' : ''} ${includeArchived ? '' : "AND status <> 'ARCHIVED'"} ORDER BY code`,
    ...[businessId, ...(type ? [type] : [])],
  ).map(location)
}
const LOCATION_CHANGE = new Set(['name', 'address', 'isVirtual', 'status', 'archivedAt'])
export function casLocation(sql, { id, version, change, now }) {
  const keys = Object.keys(change)
  for (const k of keys) if (!LOCATION_CHANGE.has(k)) throw new Error(`location column ${k} is not updatable`)
  const value = (k) => (k === 'isVirtual' ? (change[k] ? 1 : 0) : change[k])
  return Number(sql.run(`UPDATE WarehouseLocation SET ${keys.map((k) => `${k} = ?`).join(', ')}${keys.length ? ', ' : ''}version = version + 1, updatedAt = ? WHERE id = ? AND version = ?`, ...keys.map(value), now, id, version).changes)
}
/** Legacy archive guard: the sum of rows arriving at the location plus the rows leaving it. */
export const locatedBalance = (sql, locationId) => Number(sql.get('SELECT COALESCE(SUM(quantity), 0) AS q FROM StockMovement WHERE targetLocationId = ?', locationId).q) + Number(sql.get('SELECT COALESCE(SUM(quantity), 0) AS q FROM StockMovement WHERE sourceLocationId = ?', locationId).q)
/** Located rows of a Business (optionally one SKU) for the per-location view and the stocktake snapshot. */
export const locatedMovements = (sql, businessId, productIds) => sql.all(
  `SELECT productId, lotId, quantity, sourceLocationId, targetLocationId FROM StockMovement WHERE businessId = ? ${productIds ? `AND productId IN (${productIds.map(() => '?').join(',') || 'NULL'})` : ''}`,
  ...[businessId, ...(productIds ?? [])],
).map((m) => ({ ...m, quantity: Number(m.quantity) }))

export function insertMovement(sql, row) {
  const id = randomUUID()
  sql.run(
    `INSERT INTO StockMovement (${MOVEMENT_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, row.tenantId, row.businessId, row.productId, row.lotId ?? null, row.serialUnitId ?? null, row.kind, row.quantity,
    row.reason ?? null, row.reference ?? null, row.actorId ?? null, row.occurredAt, row.createdAt,
    row.sourceLocationId ?? null, row.targetLocationId ?? null, row.costSatang ?? null,
    row.customerId ?? null, row.salesOrderId ?? null, row.workOrderId ?? null,
  )
  return sql.get(`SELECT ${MOVEMENT_COLUMNS} FROM StockMovement WHERE id = ?`, id)
}

export const movementsOf = (sql, { businessId, productId, limit }) => sql.all(
  `SELECT ${MOVEMENT_COLUMNS} FROM StockMovement WHERE businessId = ? ${productId ? 'AND productId = ?' : ''} ORDER BY occurredAt DESC, createdAt DESC LIMIT ?`,
  ...[businessId, ...(productId ? [productId] : []), limit],
)

// ── POS terminal catalogue read (FR-183) ─────────────────────────────────────
/** ACTIVE SKUs of a Business with their master's category and Thai name, by code. */
export const activeProductsWithMaster = (sql, businessId) => sql.all(
  `SELECT p.id, p.code, p.name, p.unit, p.stockPolicy, p.trackingMode, m.categoryId AS masterCategoryId, m.nameTh AS masterNameTh
   FROM Product p LEFT JOIN ProductMaster m ON m.id = p.productMasterId
   WHERE p.businessId = ? AND p.status = 'ACTIVE' ORDER BY p.code`, businessId)
export const activeCategories = (sql, businessId) => sql.all("SELECT id, code, nameTh, nameEn FROM InventoryCategory WHERE businessId = ? AND status = 'ACTIVE' ORDER BY code", businessId)
export const sellingLocations = (sql, businessId) => sql.all("SELECT id, code, name, type, isVirtual, status FROM WarehouseLocation WHERE businessId = ? AND status = 'ACTIVE' AND isVirtual = 0 ORDER BY code", businessId)

// ── Product carton facts (TASK-ZAI-053) ──────────────────────────────────────
const CARTON_COLUMNS = 'id, code, tenantId, businessId, status, unitsPerCarton, cartonCbm, cartonKg, freightGoodsType, leadTimeDays, version'
export const productCartonRow = (sql, id) => sql.get(`SELECT ${CARTON_COLUMNS} FROM Product WHERE id = ?`, id) ?? null
const CARTON_FIELDS = new Set(['unitsPerCarton', 'cartonCbm', 'cartonKg', 'freightGoodsType', 'leadTimeDays'])
/** Compare-and-swap on (id, version): 1 when this writer won. */
export function casUpdateProductCarton(sql, { id, version, change, now }) {
  const keys = Object.keys(change)
  for (const k of keys) if (!CARTON_FIELDS.has(k)) throw new Error(`carton column ${k} is not updatable`)
  return Number(sql.run(`UPDATE Product SET ${keys.map((k) => `${k} = ?`).join(', ')}, version = version + 1, updatedAt = ? WHERE id = ? AND version = ?`, ...keys.map((k) => change[k]), now, id, version).changes)
}

/** Non-archived SKUs of a Business with their ACTIVE identifiers (SKU matching read port). */
export function productCandidates(sql, businessId) {
  const products = sql.all("SELECT id, code, name, status FROM Product WHERE businessId = ? AND status != 'ARCHIVED'", businessId)
  const identifiers = sql.all("SELECT productId, kind, value FROM ProductIdentifier WHERE businessId = ? AND status = 'ACTIVE'", businessId)
  const byProduct = new Map(products.map((p) => [p.id, []]))
  for (const i of identifiers) byProduct.get(i.productId)?.push({ kind: i.kind, value: i.value })
  return products.map((p) => ({ ...p, identifiers: byProduct.get(p.id) }))
}
