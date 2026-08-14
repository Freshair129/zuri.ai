const { execSync } = require('node:child_process')
const { existsSync, rmSync } = require('node:fs')
const path = require('node:path')

// @req FR-046 — Playwright owns an isolated, seeded SQLite authority.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/playwright-database-bootstrap.test.js, tests/e2e/fr046-entry-contract.spec.js

const E2E_DATABASE_URL = 'file:./e2e.db'

module.exports = function globalSetup() {
  const repositoryRoot = path.resolve(__dirname, '..', '..')
  const e2eDatabase = path.resolve(repositoryRoot, 'prisma', 'e2e.db')
  const e2eJournal = `${e2eDatabase}-journal`
  for (const target of [e2eDatabase, e2eJournal]) {
    if (existsSync(target)) rmSync(target)
  }

  const inheritedRustLog = String(process.env.RUST_LOG || '').toLowerCase()
  const env = {
    ...process.env,
    DATABASE_URL: E2E_DATABASE_URL,
    RUST_LOG: /(?:trace|debug|info)/.test(inheritedRustLog) ? process.env.RUST_LOG : 'info',
  }
  execSync('npx prisma db push --skip-generate', { cwd: repositoryRoot, env, stdio: 'inherit' })
  execSync('node prisma/seed.js', { cwd: repositoryRoot, env, stdio: 'inherit' })
}
