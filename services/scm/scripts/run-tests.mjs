#!/usr/bin/env node
// Runs every test/**/*.test.js with node:test and fails a run that executed zero
// tests (the repo rule of apps/server/scripts/assert-tests-ran.mjs, applied here).
//
// Engine: `--engine=postgres` (or SCM_TEST_ENGINE=postgres) runs the SAME suite on
// a disposable PostgreSQL started here (embedded-postgres, temp dir, 127.0.0.1,
// random port) and removed afterwards; every test store gets its own database.
// Default is SQLite. Extra arguments are test file filters.
import { spawnSync } from 'node:child_process'
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
let result
try {
  result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], { cwd: root, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 })
} finally {
  await server?.stop()
}
process.stdout.write(result.stdout)
const count = (name) => Number((new RegExp(`ℹ ${name} (\\d+)`).exec(result.stdout) ?? [])[1] ?? 0)
const summary = { engine, files: files.length, tests: count('tests'), pass: count('pass'), fail: count('fail'), skipped: count('skipped') }
process.stdout.write(`\nSCM test summary: ${JSON.stringify(summary)}\n`)
if (summary.pass === 0) { process.stderr.write('no tests executed — refusing a green run\n'); process.exit(1) }
process.exit(result.status ?? 1)
