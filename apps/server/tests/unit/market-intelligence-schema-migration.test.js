import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// @req FR-092 — the first Market-owned persisted model is available in both
// canonical SQLite/Postgres schema artifacts and the production migration lane.
// @spec NFR-018, BR-019, SDD-049, SEC-017, ADR-038
// @tested tests/unit/market-intelligence-schema-migration.test.js

const sqliteSchema = readFileSync('prisma/schema.prisma', 'utf8')
const postgresSchema = readFileSync('prisma/schema.postgres.prisma', 'utf8')
const initSql = readFileSync('prisma/postgres/0001_init.sql', 'utf8')
const migration = readFileSync(
  'supabase/migrations/20260820080000_market_observation.sql',
  'utf8',
)

function modelBody(schema) {
  const match = schema.match(/model\s+MarketObservation\s*\{([\s\S]*?)\n\}/)
  expect(match, 'MarketObservation model').not.toBeNull()
  return match?.[1] ?? ''
}

describe('FR-092 MarketObservation schema and migration parity', () => {
  it('keeps the provider-neutral model shape identical across SQLite and Postgres schemas', () => {
    expect(modelBody(postgresSchema)).toBe(modelBody(sqliteSchema))
    for (const field of [
      'id', 'tenantId', 'businessId', 'rawRecordId', 'connectionId', 'provider',
      'sourceEntityType', 'externalId', 'sourcePayloadHash', 'sourceUri',
      'translationSchemaVersion', 'observationType', 'candidateJson',
      'canonicalProductRef', 'canonicalCategoryRef', 'resolutionStatus',
      'resolutionConfidence', 'observedAt', 'translatedAt', 'createdAt', 'lineageKey',
    ]) expect(modelBody(sqliteSchema)).toMatch(new RegExp(`^\\s*${field}\\s+`, 'm'))
    expect(modelBody(sqliteSchema)).toMatch(/lineageKey\s+String\s+@unique/)
    expect(modelBody(sqliteSchema)).toMatch(/@@index\(\[tenantId, businessId, observedAt\]\)/)
    expect(modelBody(sqliteSchema)).toMatch(/@@index\(\[tenantId, connectionId, provider\]\)/)
    expect(modelBody(sqliteSchema)).toMatch(/@@index\(\[rawRecordId\]\)/)
    expect(modelBody(sqliteSchema)).toMatch(/@@index\(\[canonicalProductRef\]\)/)
  })

  it('records the additive production table and its generated rebuild artifacts', () => {
    expect(migration).toMatch(/CREATE TABLE(?: IF NOT EXISTS)? "MarketObservation"/)
    expect(migration).toMatch(/CREATE UNIQUE INDEX(?: IF NOT EXISTS)? "MarketObservation_lineageKey_key"/)
    expect(migration).toContain('ALTER TABLE "MarketObservation" ENABLE ROW LEVEL SECURITY')
    expect(migration).not.toMatch(/\b(?:DROP|ALTER)\s+TABLE\s+"(?:RawExternalRecord|IntegrationConnection)"/i)
    expect(initSql).toContain('CREATE TABLE "MarketObservation"')
    expect(initSql).toContain('CREATE UNIQUE INDEX "MarketObservation_lineageKey_key"')
    expect(initSql).toContain('CREATE INDEX "MarketObservation_tenantId_businessId_observedAt_idx"')
    expect(initSql).toContain('CREATE INDEX "MarketObservation_tenantId_connectionId_provider_idx"')
    expect(initSql).toContain('CREATE INDEX "MarketObservation_rawRecordId_idx"')
    expect(initSql).toContain('CREATE INDEX "MarketObservation_canonicalProductRef_idx"')
  })
})
