import { randomUUID } from 'node:crypto'
import pg from 'pg'

import {
  DATE_COLUMNS,
  OBSERVATION_COLUMNS,
  POSTGRES_TEST_DDL,
  assertDraftInScope,
  assertRowInStoreScope,
  assertStoreScope,
  normalizeLimit,
} from './observation-schema.js'

// Postgres ObservationStore — the only production persistence path (ADR-108 D2/D3).
// It connects as the restricted Market role (SELECT, INSERT on "MarketObservation"
// only) and never runs DDL against production: `ensureTestSchema` exists for
// disposable databases and refuses unless the caller says so explicitly.
//
// Atomicity is the unique "lineageKey" index: INSERT … ON CONFLICT DO NOTHING
// RETURNING is one statement, so N connections racing the same key yield exactly one
// CREATED; the losers read the winner's committed row and report UNCHANGED.
//
// TIMESTAMP(3) has no zone. Prisma writes UTC, so this adapter writes ISO strings
// (Postgres ignores the zone suffix for timestamp-without-time-zone) and parses
// OID 1114 back as UTC. The pg default would read them as host-local time.
// @req FR-092, NFR-018
// @spec SDD-049, SEC-017, ADR-108
// @tested services/market-intelligence/test/pg-store.test.js

const TIMESTAMP_WITHOUT_TZ_OID = 1114
const utcTypes = {
  getTypeParser(oid, format) {
    if (oid === TIMESTAMP_WITHOUT_TZ_OID) return (value) => (value === null ? null : new Date(`${value.replace(' ', 'T')}Z`))
    return pg.types.getTypeParser(oid, format)
  },
}

const quoted = OBSERVATION_COLUMNS.map((column) => `"${column}"`).join(', ')
const values = OBSERVATION_COLUMNS.map((_, index) => `$${index + 1}`).join(', ')
const INSERT_SQL = `INSERT INTO "MarketObservation" (${quoted}) VALUES (${values})
  ON CONFLICT ("lineageKey") DO NOTHING RETURNING *`

function toParams(draft) {
  const row = { ...draft, id: randomUUID(), createdAt: new Date() }
  return OBSERVATION_COLUMNS.map((column) => {
    if (DATE_COLUMNS.includes(column)) return new Date(row[column]).toISOString()
    return row[column] ?? null
  })
}

export function createPgObservationStoreFactory({ connectionString, pool: injectedPool, max = 5 } = {}) {
  if (!injectedPool && !connectionString) throw new Error('Postgres connectionString is required')
  const pool = injectedPool ?? new pg.Pool({ connectionString, max, types: utcTypes })

  function open(rawScope) {
    const scope = assertStoreScope(rawScope)
    const business = scope.businessId === null ? '"businessId" IS NULL' : '"businessId" = $2'
    const scopeParams = scope.businessId === null ? [scope.tenantId] : [scope.tenantId, scope.businessId]
    const next = scopeParams.length + 1

    return Object.freeze({
      async insertIfAbsent(draft) {
        assertDraftInScope(draft, scope)
        const inserted = await pool.query(INSERT_SQL, toParams(draft))
        if (inserted.rows[0]) {
          assertRowInStoreScope(inserted.rows[0], scope)
          return { status: 'CREATED', observation: inserted.rows[0] }
        }
        const existing = await pool.query('SELECT * FROM "MarketObservation" WHERE "lineageKey" = $1', [draft.lineageKey])
        assertRowInStoreScope(existing.rows[0], scope)
        return { status: 'UNCHANGED', observation: existing.rows[0] }
      },
      async listRecent({ limit } = {}) {
        const result = await pool.query(
          `SELECT * FROM "MarketObservation" WHERE "tenantId" = $1 AND ${business}
           ORDER BY "observedAt" DESC, "createdAt" DESC LIMIT $${next}`,
          [...scopeParams, normalizeLimit(limit ?? 200)],
        )
        for (const row of result.rows) assertRowInStoreScope(row, scope)
        return result.rows
      },
      async findTranslatedRawRecordIds(rawRecordIds) {
        if (!Array.isArray(rawRecordIds) || rawRecordIds.length === 0) return []
        const result = await pool.query(
          `SELECT "rawRecordId" FROM "MarketObservation" WHERE "tenantId" = $1 AND ${business} AND "rawRecordId" = ANY($${next}::text[])`,
          [...scopeParams, rawRecordIds],
        )
        return result.rows.map((row) => row.rawRecordId)
      },
    })
  }

  return {
    kind: 'postgres',
    pool,
    open: async (scope) => open(scope),
    async ping() {
      await pool.query('SELECT 1')
      return true
    },
    async ensureTestSchema({ disposable } = {}) {
      if (disposable !== true) throw new Error('ensureTestSchema is for disposable databases only')
      for (const statement of POSTGRES_TEST_DDL) await pool.query(statement)
    },
    async close() {
      if (!injectedPool) await pool.end()
    },
  }
}
