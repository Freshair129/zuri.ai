// Inventory's report reads: shelf-life, catalogue hygiene, replenishment and the
// catalogue-intake snapshot. Read-only — nothing here writes. Every function takes
// the unit-of-work (or read) handle.

const plain = (row) => (row ? { ...row } : null)
const placeholders = (values) => values.map(() => '?').join(',')

const REPORT_PRODUCT_COLUMNS = 'id, code, name, color, material, variantKey, productMasterId, stockPolicy, trackingMode, unit, safetyStock, reorderPoint, reorderQty, leadTimeDays, unitsPerCarton, cartonCbm, cartonKg, freightGoodsType, status, createdAt'

// ── FR-179 shelf-life ───────────────────────────────────────────────────────
/** Live SKUs of a Business that declare a storage limit. */
export const ageingProducts = (sql, businessId) => sql.all(
  "SELECT id, code, name, maintenanceIntervalDays, maxStorageDays FROM Product WHERE businessId = ? AND status != 'ARCHIVED' AND (maintenanceIntervalDays IS NOT NULL OR maxStorageDays IS NOT NULL) ORDER BY code",
  businessId,
).map(plain)

/** Lots of those SKUs with their on-hand from the ledger, oldest first. */
export function lotsWithBalance(sql, businessId, productIds) {
  if (!productIds.length) return []
  return sql.all(
    `SELECT l.id, l.code, l.productId, l.manufacturedAt, l.expiresAt, l.lastMaintainedAt, l.status,
            (SELECT COALESCE(SUM(m.quantity), 0) FROM StockMovement m WHERE m.lotId = l.id) AS onHand
       FROM ProductLot l WHERE l.businessId = ? AND l.productId IN (${placeholders(productIds)}) ORDER BY l.createdAt ASC, l.id ASC`,
    businessId, ...productIds,
  ).map((row) => ({ ...row, onHand: Number(row.onHand) }))
}

// ── FR-206 hygiene / FR-207 replenishment ───────────────────────────────────
export const mastersOf = (sql, businessId) => sql.all('SELECT id, code, nature, variantAxesJson, status FROM ProductMaster WHERE businessId = ? ORDER BY code', businessId).map(plain)

/** Every SKU of a Business (archived too) with its ACTIVE identifier count, its latest movement and its on-hand. */
export const hygieneProducts = (sql, businessId) => sql.all(
  `SELECT ${REPORT_PRODUCT_COLUMNS.split(', ').map((c) => `p.${c}`).join(', ')},
          (SELECT COUNT(*) FROM ProductIdentifier i WHERE i.productId = p.id AND i.status = 'ACTIVE') AS identifierCount,
          (SELECT MAX(m.occurredAt) FROM StockMovement m WHERE m.productId = p.id) AS lastMovementAt,
          (SELECT COALESCE(SUM(m.quantity), 0) FROM StockMovement m WHERE m.productId = p.id) AS onHand
     FROM Product p WHERE p.businessId = ? ORDER BY p.code`,
  businessId,
).map((row) => ({ ...row, identifierCount: Number(row.identifierCount), onHand: Number(row.onHand) }))

/** Counted, ACTIVE SKUs of a Business with their on-hand. */
export const replenishmentProducts = (sql, businessId) => sql.all(
  `SELECT ${REPORT_PRODUCT_COLUMNS.split(', ').map((c) => `p.${c}`).join(', ')},
          (SELECT COALESCE(SUM(m.quantity), 0) FROM StockMovement m WHERE m.productId = p.id) AS onHand
     FROM Product p WHERE p.businessId = ? AND p.stockPolicy = 'TRACKED' AND p.status = 'ACTIVE' ORDER BY p.code`,
  businessId,
).map((row) => ({ ...row, onHand: Number(row.onHand) }))

// ── FR-208 catalogue-intake snapshot (Tenant-wide by code; the planner decides the Business).
// Ordered, so a plan hashes the same on both engines.
const SNAPSHOT_PRODUCT_COLUMNS = 'id, code, businessId, status, mergedIntoProductId, productMasterId, unit, stockPolicy, trackingMode, name, color, material, variantKey'
const SNAPSHOT_MASTER_COLUMNS = 'id, code, businessId, status, nature, defaultStockPolicy, variantAxesJson'

export const categoriesByCodes = (sql, tenantId, codes) => (codes.length
  ? sql.all(`SELECT id, code, businessId, status FROM InventoryCategory WHERE tenantId = ? AND code IN (${placeholders(codes)}) ORDER BY code`, tenantId, ...codes).map(plain)
  : [])
export const mastersByCodes = (sql, tenantId, codes) => (codes.length
  ? sql.all(`SELECT ${SNAPSHOT_MASTER_COLUMNS} FROM ProductMaster WHERE tenantId = ? AND code IN (${placeholders(codes)}) ORDER BY code`, tenantId, ...codes).map(plain)
  : [])
export const mastersByIds = (sql, ids) => (ids.length
  ? sql.all(`SELECT ${SNAPSHOT_MASTER_COLUMNS} FROM ProductMaster WHERE id IN (${placeholders(ids)}) ORDER BY code`, ...ids).map(plain)
  : [])
export const productsByCodes = (sql, tenantId, codes) => (codes.length
  ? sql.all(`SELECT ${SNAPSHOT_PRODUCT_COLUMNS} FROM Product WHERE tenantId = ? AND code IN (${placeholders(codes)}) ORDER BY code`, tenantId, ...codes).map(plain)
  : [])
export const productsByIdsInTenant = (sql, tenantId, ids) => (ids.length
  ? sql.all(`SELECT ${SNAPSHOT_PRODUCT_COLUMNS} FROM Product WHERE tenantId = ? AND id IN (${placeholders(ids)}) ORDER BY code`, tenantId, ...ids).map(plain)
  : [])
export const productsUnderMasters = (sql, masterIds) => (masterIds.length
  ? sql.all(`SELECT ${SNAPSHOT_PRODUCT_COLUMNS} FROM Product WHERE productMasterId IN (${placeholders(masterIds)}) ORDER BY code`, ...masterIds).map(plain)
  : [])
export const identifiersByValues = (sql, tenantId, values) => (values.length
  ? sql.all(`SELECT kind, value, status, productId FROM ProductIdentifier WHERE tenantId = ? AND value IN (${placeholders(values)}) ORDER BY kind, value, productId`, tenantId, ...values).map(plain)
  : [])
export const conversionsOfProducts = (sql, productIds) => (productIds.length
  ? sql.all(`SELECT productId, unit, factor, status FROM ProductUnitConversion WHERE productId IN (${placeholders(productIds)}) ORDER BY productId, unit`, ...productIds).map((row) => ({ ...row, factor: Number(row.factor) }))
  : [])
