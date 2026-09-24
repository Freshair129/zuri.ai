import { randomUUID } from 'node:crypto'

// Commerce's SQL adapter — the ONLY code that writes SalesOrder, SalesOrderLine,
// Payment and BusinessBillingProfile. Reads of Product/locations go through
// Inventory's public API; Customer/Branch/FileAsset through ReferenceAuthority.

const ORDER_COLUMNS = 'id, code, tenantId, businessId, customerId, conversationId, origin, status, currency, discountSatang, notes, orderedAt, confirmedAt, completedAt, cancelledAt, cancelReason, stockIssuedAt, closedByPersonId, createdByPersonId, createdAt, updatedAt, version'
const LINE_COLUMNS = 'id, productId, description, qty, unitPriceSatang, discountSatang, sortOrder'
export const PAYMENT_COLUMNS = 'id, code, kind, method, amountSatang, status, bankReference, slipFileAssetId, note, paidAt, verifiedAt, verifiedByPersonId, rejectReason, createdAt, version'
const table = (kind) => (kind === 'Payment' ? 'Payment' : 'SalesOrder')

export const countCodesWithPrefix = (sql, kind, tenantId, prefix) => sql.get(`SELECT COUNT(*) AS n FROM ${table(kind)} WHERE tenantId = ? AND code LIKE ?`, tenantId, `${prefix}%`).n
export const codeTaken = (sql, kind, tenantId, code) => Boolean(sql.get(`SELECT id FROM ${table(kind)} WHERE tenantId = ? AND code = ?`, tenantId, code))
export const paymentByBankReference = (sql, tenantId, bankReference) => sql.get('SELECT id FROM Payment WHERE tenantId = ? AND bankReference = ?', tenantId, bankReference) ?? null

export function insertOrder(sql, order, lines) {
  const id = randomUUID()
  sql.run(
    `INSERT INTO SalesOrder (${ORDER_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,?,?,?,?,1)`,
    id, order.code, order.tenantId, order.businessId, order.customerId ?? null, order.conversationId ?? null, order.origin, order.status, order.currency,
    order.discountSatang, order.notes ?? null, order.orderedAt, order.confirmedAt ?? null, order.completedAt ?? null,
    order.closedByPersonId ?? null, order.createdByPersonId ?? null, order.now, order.now,
  )
  for (const line of lines) {
    sql.run(`INSERT INTO SalesOrderLine (orderId, ${LINE_COLUMNS}) VALUES (?,?,?,?,?,?,?,?)`, id, randomUUID(), line.productId ?? null, line.description, line.qty, line.unitPriceSatang, line.discountSatang, line.sortOrder)
  }
  return id
}

export const markStockIssued = (sql, orderId, now) => sql.run('UPDATE SalesOrder SET stockIssuedAt = ?, updatedAt = ? WHERE id = ?', now, now, orderId)

export function insertPayment(sql, p) {
  const id = randomUUID()
  sql.run(
    `INSERT INTO Payment (id, code, tenantId, businessId, orderId, kind, method, amountSatang, status, bankReference, slipFileAssetId, note, paidAt, createdByPersonId, createdAt, updatedAt, version)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
    id, p.code, p.tenantId, p.businessId, p.orderId, p.kind, p.method, p.amountSatang, p.status, p.bankReference ?? null, p.slipFileAssetId ?? null, p.note ?? null, p.paidAt, p.createdByPersonId ?? null, p.now, p.now,
  )
  return sql.get(`SELECT ${PAYMENT_COLUMNS}, orderId, createdByPersonId FROM Payment WHERE id = ?`, id)
}

/** The legacy ORDER_SELECT shape minus the Customer join (CRM-owned; see D-5). */
export function loadOrder(sql, id) {
  const order = sql.get(`SELECT ${ORDER_COLUMNS} FROM SalesOrder WHERE id = ?`, id)
  if (!order) return null
  order.lines = sql.all(`SELECT ${LINE_COLUMNS} FROM SalesOrderLine WHERE orderId = ? ORDER BY sortOrder`, id)
  order.payments = sql.all(`SELECT ${PAYMENT_COLUMNS} FROM Payment WHERE orderId = ? ORDER BY paidAt`, id)
  return order
}

/** PromptPay configuration; SQLite booleans are 0/1, the kernel expects true/false. */
export function billingProfileOf(sql, businessId) {
  const row = sql.get('SELECT promptPayProvider, promptPayTargetType, promptPayTarget, promptPayActive, promptPayVerifiedAt, active FROM BusinessBillingProfile WHERE businessId = ?', businessId)
  return row ? { ...row, promptPayActive: row.promptPayActive === 1, active: row.active === 1 } : null
}
