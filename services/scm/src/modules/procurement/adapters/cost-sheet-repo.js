import { randomUUID } from 'node:crypto'

// Procurement-owned cost-sheet persistence (SupplierCostSheet, SupplierCostLine).

const SHEET_COLUMNS = 'id, code, tenantId, businessId, supplierId, currency, fxRateLocked, sourceRef, sourceSha256, previewHash, previewJson, status, lineCount, createdByPersonId, confirmedByPersonId, confirmedAt, supersededAt, createdAt, updatedAt, version'
const LINE_COLUMNS = 'id, sheetId, productId, sourceSku, minQty, unitCostForeign, unitsPerCarton, cartonCbm, cartonKg, freightGoodsType, leadTimeDays, mappingConfidence, mappingConfirmedByPersonId, mappingConfirmedAt, createdAt, updatedAt'

const supplierOf = (sql, id) => { const s = sql.get('SELECT id, code, name FROM Supplier WHERE id = ?', id); return s ? { ...s } : null }
const withSupplier = (sql, row) => row && ({ ...row, supplier: supplierOf(sql, row.supplierId) })

/** Full sheet: header + supplier {id, code, name} + lines ordered by minQty, sourceSku. */
export function loadSheet(sql, where) {
  const row = where.id
    ? sql.get(`SELECT ${SHEET_COLUMNS} FROM SupplierCostSheet WHERE id = ?`, where.id)
    : sql.get(`SELECT ${SHEET_COLUMNS} FROM SupplierCostSheet WHERE businessId = ? AND sourceSha256 = ?`, where.businessId, where.sourceSha256)
  if (!row) return null
  return { ...withSupplier(sql, row), lines: sql.all(`SELECT ${LINE_COLUMNS} FROM SupplierCostLine WHERE sheetId = ? ORDER BY minQty ASC, sourceSku ASC`, row.id) }
}

/** Summaries (no preview, no lines), newest first. */
export function listSheets(sql, { businessId, supplierId, status, take }) {
  const rows = sql.all(
    `SELECT ${SHEET_COLUMNS.replace(', previewJson', '')} FROM SupplierCostSheet WHERE businessId = ? ${supplierId ? 'AND supplierId = ?' : ''} ${status ? 'AND status = ?' : ''} ORDER BY createdAt DESC, id DESC LIMIT ?`,
    ...[businessId, ...(supplierId ? [supplierId] : []), ...(status ? [status] : []), take],
  )
  return rows.map((row) => withSupplier(sql, row))
}

export function insertSheet(sql, s) {
  const id = randomUUID()
  sql.run(
    'INSERT INTO SupplierCostSheet (id, code, tenantId, businessId, supplierId, currency, fxRateLocked, sourceRef, sourceSha256, previewHash, previewJson, status, lineCount, createdByPersonId, createdAt, updatedAt, version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)',
    id, s.code, s.tenantId, s.businessId, s.supplierId, s.currency, s.fxRateLocked, s.sourceRef ?? null, s.sourceSha256, s.previewHash, s.previewJson, 'DRAFT', s.lineCount, s.createdByPersonId ?? null, s.now, s.now,
  )
  return id
}

export function insertLine(sql, l) {
  sql.run(
    'INSERT INTO SupplierCostLine (id, sheetId, productId, sourceSku, minQty, unitCostForeign, unitsPerCarton, cartonCbm, cartonKg, freightGoodsType, leadTimeDays, mappingConfidence, mappingConfirmedByPersonId, mappingConfirmedAt, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    randomUUID(), l.sheetId, l.productId, l.sourceSku, l.minQty, l.unitCostForeign, l.unitsPerCarton ?? null, l.cartonCbm ?? null, l.cartonKg ?? null, l.freightGoodsType ?? null, l.leadTimeDays ?? null, l.mappingConfidence, l.mappingConfirmedByPersonId ?? null, l.mappingConfirmedAt ?? null, l.now, l.now,
  )
}

/** Every other CONFIRMED sheet of this supplier becomes SUPERSEDED (legacy updateMany). */
export const supersedeConfirmed = (sql, { businessId, supplierId, exceptId, now }) => Number(sql.run(
  "UPDATE SupplierCostSheet SET status = 'SUPERSEDED', supersededAt = ?, version = version + 1, updatedAt = ? WHERE businessId = ? AND supplierId = ? AND status = 'CONFIRMED' AND id != ?",
  now, now, businessId, supplierId, exceptId,
).changes)

/** Lines of CONFIRMED sheets for one SKU with their sheet and supplier, by minQty then source SKU. */
export const confirmedLinesOfProduct = (sql, productId) => sql.all(
  `SELECT l.id, l.sourceSku, l.minQty, l.unitCostForeign, l.unitsPerCarton, l.cartonCbm, l.cartonKg, l.freightGoodsType, l.leadTimeDays,
          s.id AS sheetId, s.code AS sheetCode, s.currency, s.fxRateLocked, s.sourceSha256, s.confirmedAt, s.supplierId
   FROM SupplierCostLine l JOIN SupplierCostSheet s ON s.id = l.sheetId
   WHERE l.productId = ? AND s.status = 'CONFIRMED' ORDER BY l.minQty ASC, l.sourceSku ASC`, productId).map((row) => ({ ...row, supplier: supplierOf(sql, row.supplierId) }))

/** DRAFT → CONFIRMED by compare-and-swap on (id, version, DRAFT). */
export const confirmSheet = (sql, { id, version, actorId, now }) => Number(sql.run(
  "UPDATE SupplierCostSheet SET status = 'CONFIRMED', confirmedByPersonId = ?, confirmedAt = ?, version = version + 1, updatedAt = ? WHERE id = ? AND version = ? AND status = 'DRAFT'",
  actorId ?? null, now, now, id, version,
).changes)
