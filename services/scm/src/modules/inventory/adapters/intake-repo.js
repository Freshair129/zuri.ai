import { randomUUID } from 'node:crypto'

// Inventory's catalogue-intake adapter: the only SQL over InventoryCatalogIntake.
// Every function takes the unit-of-work handle.

export const INTAKE_COLUMNS = 'id, code, tenantId, businessId, sourceChannel, sourceCorrelationId, payloadSha256, planJson, planHash, committable, itemCount, status, requestedById, resultJson, expiresAt, committedAt, cancelledAt, createdAt, updatedAt, version'
const SUMMARY_COLUMNS = INTAKE_COLUMNS.split(', ').filter((c) => c !== 'planJson' && c !== 'resultJson').join(', ')
const plain = (row) => (row ? { ...row, committable: Boolean(row.committable), itemCount: Number(row.itemCount), version: Number(row.version) } : null)

export const intakeById = (sql, id) => plain(sql.get(`SELECT ${INTAKE_COLUMNS} FROM InventoryCatalogIntake WHERE id = ?`, id))
export const intakeWithEnvelope = (sql, id) => plain(sql.get(`SELECT ${INTAKE_COLUMNS}, normalizedEnvelopeJson FROM InventoryCatalogIntake WHERE id = ?`, id))
export const intakeByCorrelation = (sql, businessId, channel, correlationId) => plain(sql.get(`SELECT ${INTAKE_COLUMNS} FROM InventoryCatalogIntake WHERE businessId = ? AND sourceChannel = ? AND sourceCorrelationId = ?`, businessId, channel, correlationId))
export const intakeByCode = (sql, tenantId, code) => plain(sql.get(`SELECT ${INTAKE_COLUMNS} FROM InventoryCatalogIntake WHERE tenantId = ? AND code = ?`, tenantId, code))
export const intakesOf = (sql, businessId, limit) => sql.all(`SELECT ${SUMMARY_COLUMNS} FROM InventoryCatalogIntake WHERE businessId = ? ORDER BY createdAt DESC, id DESC LIMIT ?`, businessId, limit).map(plain)

export function insertIntake(sql, row) {
  const id = randomUUID()
  sql.run(
    `INSERT INTO InventoryCatalogIntake (id, code, tenantId, businessId, sourceChannel, sourceCorrelationId, payloadSha256, normalizedEnvelopeJson, planJson, planHash, committable, itemCount, status, requestedById, expiresAt, createdAt, updatedAt, version)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'PREVIEWED',?,?,?,?,1)`,
    id, row.code, row.tenantId, row.businessId, row.sourceChannel, row.sourceCorrelationId, row.payloadSha256, row.normalizedEnvelopeJson,
    row.planJson, row.planHash, row.committable ? 1 : 0, row.itemCount, row.requestedById, row.expiresAt, row.now, row.now,
  )
  return intakeById(sql, id)
}

/** A same-payload re-preview replaces the plan (version + 1). */
export function replacePlan(sql, { id, planJson, planHash, committable, itemCount, expiresAt, requestedById, now }) {
  sql.run(
    'UPDATE InventoryCatalogIntake SET planJson = ?, planHash = ?, committable = ?, itemCount = ?, expiresAt = ?, requestedById = ?, version = version + 1, updatedAt = ? WHERE id = ?',
    planJson, planHash, committable ? 1 : 0, itemCount, expiresAt, requestedById, now, id,
  )
  return intakeById(sql, id)
}

/**
 * Lock-only touch: a row lock on the intake, taken before its status is read, so
 * two commits (or a commit and a cancel) of one intake serialize (D-27).
 */
export const lockIntake = (sql, id) => Number(sql.run('UPDATE InventoryCatalogIntake SET version = version WHERE id = ?', id).changes)

/** PREVIEWED → COMMITTED only while still PREVIEWED at this version (0 or 1 rows). */
export const commitIntake = (sql, { id, version, resultJson, now }) => Number(sql.run(
  "UPDATE InventoryCatalogIntake SET status = 'COMMITTED', committedAt = ?, resultJson = ?, version = version + 1, updatedAt = ? WHERE id = ? AND version = ? AND status = 'PREVIEWED'",
  now, resultJson, now, id, version,
).changes)

/** PREVIEWED → CANCELLED only at this version (0 or 1 rows). */
export const cancelIntake = (sql, { id, version, now }) => Number(sql.run(
  "UPDATE InventoryCatalogIntake SET status = 'CANCELLED', cancelledAt = ?, version = version + 1, updatedAt = ? WHERE id = ? AND version = ?",
  now, now, id, version,
).changes)
