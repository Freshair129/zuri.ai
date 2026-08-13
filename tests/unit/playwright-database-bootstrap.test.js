import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// @req FR-046 — browser entry tests own an isolated, seeded SQLite authority.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/playwright-database-bootstrap.test.js, tests/e2e/fr046-entry-contract.spec.js

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('Playwright database bootstrap', () => {
  it('binds global setup and the web server to the same isolated E2E database', () => {
    const config = read('playwright.config.js')
    expect(config).toContain("globalSetup: './tests/e2e/global-setup.js'")
    expect(config).toContain("DATABASE_URL: 'file:./e2e.db'")
    expect(config).toContain('reuseExistingServer: false')
  })

  it('deletes only prisma/e2e.db before schema push and idempotent seed', () => {
    const setup = read('tests/e2e/global-setup.js')
    expect(setup).toContain("'prisma', 'e2e.db'")
    expect(setup).toContain("E2E_DATABASE_URL = 'file:./e2e.db'")
    expect(setup).toContain('DATABASE_URL: E2E_DATABASE_URL')
    expect(setup).toContain('npx prisma db push --skip-generate')
    expect(setup).toContain('node prisma/seed.js')
    expect(setup).not.toMatch(/dev\.db|test\.db/)
  })
})
