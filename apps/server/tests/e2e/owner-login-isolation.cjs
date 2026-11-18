const { createHash } = require('node:crypto')
const { existsSync, lstatSync, realpathSync } = require('node:fs')
const path = require('node:path')

// @req FR-046, FR-296 — happy-path browser fixtures own isolated login budgets;
// the application's real authentication and limiter remain unchanged.
// @spec ADR-017, SEC-008, SEC-026
// @tested tests/unit/e2e-owner-login-isolation.test.js, tests/integration/e2e-owner-login-rate-limit.test.js
const ROOT = path.resolve(__dirname, '..', '..')
const digest = (value) => createHash('sha256').update(value, 'utf8').digest('hex')

function normalizedUsername(username) {
  if (typeof username !== 'string' || !username.trim()) throw new Error('E2E_LOGIN_USERNAME_REQUIRED')
  return username.trim().toLowerCase()
}

/** Only the chosen fixture identifier and the isolated server's loopback budgets. */
function ownerLoginBucketFilter(username) {
  const identifier = digest(normalizedUsername(username))
  return { OR: [
    { key: `AUTH_RATE_LIMIT:LOGIN:IDENTIFIER:${identifier}` },
    { key: { startsWith: `AUTH_RATE_LIMIT:LOGIN:IDENTIFIER_ADDRESS:${identifier}:` } },
    { key: { in: ['127.0.0.1', '::1', '::ffff:127.0.0.1'].map((address) =>
      `AUTH_RATE_LIMIT:LOGIN:ADDRESS:${digest(address)}`) } },
  ] }
}

/** Never inherit DATABASE_URL or silently create/open an arbitrary database. */
function fixtureDatabaseUrl(target, root = ROOT) {
  const port = target?.port
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('E2E_LOGIN_TARGET_MISMATCH')
  const name = `e2e-${port}.db`
  const expected = path.resolve(root, 'prisma', name)
  if (target.baseURL !== `http://localhost:${port}` || target.databaseFile !== name
      || target.databaseUrl !== `file:./${name}` || target.databasePath !== expected) {
    throw new Error('E2E_LOGIN_TARGET_MISMATCH')
  }
  if (!existsSync(expected)) throw new Error('E2E_LOGIN_FIXTURE_DB_NOT_PREPARED')
  if (!lstatSync(expected).isFile()) throw new Error('E2E_LOGIN_TARGET_MISMATCH')
  // Reject both a symlink file and a symlinked prisma directory outside this root.
  const canonical = path.join(realpathSync(root), 'prisma', name)
  if (path.relative(canonical, realpathSync(expected)) !== '') throw new Error('E2E_LOGIN_TARGET_MISMATCH')
  return `file:${expected.replace(/\\/g, '/')}`
}

async function resetIsolatedOwnerBudget(username) {
  const { e2eTarget } = require('./e2e-target')
  const url = fixtureDatabaseUrl(e2eTarget())
  const { PrismaClient } = require('@prisma/client')
  const db = new PrismaClient({ datasources: { db: { url } } })
  try {
    await db.rateLimitBucket.deleteMany({ where: ownerLoginBucketFilter(username) })
  } finally {
    await db.$disconnect()
  }
}

/**
 * Prepare once per request context, NOT once per login attempt. Repeated attempts
 * in the same test still exhaust the real limiter, including concurrent calls.
 * Cross-context rate-limit tests should use the raw endpoint, not this happy-path
 * owner fixture. Playwright's existing single-worker isolation is unchanged.
 */
function createOwnerLoginIsolation(resetBudget = resetIsolatedOwnerBudget) {
  const contexts = new WeakMap()
  return async function prepare(context, username) {
    if (!context || (typeof context !== 'object' && typeof context !== 'function')) {
      throw new Error('E2E_LOGIN_CONTEXT_REQUIRED')
    }
    const identifier = normalizedUsername(username)
    let users = contexts.get(context)
    if (!users) { users = new Map(); contexts.set(context, users) }
    if (!users.has(identifier)) users.set(identifier, Promise.resolve().then(() => resetBudget(identifier)))
    // Retain a failed preparation too: never silently retry a fixture mutation.
    await users.get(identifier)
  }
}

const prepareOwnerLogin = createOwnerLoginIsolation()
module.exports = { ownerLoginBucketFilter, fixtureDatabaseUrl, createOwnerLoginIsolation, prepareOwnerLogin }
