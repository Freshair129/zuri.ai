#!/usr/bin/env node
// The apps/server test files that import — directly or transitively — any of
// the given source files, computed by vitest itself (`vitest related`
// semantics: the same static + dynamic import graph `vitest related <files>`
// filters by). Nothing is executed: vitest only transforms modules to read
// their imports, so no database, global setup or setup file runs.
//
// Usage: node scripts/vitest-related.mjs --out <file.json> <source files...>
// Writes { all, related, scanners, dynamic } — paths relative to apps/server,
// `/` separated. `all` is every file the default config would run, so a caller
// can measure fan-out against the whole suite.
//
// Two kinds of test depend on files no import graph can see, so they are
// reported for the caller to include on every related run (#609 review):
//   scanners — the test, or a helper it imports from outside the application
//              source (tests/**, scripts/**), lists a directory (readdir,
//              glob, opendir): route/API reachability, visibility enforcement,
//              table integrity... A NEW file in the walked tree changes their
//              verdict without being imported by them.
//   dynamic  — the test loads code through a computed `import(pathToFileURL(…))`,
//              which vitest cannot resolve statically.
// Application source (src/, services/*/src/) is excluded from the scan: a
// runtime module that lists a user directory is behaviour, not a tree walk.
//
// Consumed by the repository's scripts/ci-change-scope.mjs, which fails safe to
// the full suite whenever this exits non-zero or does not finish in time.
// @spec docs/SYSTEM-DIAGRAM.md
// @tested tests/unit/ci-change-scope.test.js

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createVitest } from 'vitest/node'

const SCANS = /\b(readdirSync|readdir|opendirSync|opendir|globSync|glob)\s*\(|fs\.promises\.readdir|\bfg\s*\(/
const DYNAMIC = /\bimport\s*\(\s*pathToFileURL\s*\(/
const APPLICATION_SOURCE = /\/(apps\/server\/src|services\/[^/]+\/src)\//
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
  const scanners = []
  const dynamic = []
  const text = new Map()
  const read = (file) => {
    if (!text.has(file)) {
      try { text.set(file, readFileSync(file, 'utf8')) } catch { text.set(file, '') }
    }
    return text.get(file)
  }
  for (const spec of specs) {
    const own = read(spec.moduleId)
    if (DYNAMIC.test(own)) dynamic.push(rel(spec))
    const deps = [...await vitest.getTestDependencies(spec)].filter((dep) => !APPLICATION_SOURCE.test(posix(dep)))
    if ([spec.moduleId, ...deps].some((file) => SCANS.test(read(file)))) scanners.push(rel(spec))
  }
  writeFileSync(out, JSON.stringify({
    all: specs.map(rel).sort(),
    related: related.map(rel).sort(),
    scanners: scanners.sort(),
    dynamic: dynamic.sort(),
  }))
} finally {
  await vitest.close()
}
