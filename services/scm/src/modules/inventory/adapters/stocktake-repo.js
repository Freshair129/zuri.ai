// Inventory's stocktake adapter: the only SQL writing InventoryStocktake. Every
// function takes the unit-of-work handle.

const COLUMNS = 'id, tenantId, businessId, idempotencyKey, payloadHash, normalizedLinesJson, snapshotVersion, snapshotHash, status, resultJson, committedAt, createdAt, updatedAt, version'
const plain = (row) => (row ? { ...row, snapshotVersion: Number(row.snapshotVersion) } : null)

export const stocktakeById = (sql, id) => plain(sql.get(`SELECT ${COLUMNS} FROM InventoryStocktake WHERE id = ?`, id))
export const stocktakeByKey = (sql, tenantId, businessId, idempotencyKey) => plain(sql.get(`SELECT ${COLUMNS} FROM InventoryStocktake WHERE tenantId = ? AND businessId = ? AND idempotencyKey = ?`, tenantId, businessId, idempotencyKey))
export function insertPreview(sql, row) {
  sql.run(
    `INSERT INTO InventoryStocktake (${COLUMNS}) VALUES (?,?,?,?,?,?,?,?,'PREVIEWED',NULL,NULL,?,?,1)`,
    row.id, row.tenantId, row.businessId, row.idempotencyKey, row.payloadHash, row.normalizedLinesJson, row.snapshotVersion, row.snapshotHash, row.now, row.now,
  )
  return stocktakeById(sql, row.id)
}
/** PREVIEWED → COMMITTED only while still PREVIEWED at this version (0 or 1 rows). */
export const commitPreview = (sql, { id, version, idempotencyKey, payloadHash, resultJson, committedAt, now }) => Number(sql.run(
  "UPDATE InventoryStocktake SET idempotencyKey = ?, payloadHash = ?, status = 'COMMITTED', resultJson = ?, committedAt = ?, version = version + 1, updatedAt = ? WHERE id = ? AND version = ? AND status = 'PREVIEWED'",
  idempotencyKey, payloadHash, resultJson, committedAt, now, id, version,
).changes)
