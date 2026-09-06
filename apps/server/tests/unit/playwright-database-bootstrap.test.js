import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { e2eTarget, resolveE2ePort, BASE_PORT, SPREAD } from '../e2e/e2e-target'

// @req FR-046 — browser entry tests own an isolated, seeded SQLite authority.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/playwright-database-bootstrap.test.js, tests/e2e/fr046-entry-contract.spec.js
//
// This used to assert by grepping `playwright.config.js` and `global-setup.js`
// for the literals `file:./e2e.db` and `3100`. That pinned the spelling rather
// than the property, and could not have caught the defect it existed for: two
// files each holding a plausible literal that happen not to match. It now asserts
// what must actually be true — the seeder and the web server resolve the *same*
// database — which both files now guarantee by reading one `e2eTarget()`.

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('Playwright database bootstrap', () => {
  it('gives the web server and global setup the same database, by construction', () => {
    const config = read('playwright.config.js')
    const setup = read('tests/e2e/global-setup.js')

    // Neither file may name a database of its own; both must ask the one module.
    expect(config).toContain("require('./tests/e2e/e2e-target')")
    expect(setup).toContain("require('./e2e-target')")
    expect(config).toContain('DATABASE_URL: target.databaseUrl')
    expect(setup).toContain('DATABASE_URL: target.databaseUrl')
    expect(config).not.toMatch(/DATABASE_URL:\s*'file:/)
    expect(setup).not.toMatch(/DATABASE_URL:\s*'file:/)

    expect(config).toContain("globalSetup: './tests/e2e/global-setup.js'")
    // A run owns its server; reusing someone else's means testing their data.
    expect(config).toContain('reuseExistingServer: false')
  })

  it('isolates the e2e database from the dev and unit-test ones', () => {
    const target = e2eTarget()
    expect(target.databaseFile).toMatch(/^e2e-\d+\.db$/)
    expect(target.databaseUrl).toBe(`file:./${target.databaseFile}`)
    const setup = read('tests/e2e/global-setup.js')
    expect(setup).not.toMatch(/dev\.db|test\.db/)
    // Deleting before the push is what makes the seed idempotent from a clean slate.
    expect(setup).toContain('npx prisma db push --skip-generate')
    expect(setup).toContain('node prisma/seed.js')
  })

  it('keeps the primary checkout on :3100 so CI and the docs stay true', () => {
    expect(resolveE2ePort({ root: '/some/primary/checkout', env: {}, primary: true })).toBe(BASE_PORT)
    // And the real repository this runs in resolves without throwing.
    expect(typeof e2eTarget().port).toBe('number')
  })

  it('moves a worktree off the base port, deterministically rather than by probing', () => {
    // A git worktree stores `.git` as a file, so isPrimaryCheckout() is false and
    // the port is derived from that tree's own path. Deterministic, so two trees
    // never race for a port and a rerun always finds its own database.
    const a = resolveE2ePort({ root: 'D:/trees/alpha', env: {}, primary: false })
    const b = resolveE2ePort({ root: 'D:/trees/beta', env: {}, primary: false })

    expect(resolveE2ePort({ root: 'D:/trees/alpha', env: {}, primary: false })).toBe(a)
    expect(a).not.toBe(b)
    for (const port of [a, b]) {
      expect(port).toBeGreaterThan(BASE_PORT)
      expect(port).toBeLessThanOrEqual(BASE_PORT + SPREAD)
    }
  })

  it('lets a caller pin the port explicitly', () => {
    expect(resolveE2ePort({ root: 'D:/trees/alpha', env: { E2E_PORT: '3999' } })).toBe(3999)
  })

  it('derives the database from the port, so the pair cannot drift apart', () => {
    const pinned = e2eTarget({ root: 'D:/trees/alpha', env: { E2E_PORT: '3777' } })
    expect(pinned.port).toBe(3777)
    expect(pinned.baseURL).toBe('http://localhost:3777')
    expect(pinned.databaseFile).toBe('e2e-3777.db')
  })
})
