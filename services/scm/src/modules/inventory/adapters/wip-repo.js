import { randomUUID } from 'node:crypto'

// Inventory's recipe / work-order adapter: the only SQL over ProductRecipe(+Line),
// CustomizationWorkOrder, KittingWorkOrder and StockReservation, and the
// lot-intake correction a transfer makes. Every function takes the unit-of-work handle.

const RECIPE_COLUMNS = 'id, code, tenantId, businessId, productId, name, batchSize, yieldQty, unit, notes, scrapAllowanceFactor, status, archivedAt, createdAt, updatedAt, version'
const LINE_COLUMNS = 'id, componentProductId, qty, unit, fixed, note'
export const CWO_COLUMNS = 'id, code, tenantId, businessId, salesOrderId, customerId, rawProductId, outputProductId, technique, logoArtworkUrl, pantoneColorsJson, plannedQty, issuedQty, completedQty, scrapQty, scrapAllowanceFactor, setupCostSatang, runCostSatang, status, wipLocationId, scrapLocationId, sourceLocationId, scheduledDate, startedAt, completedAt, cancelledAt, notes, createdByPersonId, createdAt, updatedAt, version'
export const KWO_COLUMNS = 'id, code, tenantId, businessId, salesOrderId, customerId, recipeId, finishedProductId, plannedQty, assembledQty, scrapQty, laborCostSatang, unitCostSatang, plannedLinesJson, status, sourceLocationId, wipLocationId, targetLocationId, scrapLocationId, outputLotCode, startedAt, completedAt, cancelledAt, notes, createdByPersonId, createdAt, updatedAt, version'
const TABLE = { customization: 'CustomizationWorkOrder', kitting: 'KittingWorkOrder' }
const COLUMNS = { customization: CWO_COLUMNS, kitting: KWO_COLUMNS }

const line = (row) => ({ id: row.id, componentProductId: row.componentProductId, qty: Number(row.qty), unit: row.unit, fixed: Boolean(row.fixed), note: row.note })
const withLines = (sql, row) => (row ? { ...row, scrapAllowanceFactor: Number(row.scrapAllowanceFactor), lines: sql.all(`SELECT ${LINE_COLUMNS} FROM ProductRecipeLine WHERE recipeId = ? ORDER BY id`, row.id).map(line) } : null)

// ── Recipes (FR-156) ─────────────────────────────────────────────────────────
export const recipeById = (sql, id) => withLines(sql, sql.get(`SELECT ${RECIPE_COLUMNS} FROM ProductRecipe WHERE id = ?`, id))
export const recipeCodeTaken = (sql, tenantId, code) => Boolean(sql.get('SELECT id FROM ProductRecipe WHERE tenantId = ? AND code = ?', tenantId, code))
export const recipeBatchTaken = (sql, productId, batchSize) => Boolean(sql.get('SELECT id FROM ProductRecipe WHERE productId = ? AND batchSize = ?', productId, batchSize))
export function recipesOf(sql, businessId, { productId, includeArchived = false } = {}) {
  const rows = sql.all(
    `SELECT ${RECIPE_COLUMNS} FROM ProductRecipe WHERE businessId = ? ${productId ? 'AND productId = ?' : ''} ${includeArchived ? '' : "AND status <> 'ARCHIVED'"} ORDER BY productId, batchSize`,
    ...[businessId, ...(productId ? [productId] : [])],
  )
  return rows.map((row) => withLines(sql, row))
}
function insertLines(sql, recipeId, lines) {
  for (const l of lines) sql.run('INSERT INTO ProductRecipeLine (id, recipeId, componentProductId, qty, unit, fixed, note) VALUES (?,?,?,?,?,?,?)', randomUUID(), recipeId, l.componentProductId, l.qty, l.unit ?? null, l.fixed ? 1 : 0, l.note ?? null)
}
export function insertRecipe(sql, r) {
  const id = randomUUID()
  sql.run(
    `INSERT INTO ProductRecipe (${RECIPE_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',NULL,?,?,1)`,
    id, r.code, r.tenantId, r.businessId, r.productId, r.name, r.batchSize, r.yieldQty, r.unit, r.notes ?? null, r.scrapAllowanceFactor, r.now, r.now,
  )
  insertLines(sql, id, r.lines)
  return recipeById(sql, id)
}
/** Legacy compare-and-swap: bump the version only when it is still the one read (0 or 1 rows). */
export const casRecipeVersion = (sql, id, version, now) => Number(sql.run('UPDATE ProductRecipe SET version = version + 1, updatedAt = ? WHERE id = ? AND version = ?', now, id, version).changes)
const RECIPE_CHANGE = new Set(['name', 'yieldQty', 'unit', 'notes', 'scrapAllowanceFactor', 'status', 'archivedAt'])
export function updateRecipe(sql, id, change, lines, now) {
  const keys = Object.keys(change)
  for (const k of keys) if (!RECIPE_CHANGE.has(k)) throw new Error(`recipe column ${k} is not updatable`)
  if (keys.length) sql.run(`UPDATE ProductRecipe SET ${keys.map((k) => `${k} = ?`).join(', ')}, updatedAt = ? WHERE id = ?`, ...keys.map((k) => change[k]), now, id)
  if (lines) {
    sql.run('DELETE FROM ProductRecipeLine WHERE recipeId = ?', id)
    insertLines(sql, id, lines)
  }
}

