#!/usr/bin/env node
// The apps/server test files that import — directly or transitively — any of
// the given source files, computed by vitest itself (`vitest related`
// semantics: the same static + dynamic import graph `vitest related <files>`
// filters by). Nothing is executed: vitest only transforms modules to read
// their imports, so no database, global setup or setup file runs.
//
// Usage: node scripts/vitest-related.mjs --out <file.json> <source files...>
// Writes { all: [...], related: [...] } — paths relative to apps/server, `/`
// separated. `all` is every file the default config would run, so a caller can
// measure fan-out against the whole suite.
//
// Consumed by the repository's scripts/ci-change-scope.mjs, which fails safe to
// the full suite whenever this exits non-zero or does not finish in time.
// @spec docs/SYSTEM-DIAGRAM.md
// @tested tests/unit/ci-change-scope.test.js

import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createVitest } from 'vitest/node'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const posix = (file) => file.split(path.sep).join('/')

const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
if (outIndex === -1 || !args[outIndex + 1]) {
  console.error('usage: vitest-related.mjs --out <file.json> <source files...>')
  process.exit(2)
}
const out = args[outIndex + 1]
const sources = args.filter((_, i) => i !== outIndex && i !== outIndex + 1).map((file) => posix(path.resolve(file)))
if (sources.length === 0) {
  console.error('vitest-related: no source files given')
  process.exit(2)
}

const vitest = await createVitest('test', { root: ROOT, watch: false, run: true, related: sources, passWithNoTests: true })
try {
  const specs = await vitest.globTestFiles()
  const related = await vitest.filterTestsBySource(specs)
  const rel = (spec) => posix(path.relative(ROOT, spec.moduleId ?? spec[1]))
  writeFileSync(out, JSON.stringify({ all: specs.map(rel).sort(), related: related.map(rel).sort() }))
} finally {
  await vitest.close()
}
