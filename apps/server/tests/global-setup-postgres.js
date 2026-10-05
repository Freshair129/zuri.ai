// @req FR-149, FR-150 — the WorkToolPort suite also runs on PostgreSQL.
// @spec ADR-057 (no production database is ever a test target)
// @tested tests/integration/conversation-runtime-work-tool-port.test.js
//
// globalSetup for vitest.postgres.config.js: the PostgreSQL counterpart of
// tests/global-setup.js. It starts a disposable embedded PostgreSQL cluster
// (tests/helpers/embedded-postgres.js), creates this run's schema from the
// generated Postgres Prisma schema, and hands the URL to the workers through
// the same provide/inject channel tests/setup.js already reads. src/lib/db.js
// then selects the Postgres client for a postgres: DATABASE_URL, so the suite
// runs unchanged. The cluster is stopped and deleted in the returned teardown,
// pass or fail. No database URL is read from the environment.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { startEmbeddedPostgres } from './helpers/embedded-postgres.js'

const ROOT = path.resolve(__dirname, '..')
const PRISMA_CLI = path.join(ROOT, 'node_modules', 'prisma', 'build', 'index.js')
const PG_SCHEMA = path.join(ROOT, 'prisma', 'schema.postgres.prisma')
const PG_CLIENT = path.join(ROOT, 'node_modules', '@zuri', 'prisma-postgres')
const normalize = text => text.replace(/\r\n/g, '\n')

const prisma = (args, env = process.env) => execFileSync(process.execPath, [PRISMA_CLI, ...args],
  { cwd: ROOT, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })

/**
 * The Postgres schema is generated from prisma/schema.prisma and its client is
 * emitted by postinstall. A schema that arrived by pull, or an `npm install`
 * that pruned the generated package, would leave a stale or missing client, so
 * regenerate here when the client's copy of the schema is not the current one.
 */
function ensurePostgresClient() {
  execFileSync(process.execPath, ['scripts/gen-postgres-schema.mjs'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
  const clientSchema = path.join(PG_CLIENT, 'schema.prisma')
  if (existsSync(clientSchema) && normalize(readFileSync(clientSchema, 'utf8')) === normalize(readFileSync(PG_SCHEMA, 'utf8'))) return
  prisma(['generate', '--schema', 'prisma/schema.postgres.prisma'])
  const manifest = path.join(PG_CLIENT, 'package.json')
  const generated = JSON.parse(readFileSync(manifest, 'utf8'))
  generated.name = '@zuri/prisma-postgres'
  writeFileSync(manifest, `${JSON.stringify(generated, null, 2)}\n`)
}

export default async function globalSetup({ provide }) {
  ensurePostgresClient()
  const server = await startEmbeddedPostgres({ label: 'server', database: 'zuri_server_test' })
  try {
    const ddl = prisma(['migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.postgres.prisma', '--script'])
    const client = new pg.Client({ connectionString: server.url })
    await client.connect()
    try {
      await client.query(ddl)
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('Portfolio', 'Tenant', 'Business', 'LineConversationJob', 'WorkItem', 'AuditEvent')`)
      if (rows[0].n !== 6) throw new Error(`POSTGRES_TEST_SCHEMA_NOT_APPLIED: ${rows[0].n}/6 foundation tables`)
    } finally { await client.end() }
  } catch (error) {
    try { await server.stop() } catch (cleanup) { error.message += ` (cleanup: ${cleanup.message})` }
    throw error
  }
  provide('testDatabaseUrl', server.url)
  provide('testDatabaseEngine', 'postgresql')
  return () => server.stop()
}
