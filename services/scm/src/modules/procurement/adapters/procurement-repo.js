import { randomUUID } from 'node:crypto'

// Procurement's SQL adapter — the ONLY code that writes Supplier, PurchaseOrder,
// PurchaseOrderLine, GoodsReceipt and GoodsReceiptLine. Reads of Product go
// through Inventory's public API, never a join from here.

const SUPPLIER_COLUMNS = 'id, code, tenantId, businessId, name, taxId, contactName, phone, email, address, paymentTerms, leadTimeDays, notes, status, createdAt, updatedAt, version'
const PO_COLUMNS = 'id, code, tenantId, businessId, supplierId, status, currency, expectedAt, notes, orderedAt, sentAt, receivedAt, closedAt, closeReason, cancelledAt, cancelReason, createdByPersonId, createdAt, updatedAt, version'
const LINE_COLUMNS = 'id, purchaseOrderId, productId, description, qty, unitCostSatang, sortOrder'
const RECEIPT_COLUMNS = 'id, code, tenantId, businessId, purchaseOrderId, supplierReference, notes, receivedAt, postedByPersonId, createdAt'
const RECEIPT_LINE_COLUMNS = 'id, receiptId, purchaseOrderLineId, qty, lotCode, expiresAt, serialNosJson'

export const supplierById = (sql, id) => sql.get(`SELECT ${SUPPLIER_COLUMNS} FROM Supplier WHERE id = ?`, id) ?? null
export const supplierByCode = (sql, tenantId, code) => sql.get('SELECT id FROM Supplier WHERE tenantId = ? AND code = ?', tenantId, code) ?? null

export function insertSupplier(sql, data) {
  const id = randomUUID()
  sql.run(
    `INSERT INTO Supplier (${SUPPLIER_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?,1)`,
    id, data.code, data.tenantId, data.businessId, data.name, data.taxId ?? null, data.contactName ?? null, data.phone ?? null,
    data.email ?? null, data.address ?? null, data.paymentTerms ?? null, data.leadTimeDays ?? null, data.notes ?? null, data.now, data.now,
  )
  return supplierById(sql, id)
}

export const countCodesWithPrefix = (sql, table, tenantId, prefix) => sql.get(`SELECT COUNT(*) AS n FROM ${table === 'GoodsReceipt' ? 'GoodsReceipt' : 'PurchaseOrder'} WHERE tenantId = ? AND code LIKE ?`, tenantId, `${prefix}%`).n
export const codeTaken = (sql, table, tenantId, code) => Boolean(sql.get(`SELECT id FROM ${table === 'GoodsReceipt' ? 'GoodsReceipt' : 'PurchaseOrder'} WHERE tenantId = ? AND code = ?`, tenantId, code))

export function insertPurchaseOrder(sql, data, lines) {
  const id = randomUUID()
  sql.run(
    `INSERT INTO PurchaseOrder (${PO_COLUMNS}) VALUES (?,?,?,?,?,'DRAFT',?,?,?,?,NULL,NULL,NULL,NULL,NULL,NULL,?,?,?,1)`,
    id, data.code, data.tenantId, data.businessId, data.supplierId, data.currency, data.expectedAt ?? null, data.notes ?? null, data.orderedAt, data.createdByPersonId ?? null, data.now, data.now,
  )
  insertLines(sql, id, lines)
  return id
}

export function insertLines(sql, purchaseOrderId, lines) {
  for (const line of lines) {
    sql.run(`INSERT INTO PurchaseOrderLine (${LINE_COLUMNS}) VALUES (?,?,?,?,?,?,?)`, randomUUID(), purchaseOrderId, line.productId ?? null, line.description, line.qty, line.unitCostSatang, line.sortOrder)
  }
}
export const deleteLines = (sql, purchaseOrderId) => sql.run('DELETE FROM PurchaseOrderLine WHERE purchaseOrderId = ?', purchaseOrderId)

/** The PO with lines (each with its receipt lines) and receipts — the legacy PO_SELECT shape. */
export function loadPurchaseOrder(sql, id) {
  const order = sql.get(`SELECT ${PO_COLUMNS} FROM PurchaseOrder WHERE id = ?`, id)
  if (!order) return null
  const lines = sql.all(`SELECT ${LINE_COLUMNS} FROM PurchaseOrderLine WHERE purchaseOrderId = ? ORDER BY sortOrder`, id)
  const receiptLines = sql.all(`SELECT l.id, l.receiptId, l.purchaseOrderLineId, l.qty FROM GoodsReceiptLine l JOIN GoodsReceipt r ON r.id = l.receiptId WHERE r.purchaseOrderId = ?`, id)
  for (const line of lines) line.receiptLines = receiptLines.filter((r) => r.purchaseOrderLineId === line.id).map(({ id: rid, receiptId, qty }) => ({ id: rid, receiptId, qty }))
  const receipts = sql.all(`SELECT ${RECEIPT_COLUMNS} FROM GoodsReceipt WHERE purchaseOrderId = ? ORDER BY receivedAt, createdAt`, id)
  for (const receipt of receipts) receipt.lines = sql.all(`SELECT ${RECEIPT_LINE_COLUMNS} FROM GoodsReceiptLine WHERE receiptId = ?`, receipt.id)
  return { ...order, supplier: supplierById(sql, order.supplierId), lines, receipts }
}

/** Compare-and-swap on (id, version): the only way a PurchaseOrder row changes. */
export function casUpdatePurchaseOrder(sql, { id, version, change, now }) {
  const keys = Object.keys(change)
  const assignments = keys.map((k) => `${k} = ?`).join(', ')
  const result = sql.run(
    `UPDATE PurchaseOrder SET ${assignments}${keys.length ? ', ' : ''}version = version + 1, updatedAt = ? WHERE id = ? AND version = ?`,
    ...keys.map((k) => change[k]), now, id, version,
  )
  return Number(result.changes)
}

export function insertReceipt(sql, data, lines) {
  const id = randomUUID()
  sql.run(
    `INSERT INTO GoodsReceipt (${RECEIPT_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id, data.code, data.tenantId, data.businessId, data.purchaseOrderId, data.supplierReference ?? null, data.notes ?? null, data.receivedAt, data.postedByPersonId ?? null, data.now,
  )
  for (const line of lines) {
    sql.run(`INSERT INTO GoodsReceiptLine (${RECEIPT_LINE_COLUMNS}) VALUES (?,?,?,?,?,?,?)`, randomUUID(), id, line.purchaseOrderLineId, line.qty, line.lotCode ?? null, line.expiresAt ?? null, line.serialNos?.length ? JSON.stringify(line.serialNos) : null)
  }
  const receipt = sql.get(`SELECT ${RECEIPT_COLUMNS} FROM GoodsReceipt WHERE id = ?`, id)
  receipt.lines = sql.all(`SELECT ${RECEIPT_LINE_COLUMNS} FROM GoodsReceiptLine WHERE receiptId = ?`, id)
  return receipt
}
