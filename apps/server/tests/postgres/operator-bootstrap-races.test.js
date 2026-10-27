// @req FR-107 — every first-operator entrypoint shares one empty-set decision.
// @spec ADR-115, SEC-014 — native PostgreSQL contention; no password in losing output.
// @tested tests/postgres/operator-bootstrap-races.test.js
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import pg from 'pg'
import { COMPACT_BOOTSTRAP_COMMAND } from '../../scripts/lib/compact/bootstrap-command.mjs'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const sourceUrl = new URL(inject('testDatabaseUrl'))
if (inject('testDatabaseEngine') !== 'postgresql' || sourceUrl.hostname !== '127.0.0.1' || sourceUrl.pathname !== '/zuri_server_test') {
  throw new Error('BOOTSTRAP_RACE_DISPOSABLE_CLUSTER_REQUIRED')
}
const databaseName = `zuri_bootstrap_${randomUUID().replaceAll('-', '').slice(0, 16)}`
if (!/^zuri_bootstrap_[a-f0-9]{16}$/.test(databaseName)) throw new Error('BOOTSTRAP_RACE_DATABASE_NAME_INVALID')
const databaseUrl = new URL(sourceUrl); databaseUrl.pathname = `/${databaseName}`
const firstEmail = 'first-bootstrap@example.invalid', secondEmail = 'second-bootstrap@example.invalid'
const environment = { ...process.env }
for (const key of ['DATABASE_URL', 'DIRECT_URL', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING', 'DATABASE_POSTGRES_URL']) environment[key] = databaseUrl.href
const bootstrapModule = pathToFileURL(path.join(serverRoot, 'scripts/bootstrap-operator.mjs')).href
const databaseModule = pathToFileURL(path.join(serverRoot, 'src/lib/db.js')).href
const nativeCompactCommand = COMPACT_BOOTSTRAP_COMMAND
  .replace("'/app/scripts/bootstrap-operator.mjs'", JSON.stringify(bootstrapModule))
  .replace("'/app/src/lib/db.js'", JSON.stringify(databaseModule))
const marker = { targetId: randomUUID(), manifestSha256: 'a'.repeat(64) }
let cluster, database, gate, created = false, expected

beforeAll(async () => {
  cluster = new pg.Client({ connectionString: sourceUrl.href }); await cluster.connect()
  await cluster.query(`CREATE DATABASE "${databaseName}"`); created = true
  database = new pg.Client({ connectionString: databaseUrl.href }); await database.connect()
  gate = new pg.Client({ connectionString: databaseUrl.href }); await gate.connect()
  const ddl = execFileSync(process.execPath, [path.join(serverRoot, 'node_modules/prisma/build/index.js'),
    'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.postgres.prisma', '--script'],
  { cwd: serverRoot, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 })
  await database.query(ddl)
  await database.query('CREATE SCHEMA zuri_compact; CREATE TABLE zuri_compact.installation(singleton boolean PRIMARY KEY, payload jsonb NOT NULL)')
  await database.query('INSERT INTO zuri_compact.installation VALUES(true,$1)', [marker])
  const identity = await database.query('SELECT (SELECT system_identifier::text FROM pg_control_system()) AS system, (SELECT oid::int FROM pg_database WHERE datname=current_database()) AS oid')
  expected = { ...marker, systemIdentifier: identity.rows[0].system, databaseOid: identity.rows[0].oid }
  // Pause only the first Person INSERT. The second caller can either commit
  // unsafely (RED) or wait on the shared bootstrap lock (GREEN), without sleeps
  // deciding the race. This trigger exists only in this run-created database.
  await database.query(`CREATE FUNCTION bootstrap_test_pause() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.email = '${firstEmail}' THEN PERFORM pg_advisory_xact_lock(115108::bigint); END IF; RETURN NEW; END $$;
    CREATE TRIGGER bootstrap_test_pause BEFORE INSERT ON "Person" FOR EACH ROW EXECUTE FUNCTION bootstrap_test_pause()`)
})

beforeEach(async () => {
  await database.query('TRUNCATE "AuditEvent", "PlatformGrant", "PersonCredential", "Person" CASCADE')
})

afterAll(async () => {
  try { await gate?.end() } finally {
    try { await database?.end() } finally {
      try { if (created) await cluster.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`) } finally { await cluster?.end() }
    }
  }
})

function launch(kind, email, grantOnly = false) {
  const operator = { email, displayName: email === firstEmail ? 'First Bootstrap' : 'Second Bootstrap' }
  const command = kind === 'compact' ? nativeCompactCommand : `
    import { main } from ${JSON.stringify(bootstrapModule)};
    import prisma from ${JSON.stringify(databaseModule)};
    try { await main(${JSON.stringify(['--email', email, ...(grantOnly ? ['--grant-only'] : ['--name', operator.displayName])])}); }
    catch (error) { process.stderr.write(error.message); process.exitCode = 1; }
    finally { await prisma.$disconnect(); }`
  const child = spawn(process.execPath, ['--input-type=module', '-e', command], {
    cwd: serverRoot, env: environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000,
  })
  let stdout = '', stderr = ''
  child.stdout.on('data', data => { stdout += data; if (stdout.length > 65536) child.kill() })
  child.stderr.on('data', data => { stderr += data; if (stderr.length > 65536) child.kill() })
  const state = { child, result: null }
  state.done = new Promise(resolve => {
    child.once('error', () => resolve({ code: -1, stdout: '', stderr: 'BOOTSTRAP_TEST_PROCESS_FAILED' }))
    child.once('close', code => resolve({ code, stdout, stderr }))
  }).then(result => { state.result = result; return result })
  child.stdin.on('error', () => {})
  child.stdin.end(kind === 'compact' ? JSON.stringify({ operator, expected }) : '')
  return state
}

async function waitForLockOrExit(lock, child) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const result = await database.query(`SELECT EXISTS(SELECT 1 FROM pg_locks
      WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
      AND classid=0 AND objid=$1 AND NOT granted) AS blocked`, [lock])
    if (result.rows[0].blocked) return 'BLOCKED'
    if (child.result) return 'EXITED'
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('BOOTSTRAP_TEST_LOCK_NOT_OBSERVED')
}

describe('one first operator across Compact and the existing CLI', () => {
  it.each([
    ['compact', 'direct', false],
    ['direct', 'compact', false],
    ['compact', 'direct', true],
  ])('%s first vs %s contender (grant-only=%s)', async (firstKind, secondKind, grantOnly) => {
    if (grantOnly) await database.query('INSERT INTO "Person"(id,code,"displayName",email,"updatedAt") VALUES($1,$2,$3,$4,now())', [randomUUID(), 'PSN-GRANT-ONLY', 'Existing Person', secondEmail])
    const pending = []
    await gate.query('SELECT pg_advisory_lock(115108::bigint)::text')
    try {
      const first = launch(firstKind, firstEmail); pending.push(first)
      expect(await waitForLockOrExit(115108, first)).toBe('BLOCKED')
      const second = launch(secondKind, secondEmail, grantOnly); pending.push(second)
      await waitForLockOrExit(115107, second)
      await gate.query('SELECT pg_advisory_unlock(115108::bigint)')
      const results = await Promise.all(pending.map(item => item.done))
      // Never include child stdout/passwords in an assertion's diagnostic value.
      expect(results.map(result => result.code).filter(code => code === 0)).toHaveLength(1)
      expect(results[0].code).toBe(0)
      expect(results[1].stdout.length).toBe(0)
      expect(/BOOTSTRAP_REFUSED_OPERATOR_EXISTS|COMPACT_BOOTSTRAP_REFUSED/.test(results[1].stderr)).toBe(true)
      const counts = await database.query(`SELECT
        (SELECT count(*)::int FROM "PlatformGrant" WHERE capability='OPERATOR' AND status='ACTIVE') AS grants,
        (SELECT count(*)::int FROM "AuditEvent" WHERE action='OPERATOR_BOOTSTRAPPED') AS audits,
        (SELECT count(*)::int FROM "PersonCredential" c JOIN "Person" p ON p.id=c."personId" WHERE p.email=$1) AS loser_credentials`, [secondEmail])
      expect(counts.rows[0]).toEqual({ grants: 1, audits: 1, loser_credentials: 0 })
    } finally {
      await gate.query('SELECT pg_advisory_unlock_all()')
      for (const item of pending) if (!item.result) item.child.kill()
      await Promise.all(pending.map(item => item.done))
    }
  })
})
