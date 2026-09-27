#!/usr/bin/env node
// Runs every test/**/*.test.js with node:test and fails a run that executed zero
// tests (the repo rule of apps/server/scripts/assert-tests-ran.mjs, applied here).
//
// Engine: `--engine=postgres` (or SCM_TEST_ENGINE=postgres) runs the SAME suite on
// a disposable PostgreSQL started here (embedded-postgres, temp dir, 127.0.0.1,
// random port) and removed afterwards; every test store gets its own database.
// Default is SQLite. Extra arguments are test file filters.
import { spawn } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const engine = args.includes('--engine=postgres') || process.env.SCM_TEST_ENGINE === 'postgres' ? 'postgres' : 'sqlite'
const filters = args.filter((a) => !a.startsWith('--'))
const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.test.js') ? [p] : [] })
const files = walk(join(root, 'test')).map((f) => relative(root, f)).sort().filter((f) => !filters.length || filters.some((x) => f.replace(/\\/g, '/').includes(x)))

let server = null
const env = { ...process.env, SCM_TEST_ENGINE: engine }
if (engine === 'postgres') {
  const { startTestPostgres } = await import('../test/support/pg-server.js')
  server = await startTestPostgres({ label: 'suite' })
  env.SCM_TEST_PG_ADMIN_URL = server.adminUrl
}
// Asynchronous on purpose: the embedded PostgreSQL started above pipes its log
// output into THIS process, and only this event loop drains that pipe. A
// spawnSync here blocked the loop for the whole run, so once the server had
// written a pipe's worth of log lines (64 KiB on Linux) every backend stalled
// on its next log write and the suite timed out with SCM_PG_NO_REPLY.
const runSuite = () => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--test', '--test-reporter=spec', ...files], { cwd: root, env, stdio: ['ignore', 'pipe', 'inherit'] })
  let stdout = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.once('error', reject)
  child.once('close', (status) => resolve({ stdout, status }))
})
let result
try {
  result = await runSuite()
} finally {
  await server?.stop()
}
process.stdout.write(result.stdout)
const count = (name) => Number((new RegExp(`ℹ ${name} (\\d+)`).exec(result.stdout) ?? [])[1] ?? 0)
const summary = { engine, files: files.length, tests: count('tests'), pass: count('pass'), fail: count('fail'), skipped: count('skipped') }
process.stdout.write(`\nSCM test summary: ${JSON.stringify(summary)}\n`)
if (summary.pass === 0) { process.stderr.write('no tests executed — refusing a green run\n'); process.exit(1) }
process.exit(result.status ?? 1)
