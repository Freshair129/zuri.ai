#!/usr/bin/env node
// Runs every test/**/*.test.js with node:test and fails a run that executed zero
// tests (the repo rule of apps/server/scripts/assert-tests-ran.mjs, applied here).
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.test.js') ? [p] : [] })
const files = walk(join(root, 'test')).map((f) => relative(root, f)).sort()
const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
process.stdout.write(result.stdout)
const count = (name) => Number((new RegExp(`ℹ ${name} (\\d+)`).exec(result.stdout) ?? [])[1] ?? 0)
const summary = { files: files.length, tests: count('tests'), pass: count('pass'), fail: count('fail'), skipped: count('skipped') }
process.stdout.write(`\nSCM test summary: ${JSON.stringify(summary)}\n`)
if (summary.pass === 0) { process.stderr.write('no tests executed — refusing a green run\n'); process.exit(1) }
process.exit(result.status ?? 1)
