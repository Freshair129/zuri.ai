import { randomUUID } from 'node:crypto'

// Inventory's catalogue adapter: the only SQL over InventoryCategory,
// ProductFamily, Factory, ProductMaster, ProductBundle(+Item) and the catalogue
// columns of Product. Every function takes the unit-of-work handle.

export const CATEGORY_COLUMNS = 'id, code, tenantId, businessId, nameTh, nameEn, slug, vibe, targetRecipient, guardrail, status, createdAt, updatedAt, version'
export const FAMILY_COLUMNS = 'id, code, tenantId, businessId, name, description, status, createdAt, updatedAt, version'
export const FACTORY_COLUMNS = 'id, code, tenantId, businessId, name, country, contact, status, createdAt, updatedAt, version'
export const MASTER_COLUMNS = 'id, code, tenantId, businessId, categoryId, familyId, factoryId, nameTh, nameEn, baseCost, specsJson, nature, defaultStockPolicy, variantAxesJson, status, createdAt, updatedAt, version'
export const PRODUCT_COLUMNS = 'id, code, tenantId, businessId, productMasterId, name, color, material, unit, stockPolicy, trackingMode, safetyStock, status, archivedAt, createdAt, updatedAt, version, itemKind, dedicatedCustomerId, dedicatedSalesOrderId, maintenanceIntervalDays, maxStorageDays, flowAccountSku, variantJson, variantKey, mergedIntoProductId, reorderPoint, reorderQty, leadTimeDays, unitsPerCarton, cartonCbm, cartonKg, freightGoodsType'
const BUNDLE_COLUMNS = 'id, code, tenantId, businessId, name, description, targetRecipients, totalPrice, status, createdAt, updatedAt, version'

const TABLES = { inventoryCategory: 'InventoryCategory', productFamily: 'ProductFamily', factory: 'Factory', productMaster: 'ProductMaster', product: 'Product', productBundle: 'ProductBundle' }
const COLUMNS = { inventoryCategory: CATEGORY_COLUMNS, productFamily: FAMILY_COLUMNS, factory: FACTORY_COLUMNS, productMaster: MASTER_COLUMNS, product: PRODUCT_COLUMNS, productBundle: BUNDLE_COLUMNS }
const plain = (row) => (row ? { ...row } : null)

export const codeTaken = (sql, model, tenantId, code) => Boolean(sql.get(`SELECT id FROM ${TABLES[model]} WHERE tenantId = ? AND code = ?`, tenantId, code))
export const scopedRef = (sql, model, id) => plain(sql.get(`SELECT id, businessId, status FROM ${TABLES[model]} WHERE id = ?`, id))
export const byId = (sql, model, id) => plain(sql.get(`SELECT ${COLUMNS[model]} FROM ${TABLES[model]} WHERE id = ?`, id))
export const flowAccountSkuHolder = (sql, tenantId, value) => plain(sql.get('SELECT id, code FROM Product WHERE tenantId = ? AND flowAccountSku = ?', tenantId, value))
export const slugTaken = (sql, businessId, slug) => Boolean(sql.get('SELECT id FROM InventoryCategory WHERE businessId = ? AND slug = ?', businessId, slug))

/** Rows of one Business ordered by code, with optional equality filters on listed columns. */
export function listOf(sql, model, businessId, filters = {}) {
  const keys = Object.keys(filters)
  return sql.all(`SELECT ${COLUMNS[model]} FROM ${TABLES[model]} WHERE businessId = ? ${keys.map((k) => `AND ${k} = ?`).join(' ')} ORDER BY code`, businessId, ...keys.map((k) => filters[k])).map(plain)
}

