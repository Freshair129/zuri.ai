const { execSync } = require('node:child_process')
const { existsSync, rmSync } = require('node:fs')
const path = require('node:path')
const { e2eTarget } = require('./e2e-target')
const { E2E_PASSWORD, E2E_SESSION_SECRET } = require('./e2e-auth')

// @req FR-046 — Playwright owns an isolated, seeded SQLite authority.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/playwright-database-bootstrap.test.js, tests/e2e/fr046-entry-contract.spec.js
//
// The database is not named here. It comes from the same `e2eTarget()` the
// Playwright config uses for the web server, so the database this seeds and the
// database the server reads are the same one by construction — the failure
// recorded in .brain/rca/2026-08-14-e2e-database-bootstrap-gap.md was precisely
// those two drifting apart while each looked correct in isolation.

module.exports = function globalSetup() {
  const repositoryRoot = path.resolve(__dirname, '..', '..')
  const target = e2eTarget({ root: repositoryRoot })

  // Only this run's own database, so a sibling worktree's e2e run is untouched.
  for (const file of [target.databasePath, `${target.databasePath}-journal`]) {
    if (existsSync(file)) rmSync(file)
  }

  const inheritedRustLog = String(process.env.RUST_LOG || '').toLowerCase()
  const env = {
    ...process.env,
    DATABASE_URL: target.databaseUrl,
    ZURI_SESSION_SECRET: E2E_SESSION_SECRET,
    ZURI_SEED_OWNER_PASSWORD: E2E_PASSWORD,
    RUST_LOG: /(?:trace|debug|info)/.test(inheritedRustLog) ? process.env.RUST_LOG : 'info',
  }
  execSync('npx prisma db push --skip-generate', { cwd: repositoryRoot, env, stdio: 'inherit' })
  execSync('node prisma/seed.js', { cwd: repositoryRoot, env, stdio: 'inherit' })
}
