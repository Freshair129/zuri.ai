// @req FR-149, FR-150 — the WorkToolPort suite also runs on PostgreSQL, the
//   production engine, not only on the per-run SQLite database.
// @spec ADR-057 (no production database is ever a test target)
// @tested tests/integration/conversation-runtime-work-tool-port.test.js
//
// A disposable PostgreSQL 17 for one test run: a fresh cluster in a temp
// directory, listening on 127.0.0.1 only, on a free port, with a synthetic
// password generated per run. It takes no URL from the environment, so it can
// never be pointed at a real or shared database, and `stop()` deletes the
// cluster. Binaries come from the `embedded-postgres` devDependency, the same
// package and version the SCM service extraction uses for its PostgreSQL suite
// on the #546 branch (feat/scm-service-extraction, not on main).
//
// The cluster is started through initdb + pg_ctl rather than by spawning
// postgres directly: on Windows both drop an administrator token to a
// restricted one, and postgres itself refuses to run as an administrator
// (a GitHub-hosted Windows runner is one). It is UTF-8 with the C locale
// whatever this machine's code page is: a Thai Windows host would otherwise
// get WIN874, and the suite writes Thai text the way production does.
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

const PLATFORM_PACKAGES = {
  'win32-x64': '@embedded-postgres/windows-x64',
  'linux-x64': '@embedded-postgres/linux-x64',
  'linux-arm64': '@embedded-postgres/linux-arm64',
  'darwin-x64': '@embedded-postgres/darwin-x64',
  'darwin-arm64': '@embedded-postgres/darwin-arm64',
}

const freePort = () => new Promise((resolve, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(() => resolve(port))
  })
})

async function binaries() {
  const name = PLATFORM_PACKAGES[`${process.platform}-${process.arch}`]
  if (!name) throw new Error(`EMBEDDED_POSTGRES_PLATFORM_UNSUPPORTED: ${process.platform}-${process.arch}`)
  const { initdb, pg_ctl: pgCtl } = await import(name)
  return { initdb, pgCtl }
}

/**
 * Start a disposable cluster and create `database` in it.
 * Returns { url, stop }. `url` has no query string, so nothing in it can
 * redirect the driver away from the loopback authority.
 */
export async function startEmbeddedPostgres({ label = 'test', database = 'zuri_test' } = {}) {
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(database)) throw new Error('EMBEDDED_POSTGRES_DATABASE_NAME_INVALID')
  const { initdb, pgCtl } = await binaries()
  const root = mkdtempSync(path.join(tmpdir(), `zuri-pg-${label}-`))
  const data = path.join(root, 'data')
  const user = 'zuri_test'
  const password = randomBytes(18).toString('hex')
  const passwordFile = path.join(root, 'pwfile')
  writeFileSync(passwordFile, `${password}\n`)
  const port = await freePort()
  // stdio is ignored, not piped: `pg_ctl start` leaves postgres running with
  // the handles it inherited, so a piped stdout would never close and the call
  // would hang until its timeout. initdb and pg_ctl write their own log files.
  const run = (bin, args) => execFileSync(bin, args, { cwd: root, stdio: 'ignore', timeout: 120_000, windowsHide: true })
  const stop = () => {
    // Stop whatever was started, even when start itself failed or timed out:
    // a postmaster.pid means a server may be running out of this directory.
    try {
      if (existsSync(path.join(data, 'postmaster.pid'))) run(pgCtl, ['stop', '-D', data, '-m', 'fast', '-w', '-t', '60'])
    } catch { /* the directory removal below reports a server that is still up */ }
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
  try {
    run(initdb, ['-D', data, '-U', user, `--pwfile=${passwordFile}`, '--auth=scram-sha-256',
      '--encoding=UTF8', '--locale=C', '--no-sync'])
    rmSync(passwordFile, { force: true })
    // Settings go into postgresql.conf rather than through `pg_ctl -o`, which
    // would need shell quoting that differs between Windows and POSIX.
    const socketDir = root.replace(/\\/g, '/')
    appendFileSync(path.join(data, 'postgresql.conf'), [
      '', '# zuri disposable test cluster',
      "listen_addresses = '127.0.0.1'", `port = ${port}`, `unix_socket_directories = '${socketDir}'`,
      'max_connections = 100', 'fsync = off', 'synchronous_commit = off', 'full_page_writes = off', '',
    ].join('\n'))
    run(pgCtl, ['start', '-D', data, '-w', '-t', '60', '-l', path.join(root, 'postgres.log')])
    const base = `postgresql://${user}:${password}@127.0.0.1:${port}`
    const pg = (await import('pg')).default
    const admin = new pg.Client({ connectionString: `${base}/postgres` })
    await admin.connect()
    try { await admin.query(`CREATE DATABASE ${database} ENCODING 'UTF8' TEMPLATE template0`) } finally { await admin.end() }
    return { url: `${base}/${database}`, port, stop }
  } catch (error) {
    try { stop() } catch (cleanup) { error.message += ` (cleanup: ${cleanup.message})` }
    throw error
  }
}
