import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import {
  DATE_COLUMNS,
  OBSERVATION_COLUMNS,
  SQLITE_DDL,
  assertDraftInScope,
  assertRowInStoreScope,
  assertStoreScope,
  normalizeLimit,
} from './observation-schema.js'

// node:sqlite ObservationStore — local development and tests ONLY (ADR-108 D2). It is
// never a production option. It passes the same conformance suite as the Postgres
// adapter, including the lineage race run from separate connections in separate
// worker threads, so a behaviour the tests rely on cannot exist here only.
// @req FR-092, NFR-018
// @spec SDD-049, SEC-017, ADR-108
// @tested services/market-intelligence/test/sqlite-store.test.js

function toRow(record) {
  if (!record) return null
  const row = { ...record }
  for (const column of DATE_COLUMNS) row[column] = new Date(row[column])
  return row
}

function toParams(draft, id, createdAt) {
  const values = { ...draft, id, createdAt }
  return OBSERVATION_COLUMNS.map((column) => {
    const value = values[column]
    if (DATE_COLUMNS.includes(column)) return new Date(value).toISOString()
    return value ?? null
  })
}

export function openSqliteObservationDatabase(location, { busyTimeoutMs = 5000 } = {}) {
  const db = new DatabaseSync(location)
  db.exec(`PRAGMA busy_timeout = ${Number(busyTimeoutMs)}`)
  db.exec('PRAGMA journal_mode = WAL')
  for (const statement of SQLITE_DDL) db.exec(statement)
  return db
}

export function createSqliteObservationStoreFactory({ location, busyTimeoutMs } = {}) {
  if (!location) throw new Error('sqlite store location is required')
  const db = openSqliteObservationDatabase(location, { busyTimeoutMs })
  const placeholders = OBSERVATION_COLUMNS.map(() => '?').join(', ')
  const insert = db.prepare(
    `INSERT INTO "MarketObservation" (${OBSERVATION_COLUMNS.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})
     ON CONFLICT("lineageKey") DO NOTHING`,
  )
  const byLineage = db.prepare('SELECT * FROM "MarketObservation" WHERE "lineageKey" = ?')

  function open(rawScope) {
    const scope = assertStoreScope(rawScope)
    const businessClause = scope.businessId === null ? '"businessId" IS NULL' : '"businessId" = ?'
    const scopeParams = scope.businessId === null ? [scope.tenantId] : [scope.tenantId, scope.businessId]

    return Object.freeze({
      async insertIfAbsent(draft) {
        assertDraftInScope(draft, scope)
        const result = insert.run(...toParams(draft, randomUUID(), new Date()))
        const observation = toRow(byLineage.get(draft.lineageKey))
        assertRowInStoreScope(observation, scope)
        return { status: result.changes === 1 ? 'CREATED' : 'UNCHANGED', observation }
      },
      async listRecent({ limit } = {}) {
        const rows = db.prepare(
          `SELECT * FROM "MarketObservation" WHERE "tenantId" = ? AND ${businessClause}
           ORDER BY "observedAt" DESC, "createdAt" DESC LIMIT ?`,
        ).all(...scopeParams, normalizeLimit(limit ?? 200)).map(toRow)
        for (const row of rows) assertRowInStoreScope(row, scope)
        return rows
      },
      async findTranslatedRawRecordIds(rawRecordIds) {
        if (!Array.isArray(rawRecordIds) || rawRecordIds.length === 0) return []
        const marks = rawRecordIds.map(() => '?').join(', ')
        return db.prepare(
          `SELECT "rawRecordId" FROM "MarketObservation" WHERE "tenantId" = ? AND ${businessClause} AND "rawRecordId" IN (${marks})`,
        ).all(...scopeParams, ...rawRecordIds).map((row) => row.rawRecordId)
      },
    })
  }

  return {
    kind: 'sqlite',
    open: async (scope) => open(scope),
    async ping() {
      db.prepare('SELECT 1 AS ok').get()
      return true
    },
    async close() {
      db.close()
    },
  }
}
