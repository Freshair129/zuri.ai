// The MarketObservation table as the Market service sees it: one column list shared
// by both store adapters, and the Postgres DDL used ONLY to build disposable test
// and rehearsal databases. Production's table is created by
// apps/server/supabase/migrations/20260820080000_market_observation.sql; the service
// never creates or alters it there (ADR-108 D3). test/ddl-parity.test.js keeps this
// file column-for-column identical to that migration and to the generated
// schema.postgres.prisma model.
// @req FR-092, NFR-018
// @spec SDD-049, ADR-038, ADR-108
// @tested services/market-intelligence/test/ddl-parity.test.js

export const OBSERVATION_COLUMNS = Object.freeze([
  'id', 'tenantId', 'businessId', 'rawRecordId', 'connectionId', 'provider',
  'sourceEntityType', 'externalId', 'sourcePayloadHash', 'sourceUri',
  'translationSchemaVersion', 'observationType', 'candidateJson',
  'canonicalProductRef', 'canonicalCategoryRef', 'resolutionStatus',
  'resolutionConfidence', 'observedAt', 'translatedAt', 'createdAt', 'lineageKey',
])

export const DATE_COLUMNS = Object.freeze(['observedAt', 'translatedAt', 'createdAt'])

export const POSTGRES_COLUMN_TYPES = Object.freeze({
  id: 'TEXT NOT NULL',
  tenantId: 'TEXT NOT NULL',
  businessId: 'TEXT',
  rawRecordId: 'TEXT NOT NULL',
  connectionId: 'TEXT NOT NULL',
  provider: 'TEXT NOT NULL',
  sourceEntityType: 'TEXT NOT NULL',
  externalId: 'TEXT NOT NULL',
  sourcePayloadHash: 'TEXT NOT NULL',
  sourceUri: 'TEXT',
  translationSchemaVersion: 'TEXT NOT NULL',
  observationType: 'TEXT NOT NULL',
  candidateJson: 'TEXT NOT NULL',
  canonicalProductRef: 'TEXT',
  canonicalCategoryRef: 'TEXT',
  resolutionStatus: 'TEXT NOT NULL',
  resolutionConfidence: 'DOUBLE PRECISION',
  observedAt: 'TIMESTAMP(3) NOT NULL',
  translatedAt: 'TIMESTAMP(3) NOT NULL',
  createdAt: 'TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP',
  lineageKey: 'TEXT NOT NULL',
})

export const POSTGRES_TEST_DDL = [
  `CREATE TABLE IF NOT EXISTS "MarketObservation" (\n${OBSERVATION_COLUMNS
    .map((column) => `    "${column}" ${POSTGRES_COLUMN_TYPES[column]}`)
    .join(',\n')},\n    CONSTRAINT "MarketObservation_pkey" PRIMARY KEY ("id")\n)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "MarketObservation_lineageKey_key" ON "MarketObservation"("lineageKey")',
  'CREATE INDEX IF NOT EXISTS "MarketObservation_tenantId_businessId_observedAt_idx" ON "MarketObservation"("tenantId", "businessId", "observedAt")',
  'CREATE INDEX IF NOT EXISTS "MarketObservation_rawRecordId_idx" ON "MarketObservation"("rawRecordId")',
]

export const SQLITE_DDL = [
  `CREATE TABLE IF NOT EXISTS "MarketObservation" (\n${OBSERVATION_COLUMNS
    .map((column) => {
      if (column === 'id') return '    "id" TEXT NOT NULL PRIMARY KEY'
      if (column === 'resolutionConfidence') return '    "resolutionConfidence" REAL'
      const nullable = POSTGRES_COLUMN_TYPES[column].includes('NOT NULL') ? ' NOT NULL' : ''
      return `    "${column}" TEXT${nullable}`
    })
    .join(',\n')}\n)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "MarketObservation_lineageKey_key" ON "MarketObservation"("lineageKey")',
  'CREATE INDEX IF NOT EXISTS "MarketObservation_tenantId_businessId_observedAt_idx" ON "MarketObservation"("tenantId", "businessId", "observedAt")',
]

export const OBSERVATION_PAGE_LIMIT = 200

export function assertStoreScope(scope) {
  if (!scope?.tenantId) throw new Error('MarketObservation store tenantId is required')
  if (scope.businessId === undefined) {
    throw new Error('MarketObservation store businessId must be explicit (string or null)')
  }
  return { tenantId: scope.tenantId, businessId: scope.businessId ?? null }
}

export function assertDraftInScope(draft, scope) {
  if (!draft || typeof draft !== 'object') throw new Error('MarketObservation draft is required')
  if (draft.tenantId !== scope.tenantId) throw new Error('MarketObservation tenant scope mismatch')
  if ((draft.businessId ?? null) !== scope.businessId) throw new Error('MarketObservation business scope mismatch')
  if (!draft.lineageKey) throw new Error('MarketObservation lineageKey is required')
}

/**
 * A lineage key is globally unique while scope is not. A key that resolves to a row
 * in another scope is an identity collision, never a replay: it is a server fault.
 */
export class LineageScopeCollision extends Error {
  constructor() {
    super('MarketObservation lineage identity resolved outside store scope')
    this.name = 'LineageScopeCollision'
  }
}

export function assertRowInStoreScope(row, scope) {
  if (!row || row.tenantId !== scope.tenantId || (row.businessId ?? null) !== scope.businessId) {
    throw new LineageScopeCollision()
  }
}

export function normalizeLimit(limit) {
  const value = Number(limit)
  if (!Number.isInteger(value) || value < 1) throw new Error('listRecent limit must be a positive integer')
  return Math.min(value, OBSERVATION_PAGE_LIMIT)
}
