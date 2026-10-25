// @req SEC-001, SEC-018 — own and remove the isolated PostgreSQL container
//   used by the destructive production-migration integration proof.
// @spec ADR-104 D5
// @tested tests/integration/production-migration-isolated-postgres.test.js

import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { assertOwnedDisposableTestDatabase } from './production-migration-test-target.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = path.resolve(SCRIPT_DIR, '..')
const OWNER_PURPOSE = 'com.zuri-ai.test.purpose'
const OWNER_TOKEN_LABEL = 'com.zuri-ai.test.owner-token'
const IMAGE = 'postgres:17-alpine'

function docker(args, { tolerateFailure = false } = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0) {
    if (tolerateFailure) return ''
    throw new Error(`ISOLATED_POSTGRES_FAILED: docker ${args[0]} did not succeed`)
  }
  return result.stdout.trim()
}

async function waitForPostgres(databaseUrl, containerId, ownerToken) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    let client
    try {
      const raw = docker(['inspect', containerId])
      const [container] = JSON.parse(raw)
      const target = assertOwnedDisposableTestDatabase({ databaseUrl, containerId, ownerToken, container })
      client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 1_000 })
      await client.connect()
      const identity = (await client.query(`select current_user as user, current_database() as database`)).rows[0]
      if (identity.user !== 'postgres' || identity.database !== target.database) {
        throw new Error('ISOLATED_POSTGRES_FAILED: database identity mismatch')
      }
      await client.end()
      return
    } catch {
      await client?.end().catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw new Error('ISOLATED_POSTGRES_FAILED: owned database did not become ready')
}

const runId = crypto.randomUUID().replaceAll('-', '')
const containerName = `pm-migration-isolated-${runId}`
const ownerToken = crypto.randomBytes(32).toString('hex')
const password = crypto.randomBytes(32).toString('base64url')
let containerId
let exitCode = 1

try {
  containerId = docker([
    'run', '--detach', '--rm',
    '--name', containerName,
    '--label', `${OWNER_PURPOSE}=production-migration-isolated`,
    '--label', `${OWNER_TOKEN_LABEL}=${ownerToken}`,
    '--publish', '127.0.0.1::5432',
    '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=268435456',
    '--env', 'POSTGRES_USER=postgres',
    '--env', `POSTGRES_PASSWORD=${password}`,
    '--env', 'POSTGRES_DB=pm_migration_test',
    IMAGE,
  ])
  const inspected = JSON.parse(docker(['inspect', containerId]))[0]
  const binding = assertOwnedDisposableTestDatabase({
    databaseUrl: `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${inspected.NetworkSettings.Ports['5432/tcp'][0].HostPort}/pm_migration_test`,
    containerId,
    ownerToken,
    container: inspected,
  })
  const databaseUrl = `postgresql://postgres:${encodeURIComponent(password)}@${binding.host}:${binding.port}/${binding.database}`
  await waitForPostgres(databaseUrl, containerId, ownerToken)

  const vitest = path.join(SERVER_ROOT, 'node_modules', 'vitest', 'vitest.mjs')
  const result = spawnSync(process.execPath, [vitest, 'run', 'tests/integration/production-migration-isolated-postgres.test.js'], {
    cwd: SERVER_ROOT,
    env: {
      ...process.env,
      PM_MIGRATION_TEST_DATABASE_URL: databaseUrl,
      PM_MIGRATION_TEST_CONTAINER_ID: containerId,
      PM_MIGRATION_TEST_OWNER_TOKEN: ownerToken,
    },
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error) throw new Error('ISOLATED_POSTGRES_FAILED: Vitest could not start')
  exitCode = result.status ?? 1
} catch (error) {
  console.error(error.message)
} finally {
  if (containerId) docker(['rm', '--force', '--volumes', containerId], { tolerateFailure: true })
}

process.exitCode = exitCode