/** Insert one catalogue row; `values` are column → value (camelCase columns). */
export function insertRow(sql, model, values) {
  const id = randomUUID()
  const row = { id, ...values }
  const keys = Object.keys(row)
  sql.run(`INSERT INTO ${TABLES[model]} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => row[k]))
  return byId(sql, model, id)
}

export function insertBundleItems(sql, bundleId, items) {
  for (const item of items) sql.run('INSERT INTO ProductBundleItem (id, bundleId, productId, qty) VALUES (?,?,?,?)', randomUUID(), bundleId, item.productId, item.qty)
}
export const bundleItemsOf = (sql, bundleId) => sql.all('SELECT id, productId, qty FROM ProductBundleItem WHERE bundleId = ? ORDER BY id', bundleId).map(plain)

/** SKUs of a Business with filters; `nature` joins the master. */
export function productsOf(sql, businessId, { productMasterId, includeArchived = false, stockPolicy, status, nature } = {}) {
  const where = ['p.businessId = ?']
  const params = [businessId]
  if (productMasterId) { where.push('p.productMasterId = ?'); params.push(productMasterId) }
  if (status) { where.push('p.status = ?'); params.push(status) } else if (!includeArchived) where.push("p.status != 'ARCHIVED'")
  if (stockPolicy) { where.push('p.stockPolicy = ?'); params.push(stockPolicy) }
  if (nature) { where.push('m.nature = ?'); params.push(nature) }
  const cols = PRODUCT_COLUMNS.split(', ').map((c) => `p.${c}`).join(', ')
  return sql.all(`SELECT ${cols} FROM Product p LEFT JOIN ProductMaster m ON m.id = p.productMasterId WHERE ${where.join(' AND ')} ORDER BY p.code`, ...params).map(plain)
}

/** The row that already is this variant under the master, archived or not. */
export const variantHolder = (sql, masterId, variantKey, exceptId = null) => (variantKey
  ? plain(sql.get(`SELECT id, code, status FROM Product WHERE productMasterId = ? AND variantKey = ? ${exceptId ? 'AND id != ?' : ''} ORDER BY createdAt, id LIMIT 1`, ...[masterId, variantKey, ...(exceptId ? [exceptId] : [])]))
  : null)

/** Live SKUs under a master, for the lookalike fingerprint comparison. */
export const liveUnderMaster = (sql, masterId, exceptId = null) => sql.all(
  `SELECT id, code, name, color, material, variantKey FROM Product WHERE productMasterId = ? AND status != 'ARCHIVED' ${exceptId ? 'AND id != ?' : ''} ORDER BY createdAt, id`,
  ...[masterId, ...(exceptId ? [exceptId] : [])],
).map(plain)

const PRODUCT_CHANGE = new Set(['name', 'color', 'material', 'unit', 'safetyStock', 'reorderPoint', 'reorderQty', 'leadTimeDays', 'unitsPerCarton', 'cartonCbm', 'cartonKg', 'freightGoodsType', 'variantJson', 'variantKey', 'status', 'archivedAt', 'mergedIntoProductId'])
/** Compare-and-swap on (id, version): 1 when this writer won. */
export function casUpdateProduct(sql, { id, version, change, now }) {
  const keys = Object.keys(change)
  for (const k of keys) if (!PRODUCT_CHANGE.has(k)) throw new Error(`product column ${k} is not updatable here`)
  return Number(sql.run(`UPDATE Product SET ${keys.map((k) => `${k} = ?`).join(', ')}${keys.length ? ', ' : ''}version = version + 1, updatedAt = ? WHERE id = ? AND version = ?`, ...keys.map((k) => change[k]), now, id, version).changes)
}

/** The survivor of a merge records that it absorbed another SKU: version + 1, no other column. */
export function bumpProductVersion(sql, id, now) {
  sql.run('UPDATE Product SET version = version + 1, updatedAt = ? WHERE id = ?', now, id)
  return Number(sql.get('SELECT version FROM Product WHERE id = ?', id).version)
}

// ── FR-205 MERGE: bundle items that point at a SKU ──────────────────────────
export const bundleItemsHolding = (sql, productId) => sql.all('SELECT i.id, i.bundleId, b.code AS bundleCode FROM ProductBundleItem i JOIN ProductBundle b ON b.id = i.bundleId WHERE i.productId = ? ORDER BY i.id', productId).map(plain)
export const bundleHolds = (sql, bundleId, productId) => Boolean(sql.get('SELECT id FROM ProductBundleItem WHERE bundleId = ? AND productId = ?', bundleId, productId))
export const repointBundleItems = (sql, fromId, toId) => Number(sql.run('UPDATE ProductBundleItem SET productId = ? WHERE productId = ?', toId, fromId).changes)

/** Receipt movements and confirmed-sheet price breaks feed the product page's costing. */
export const productMovements = (sql, productId) => sql.all('SELECT id, kind, quantity, costSatang, occurredAt, createdAt, reference FROM StockMovement WHERE productId = ? ORDER BY occurredAt DESC, createdAt DESC', productId).map(plain)
export const onHandSum = (sql, productIds) => (productIds.length
  ? new Map(sql.all(`SELECT productId, COALESCE(SUM(quantity), 0) AS q FROM StockMovement WHERE productId IN (${productIds.map(() => '?').join(',')}) GROUP BY productId`, ...productIds).map((r) => [r.productId, r.q]))
  : new Map())
