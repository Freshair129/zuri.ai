import { randomUUID } from 'node:crypto'
import { INT32_MAX } from '../../../kernel/inventory/inventory-stocktake.js'

// Inventory's SQL adapter — the ONLY code that writes Product, ProductLot,
// SerialUnit, StockMovement and InventoryLedgerFence (module-boundaries test).
// Every function takes the unit-of-work handle, never opens its own transaction.

const PRODUCT_COLUMNS = 'id, code, tenantId, businessId, name, unit, stockPolicy, trackingMode, safetyStock, status, itemKind, dedicatedCustomerId, dedicatedSalesOrderId, maintenanceIntervalDays, maxStorageDays, reorderPoint'
const LOT_COLUMNS = 'id, code, tenantId, businessId, productId, manufacturedAt, expiresAt, receivedQty, status, lastMaintainedAt, createdAt, updatedAt, version'
const SERIAL_COLUMNS = 'id, serialNo, tenantId, businessId, productId, lotId, status, createdAt, updatedAt, version'
export const MOVEMENT_COLUMNS = 'id, tenantId, businessId, productId, lotId, serialUnitId, kind, quantity, reason, reference, actorId, occurredAt, createdAt, sourceLocationId, targetLocationId, costSatang, customerId, salesOrderId, workOrderId'

export const productById = (sql, id) => sql.get(`SELECT ${PRODUCT_COLUMNS} FROM Product WHERE id = ?`, id) ?? null
export const productsByIds = (sql, ids) => (ids.length ? sql.all(`SELECT ${PRODUCT_COLUMNS} FROM Product WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids) : [])
export const productsOfBusiness = (sql, businessId) => sql.all(`SELECT ${PRODUCT_COLUMNS} FROM Product WHERE businessId = ? AND status != 'ARCHIVED' ORDER BY code`, businessId)

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
     ON CONFLICT (tenantId, businessId) DO UPDATE SET mutationRevision = mutationRevision + 0, updatedAt = excluded.updatedAt`,
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

export function addLotReceivedQty(sql, lotId, qty, now) {
  sql.run('UPDATE ProductLot SET receivedQty = receivedQty + ?, version = version + 1, updatedAt = ? WHERE id = ?', qty, now, lotId)
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
