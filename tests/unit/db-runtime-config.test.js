// @req FR-030, FR-076, FR-078 — production database selection is server-only
// and must not contain a source-level credential fallback.
// @spec ADR-018, docs/DB-MIGRATION-NOTES.md
// @tested tests/unit/db-runtime-config.test.js

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { requireProductionDatabaseUrl, resolvePostgresUrl } from '@/lib/db'

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/lib/db.js')

describe('production database runtime configuration', () => {
  it('accepts only server-provided Postgres environment values', () => {
    const configured = 'postgresql://runtime:placeholder@db.example.test:5432/zuri'

    expect(resolvePostgresUrl({ POSTGRES_PRISMA_URL: configured })).toBe(configured)
    expect(resolvePostgresUrl({ DATABASE_URL: 'file:./dev.db' })).toBeNull()
  })

  it('fails closed when production has no Postgres environment value', () => {
    expect(() => requireProductionDatabaseUrl({ NODE_ENV: 'production' })).toThrow(
      'PRODUCTION_DATABASE_URL_REQUIRED',
    )
  })

  it('allows Next production build analysis without weakening runtime enforcement', () => {
    expect(
      requireProductionDatabaseUrl({
        NODE_ENV: 'production',
        NEXT_PHASE: 'phase-production-build',
      }),
    ).toBeNull()
  })

  it('does not contain a credential-bearing URL or named default fallback', () => {
    const source = fs.readFileSync(sourcePath, 'utf8')

    expect(source).not.toMatch(/postgres(?:ql)?:\/\/[^\s'"`]+@/i)
    expect(source).not.toContain('SUPABASE_DEFAULT_POSTGRES_URL')
  })
})
