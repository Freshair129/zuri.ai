import { randomUUID } from 'node:crypto'

// Inventory's SKU-identity adapter: the only SQL writing ProductIdentifier and
// ProductUnitConversion, plus the FlowAccount column of Product.

const IDENTIFIER_COLUMNS = 'id, tenantId, businessId, productId, kind, value, issuer, unit, status, createdAt, updatedAt, version'
const CONVERSION_COLUMNS = 'id, tenantId, businessId, productId, unit, name, factor, usage, status, createdAt, updatedAt, version'
const plain = (row) => (row ? { ...row } : null)

export const identifierById = (sql, id) => plain(sql.get(`SELECT ${IDENTIFIER_COLUMNS} FROM ProductIdentifier WHERE id = ?`, id))
export const identifiersOf = (sql, productId, includeRetired) => sql.all(`SELECT ${IDENTIFIER_COLUMNS} FROM ProductIdentifier WHERE productId = ? ${includeRetired ? '' : "AND status = 'ACTIVE'"} ORDER BY kind, value`, productId).map(plain)
/** Every identifier of the Tenant with this value (any status), with its SKU's code, for the collision rule. */
export const identifiersWithValue = (sql, tenantId, value) => sql.all(
  'SELECT i.id, i.kind, i.value, i.productId, p.code AS productCode FROM ProductIdentifier i LEFT JOIN Product p ON p.id = i.productId WHERE i.tenantId = ? AND i.value = ?', tenantId, value,
).map((r) => ({ id: r.id, kind: r.kind, value: r.value, productId: r.productId, product: { code: r.productCode } }))
export const firstActiveIdentifier = (sql, tenantId, businessId, value) => plain(sql.get(
  "SELECT kind, value, unit, productId FROM ProductIdentifier WHERE tenantId = ? AND businessId = ? AND value = ? AND status = 'ACTIVE' ORDER BY createdAt ASC, id ASC LIMIT 1", tenantId, businessId, value,
))
export function insertIdentifier(sql, i) {
  const id = randomUUID()
  sql.run(`INSERT INTO ProductIdentifier (${IDENTIFIER_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,'ACTIVE',?,?,1)`, id, i.tenantId, i.businessId, i.productId, i.kind, i.value, i.issuer, i.unit, i.now, i.now)
  return identifierById(sql, id)
}
export const casIdentifier = (sql, { id, version, change, now }) => Number(sql.run(
  'UPDATE ProductIdentifier SET status = ?, version = version + 1, updatedAt = ? WHERE id = ? AND version = ?', change.status, now, id, version,
).changes)

export const conversionById = (sql, id) => plain(sql.get(`SELECT ${CONVERSION_COLUMNS} FROM ProductUnitConversion WHERE id = ?`, id))
export const conversionByUnit = (sql, productId, unit) => plain(sql.get('SELECT id FROM ProductUnitConversion WHERE productId = ? AND unit = ?', productId, unit))
export const activeConversion = (sql, productId, unit) => plain(sql.get("SELECT id FROM ProductUnitConversion WHERE productId = ? AND unit = ? AND status = 'ACTIVE'", productId, unit))
export const conversionsOf = (sql, productId, includeRetired) => sql.all(`SELECT ${CONVERSION_COLUMNS} FROM ProductUnitConversion WHERE productId = ? ${includeRetired ? '' : "AND status = 'ACTIVE'"} ORDER BY factor ASC, unit ASC`, productId).map(plain)
export function insertConversion(sql, c) {
  const id = randomUUID()
  sql.run(`INSERT INTO ProductUnitConversion (${CONVERSION_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,'ACTIVE',?,?,1)`, id, c.tenantId, c.businessId, c.productId, c.unit, c.name, c.factor, c.usage, c.now, c.now)
  return conversionById(sql, id)
}
const CONVERSION_CHANGE = new Set(['name', 'factor', 'usage', 'status'])
export function casConversion(sql, { id, version, change, now }) {
  const keys = Object.keys(change)
  for (const k of keys) if (!CONVERSION_CHANGE.has(k)) throw new Error(`conversion column ${k} is not updatable`)
  return Number(sql.run(`UPDATE ProductUnitConversion SET ${keys.map((k) => `${k} = ?`).join(', ')}${keys.length ? ', ' : ''}version = version + 1, updatedAt = ? WHERE id = ? AND version = ?`, ...keys.map((k) => change[k]), now, id, version).changes)
}

export const productByTenantCode = (sql, tenantId, code) => {
  const row = sql.get('SELECT id FROM Product WHERE tenantId = ? AND code = ?', tenantId, code)
  return row ? plain(sql.get('SELECT id, code, tenantId, businessId, productMasterId, name, color, material, unit, stockPolicy, trackingMode, status, mergedIntoProductId, variantJson, variantKey, flowAccountSku, version FROM Product WHERE id = ?', row.id)) : null
}
export const setProductFlowAccountSku = (sql, productId, value, now) => sql.run('UPDATE Product SET flowAccountSku = ?, version = version + 1, updatedAt = ? WHERE id = ?', value, now, productId)
