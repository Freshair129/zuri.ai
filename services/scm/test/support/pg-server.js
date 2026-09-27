// A disposable PostgreSQL for tests (embedded-postgres, devDependency): a fresh
// cluster in a temp directory on 127.0.0.1 and a random port, trust auth for a
// synthetic superuser, deleted on stop. Never pointed at any other server.
// The cluster is UTF-8 with the C locale whatever this machine's code page is
// (a Thai Windows host would otherwise give WIN874, which cannot store '·' or
// Thai text the way production does).
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import EmbeddedPostgres from 'embedded-postgres'

const freePort = () => new Promise((resolve, reject) => {
  const s = createServer()
  s.once('error', reject)
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
})

export async function startTestPostgres({ label = 'scm' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `zuri-s5-pg-${label}-`))
  const port = await freePort()
  const user = 'scm_test'
  const password = 'scm-test-synthetic'
  const pg = new EmbeddedPostgres({ databaseDir: join(dir, 'data'), user, password, port, persistent: false, onLog: () => {}, onError: () => {}, initdbFlags: ['--encoding=UTF8', '--locale=C'], postgresFlags: ['-c', 'listen_addresses=127.0.0.1', '-c', 'max_connections=200', '-c', 'fsync=off'] })
  await pg.initialise()
  await pg.start()
  const base = `postgres://${user}:${password}@127.0.0.1:${port}`
  return {
    port,
    adminUrl: `${base}/postgres`,
    urlFor: (database) => `${base}/${database}`,
    async stop() {
      try { await pg.stop() } finally { rmSync(dir, { recursive: true, force: true }) }
    },
  }
}
