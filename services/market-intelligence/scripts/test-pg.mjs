import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Runs the Postgres conformance suite against a throwaway postgres:16-alpine container
// with its own name and a random loopback port. It never touches the `zuri-ai` Compose
// project, its network or volumes, and it removes the container afterwards. No Docker
// means NOT_RUN (exit 2), never a silent pass.
// @spec ADR-108

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const name = `zuri-market-pg-test-${process.pid}`
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...opts })

if (run('docker', ['version', '--format', '{{.Server.Version}}']).status !== 0) {
  process.stderr.write('NOT_RUN: Docker is not available; postgres conformance was not executed\n')
  process.exit(2)
}

const started = run('docker', ['run', '-d', '--rm', '--name', name, '-e', 'POSTGRES_PASSWORD=market-test-only',
  '-e', 'POSTGRES_DB=market_test', '-p', '127.0.0.1::5432', 'postgres:16-alpine'])
if (started.status !== 0) {
  process.stderr.write(started.stderr)
  process.exit(1)
}

let exitCode = 1
try {
  const port = run('docker', ['port', name, '5432/tcp']).stdout.trim().split(':').pop()
  let ready = false
  for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
    ready = run('docker', ['exec', name, 'pg_isready', '-U', 'postgres', '-d', 'market_test']).status === 0
    if (!ready) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
  }
  if (!ready) throw new Error('disposable postgres did not become ready')
  // pg_isready can pass before the init restart finishes; give it a moment.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500)
  const url = `postgres://postgres:market-test-only@127.0.0.1:${port}/market_test`
  const tests = run(process.execPath, ['--test', 'test/pg-store.test.js'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, MARKET_TEST_PG_URL: url },
  })
  exitCode = tests.status ?? 1
} finally {
  run('docker', ['rm', '-f', name])
}
process.exit(exitCode)
