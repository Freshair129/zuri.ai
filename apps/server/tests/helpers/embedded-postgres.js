// @req FR-149, FR-150 — the WorkToolPort suite also runs on PostgreSQL, the
//   production engine, not only on the per-run SQLite database.
// @spec ADR-057 (no production database is ever a test target)
// @tested tests/integration/conversation-runtime-work-tool-port.test.js,
//   tests/unit/embedded-postgres-cleanup.test.js
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
//
// Stopping is strict about the server and lenient about the directory. The
// postmaster must be gone before `stop()` resolves, or it throws. The temp
// directory is then removed with retries and backoff; on a Windows runner a
// just-exited postgres or a file scanner can hold it for a moment (EBUSY, #593).
// A directory still locked after the retries is left behind with a warning:
// leftover temp files never turn a green suite red.
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { rm as removePath } from 'node:fs/promises'
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

// Codes a Windows or POSIX rm gives for a directory something still holds.
const DIRECTORY_BUSY = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY', 'EMFILE', 'ENFILE'])
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Whether a process with this pid exists (EPERM: it exists, not ours to signal). */
export function processAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/** The postmaster's pid from the first line of postmaster.pid, or null. */
function postmasterPid(data) {
  try {
    const pid = Number.parseInt(readFileSync(path.join(data, 'postmaster.pid'), 'utf8').split(/\r?\n/)[0], 10)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

async function exited(pid, { alive, sleep, timeoutMs }) {
  const deadline = Date.now() + timeoutMs
  while (alive(pid)) {
    if (Date.now() >= deadline) return false
    await sleep(100)
  }
  return true
}

/**
 * Remove a stopped cluster's temp directory, retrying with exponential backoff
 * while something still holds it. Resolves true when it is gone and false when
 * it had to be left behind; it never rejects, so cleanup cannot fail a run.
 */
export async function removeClusterDirectory(root, {
  rm = removePath, sleep = pause, warn = console.warn, attempts = 8, firstDelayMs = 100, maxDelayMs = 2_000,
} = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true })
      return true
    } catch (error) {
      if (attempt < attempts && DIRECTORY_BUSY.has(error?.code)) {
        await sleep(Math.min(firstDelayMs * 2 ** (attempt - 1), maxDelayMs))
        continue
      }
      warn(`[embedded-postgres] left ${root} behind after ${attempt} attempt(s): ${error?.code ?? error?.message}. `
        + 'The cluster is stopped; only its temp files remain.')
      return false
    }
  }
}

/**
 * Stop the cluster in `data` and delete `root`. The postmaster is stopped with
 * `pg_ctl stop -m fast`, then `-m immediate` if that fails, and `stop` waits for
 * the postmaster process itself to exit; if it is still running, `stop` throws
 * and leaves the directory in place. Only then is `root` removed, leniently.
 */
export async function stopCluster({
  root, data, pgCtl, run, alive = processAlive, sleep = pause, exitTimeoutMs = 30_000, remove = removeClusterDirectory,
}) {
  const pid = postmasterPid(data)
  // A postmaster.pid means a server may be running out of this directory, even
  // when start itself failed or timed out.
  if (pid !== null || existsSync(path.join(data, 'postmaster.pid'))) {
    for (const mode of ['fast', 'immediate']) {
      try {
        run(pgCtl, ['stop', '-D', data, '-m', mode, '-w', '-t', '60'])
        break
      } catch { /* try the next mode; the exit check below decides */ }
    }
  }
  if (pid !== null && !(await exited(pid, { alive, sleep, timeoutMs: exitTimeoutMs }))) {
    throw new Error(`EMBEDDED_POSTGRES_STOP_FAILED: postmaster ${pid} still running out of ${data}`)
  }
  await remove(root)
}

async function binaries() {
  const name = PLATFORM_PACKAGES[`${process.platform}-${process.arch}`]
  if (!name) throw new Error(`EMBEDDED_POSTGRES_PLATFORM_UNSUPPORTED: ${process.platform}-${process.arch}`)
  const { initdb, pg_ctl: pgCtl } = await import(name)
  return { initdb, pgCtl }
}

/**
 * Start a disposable cluster and create `database` in it.
 * Returns { url, port, stop }; `stop()` is async (see stopCluster). `url` has no query string, so nothing in it can
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
  const stop = () => stopCluster({ root, data, pgCtl, run })
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
    try { await stop() } catch (cleanup) { error.message += ` (cleanup: ${cleanup.message})` }
    throw error
  }
}