// ── Work orders (FR-176, FR-177) ─────────────────────────────────────────────
export const workOrderById = (sql, kind, id) => {
  const row = sql.get(`SELECT ${COLUMNS[kind]} FROM ${TABLE[kind]} WHERE id = ?`, id)
  return row ? { ...row, ...(kind === 'customization' ? { scrapAllowanceFactor: Number(row.scrapAllowanceFactor) } : {}) } : null
}
export const workOrderCodeCount = (sql, kind, tenantId, prefix) => Number(sql.get(`SELECT COUNT(*) AS n FROM ${TABLE[kind]} WHERE tenantId = ? AND code LIKE ?`, tenantId, `${prefix}%`).n)
export const workOrderCodeTaken = (sql, kind, tenantId, code) => Boolean(sql.get(`SELECT id FROM ${TABLE[kind]} WHERE tenantId = ? AND code = ?`, tenantId, code))
export function insertWorkOrder(sql, kind, values) {
  const id = randomUUID()
  const row = { id, ...values, version: 1 }
  const keys = Object.keys(row)
  sql.run(`INSERT INTO ${TABLE[kind]} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => row[k]))
  return workOrderById(sql, kind, id)
}
const WO_CHANGE = {
  customization: new Set(['status', 'issuedQty', 'completedQty', 'scrapQty', 'startedAt', 'completedAt', 'cancelledAt']),
  kitting: new Set(['status', 'assembledQty', 'scrapQty', 'unitCostSatang', 'startedAt', 'completedAt', 'cancelledAt']),
}
/** Apply `change` and bump the version only when it is still `version` (0 or 1 rows). */
export function casWorkOrder(sql, kind, { id, version, change, now }) {
  const keys = Object.keys(change)
  for (const k of keys) if (!WO_CHANGE[kind].has(k)) throw new Error(`${kind} work order column ${k} is not updatable`)
  return Number(sql.run(`UPDATE ${TABLE[kind]} SET ${keys.map((k) => `${k} = ?`).join(', ')}${keys.length ? ', ' : ''}version = version + 1, updatedAt = ? WHERE id = ? AND version = ?`, ...keys.map((k) => change[k]), now, id, version).changes)
}
export function workOrdersOf(sql, kind, businessId, { status, salesOrderId } = {}) {
  return sql.all(
    `SELECT ${COLUMNS[kind]} FROM ${TABLE[kind]} WHERE businessId = ? ${status ? 'AND status = ?' : ''} ${salesOrderId ? 'AND salesOrderId = ?' : ''} ORDER BY createdAt DESC, id DESC`,
    ...[businessId, ...(status ? [status] : []), ...(salesOrderId ? [salesOrderId] : [])],
  ).map((row) => (kind === 'customization' ? { ...row, scrapAllowanceFactor: Number(row.scrapAllowanceFactor) } : { ...row }))
}

// ── Reads the work orders need from Inventory-owned tables ──────────────────
/** RECEIPT rows of one SKU (quantity, costSatang) — the weighted-average landed cost input. */
export const receiptsOf = (sql, productId) => sql.all("SELECT quantity, costSatang FROM StockMovement WHERE productId = ? AND kind = 'RECEIPT'", productId)
/** ACTIVE reservation rows of the given SKUs (liveness is decided against the clock by the kernel). */
export function activeReservationsOf(sql, businessId, productIds) {
  if (!productIds.length) return []
  return sql.all(
    `SELECT productId, purpose, quantity, status, expiresAt FROM StockReservation WHERE businessId = ? AND status = 'ACTIVE' AND productId IN (${productIds.map(() => '?').join(',')})`,
    businessId, ...productIds,
  )
}
// ── Reservations (FR-180): the only SQL writing StockReservation ────────────
export const RESERVATION_COLUMNS = 'id, code, tenantId, businessId, productId, purpose, quantity, status, customerId, salesOrderId, quoteReference, customerCompany, contactHandle, notes, reservedAt, expiresAt, releasedAt, convertedAt, createdByPersonId, createdAt, updatedAt, version'
export const reservationById = (sql, id) => {
  const row = sql.get(`SELECT ${RESERVATION_COLUMNS} FROM StockReservation WHERE id = ?`, id)
  return row ? { ...row } : null
}
export const reservationCodeCount = (sql, tenantId, prefix) => Number(sql.get('SELECT COUNT(*) AS n FROM StockReservation WHERE tenantId = ? AND code LIKE ?', tenantId, `${prefix}%`).n)
export const reservationCodeTaken = (sql, tenantId, code) => Boolean(sql.get('SELECT id FROM StockReservation WHERE tenantId = ? AND code = ?', tenantId, code))
export function insertReservation(sql, values) {
  const id = randomUUID()
  const row = { id, ...values, status: 'ACTIVE', version: 1 }
  const keys = Object.keys(row)
  sql.run(`INSERT INTO StockReservation (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => row[k]))
  return reservationById(sql, id)
}
const RESERVATION_CHANGE = new Set(['status', 'releasedAt', 'convertedAt'])
/** Compare-and-swap on (id, version) and still ACTIVE: 1 when this writer won. */
export function casReservation(sql, { id, version, change, now }) {
  const keys = Object.keys(change)
  for (const k of keys) if (!RESERVATION_CHANGE.has(k)) throw new Error(`reservation column ${k} is not updatable`)
  return Number(sql.run(`UPDATE StockReservation SET ${keys.map((k) => `${k} = ?`).join(', ')}, version = version + 1, updatedAt = ? WHERE id = ? AND version = ? AND status = 'ACTIVE'`, ...keys.map((k) => change[k]), now, id, version).changes)
}
export function reservationsOf(sql, businessId, { productId, status } = {}) {
  return sql.all(
    `SELECT ${RESERVATION_COLUMNS} FROM StockReservation WHERE businessId = ? ${productId ? 'AND productId = ?' : ''} ${status ? 'AND status = ?' : ''} ORDER BY reservedAt DESC, id DESC`,
    ...[businessId, ...(productId ? [productId] : []), ...(status ? [status] : [])],
  ).map((row) => ({ ...row }))
}
/** ACTIVE quote/order holds whose clock has run out (a committed hold with no expiry never qualifies). */
export const dueReservations = (sql, businessId, now) => sql.all("SELECT id, code, quantity, productId, version FROM StockReservation WHERE businessId = ? AND status = 'ACTIVE' AND expiresAt IS NOT NULL AND expiresAt <= ? ORDER BY expiresAt, id", businessId, now)
/** Stamp EXPIRED only while the row is still ACTIVE (two sweeps never both stamp it). */
export const expireReservation = (sql, id, now) => Number(sql.run("UPDATE StockReservation SET status = 'EXPIRED', version = version + 1, updatedAt = ? WHERE id = ? AND status = 'ACTIVE'", now, id).changes)

