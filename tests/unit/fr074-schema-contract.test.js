import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// @req FR-074 — connection metadata and the database active-primary invariant.
// @spec ADR-031 §D2, SDD-043, SEC-015
// @tested tests/unit/fr074-schema-contract.test.js

describe('FR-074 schema contract', () => {
  it('declares provider, connection and opaque credential metadata in both schema paths', () => {
    const sqlite = readFileSync('prisma/schema.prisma', 'utf8')
    const postgres = readFileSync('prisma/schema.postgres.prisma', 'utf8')
    for (const schema of [sqlite, postgres]) {
      expect(schema).toContain('model IntegrationProvider')
      expect(schema).toContain('model IntegrationConnection')
      expect(schema).toContain('model IntegrationCredential')
      expect(schema).toContain('purpose')
      expect(schema).toContain('role')
      expect(schema).toContain('secretRef')
    }
  })

  it('keeps the active-primary uniqueness invariant in an additive Postgres migration', () => {
    const migration = readFileSync('prisma/postgres/0002_phase1_line_primary_connection.sql', 'utf8')
    expect(migration).toContain('CREATE UNIQUE INDEX')
    expect(migration).toContain("'PHASE1_LINE_LLM'")
    expect(migration).toContain("'ACTIVE'")
    expect(migration).toContain("'PRIMARY'")
    expect(migration).toContain('businessId')
  })
})
