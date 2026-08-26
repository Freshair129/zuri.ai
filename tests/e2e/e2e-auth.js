const { createHash } = require('node:crypto')
const path = require('node:path')

// @req FR-046 — E2E uses an isolated credential and signed session, never an
// application-side authentication bypass.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/e2e/fr046-entry-contract.spec.js

const repositoryRoot = path.resolve(__dirname, '..', '..')
const fixtureSuffix = createHash('sha256').update(repositoryRoot).digest('hex')

// These defaults are test-only and are applied only to Playwright's isolated
// database/server. Production never reads either variable from this module.
const E2E_USERNAME = process.env.ZURI_E2E_USERNAME || 'owner@local'
const E2E_PASSWORD = process.env.ZURI_E2E_AUTH_PASSWORD || `e2e-only-${fixtureSuffix}`
const E2E_SESSION_SECRET = process.env.ZURI_E2E_SESSION_SECRET || `e2e-session-${fixtureSuffix}`

async function loginAsOwner(page) {
  await page.goto('/login')
  await page.getByLabel('Email or account code').fill(E2E_USERNAME)
  await page.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

function loginRequest(request, options = {}) {
  return request.post('/api/auth/login', {
    ...options,
    data: { username: E2E_USERNAME, password: E2E_PASSWORD },
  })
}

module.exports = { E2E_USERNAME, E2E_PASSWORD, E2E_SESSION_SECRET, loginAsOwner, loginRequest }