/** ACTIVE reservation rows of one SKU, clock ignored — the legacy ARCHIVE / MERGE guard count. */
export const activeReservationCount = (sql, productId) => Number(sql.get("SELECT COUNT(*) AS n FROM StockReservation WHERE productId = ? AND status = 'ACTIVE'", productId).n)

// ── FR-205 MERGE: what points at a duplicate SKU ────────────────────────────
export const recipeLinesNaming = (sql, productId) => sql.all('SELECT l.id, l.recipeId, r.code AS recipeCode, r.productId AS recipeProductId FROM ProductRecipeLine l JOIN ProductRecipe r ON r.id = l.recipeId WHERE l.componentProductId = ? ORDER BY l.id', productId)
export const recipeNames = (sql, recipeId, productId) => Boolean(sql.get('SELECT id FROM ProductRecipeLine WHERE recipeId = ? AND componentProductId = ?', recipeId, productId))
export const recipesProducing = (sql, productId) => sql.all('SELECT id, code, batchSize, status FROM ProductRecipe WHERE productId = ? ORDER BY id', productId)
/** The survivor's recipe at this batch size, ANY status — UNIQUE (productId, batchSize) covers archived rows too. */
export const recipeAtBatch = (sql, productId, batchSize) => sql.get('SELECT id, status FROM ProductRecipe WHERE productId = ? AND batchSize = ?', productId, batchSize) ?? null
const OPEN = "status NOT IN ('COMPLETED', 'CANCELLED')"
export const openCustomizationOrdersOf = (sql, productId) => Number(sql.get(`SELECT COUNT(*) AS n FROM CustomizationWorkOrder WHERE ${OPEN} AND (rawProductId = ? OR outputProductId = ?)`, productId, productId).n)
export const openKittingOrdersOf = (sql, productId) => Number(sql.get(`SELECT COUNT(*) AS n FROM KittingWorkOrder WHERE ${OPEN} AND finishedProductId = ?`, productId).n)
export const repointRecipeLines = (sql, fromId, toId) => Number(sql.run('UPDATE ProductRecipeLine SET componentProductId = ? WHERE componentProductId = ?', toId, fromId).changes)
export const repointRecipes = (sql, fromId, toId, now) => Number(sql.run('UPDATE ProductRecipe SET productId = ?, updatedAt = ? WHERE productId = ?', toId, now, fromId).changes)

/** A transfer's receipt is not an arrival from outside: undo the receipt half's lot-intake increment. */
export const undoLotReceivedQty = (sql, lotId, qty, now) => sql.run('UPDATE ProductLot SET receivedQty = receivedQty - ?, updatedAt = ? WHERE id = ?', qty, now, lotId)
/** Insert a SKU with explicit columns (the branded output of a customization run). */
export function insertProduct(sql, values) {
  const id = randomUUID()
  const row = { id, ...values, version: 1 }
  const keys = Object.keys(row)
  sql.run(`INSERT INTO Product (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => row[k]))
  return id
}
