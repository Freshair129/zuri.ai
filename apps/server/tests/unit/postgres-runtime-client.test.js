import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// @req FR-030, FR-076, FR-078 — production application queries use the
// generated Postgres client while SQLite remains the local/test provider.
// @spec ADR-018, docs/DB-MIGRATION-NOTES.md.

const read = (file) => readFileSync(resolve(process.cwd(), file), 'utf8')
const generator = read('scripts/gen-postgres-schema.mjs')
const db = read('src/lib/db.js')
const packageJson = read('package.json')

describe('provider-specific Prisma runtime', () => {
  it('generates a separate Postgres client without replacing the SQLite client', () => {
    expect(generator).toContain('generator postgresClient')
    expect(generator).toContain('../node_modules/@zuri/prisma-postgres')
    expect(packageJson).toContain('scripts/generate-prisma-clients.mjs')
  })

  it('selects the Postgres client only for a Postgres DATABASE_URL', () => {
    expect(db).toMatch(/PrismaClient as PostgresPrismaClient/)
    expect(db).toMatch(/\^\(postgres\|postgresql\):/)
    expect(db).toMatch(/usePostgres \? PostgresPrismaClient : PrismaClient/)
  })
})
