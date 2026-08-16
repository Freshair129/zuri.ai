#!/usr/bin/env node
// Fails a test run that executed nothing.
//
// Why this exists: a harness can report success without doing any work, and
// that failure is invisible — the exit code says pass and the summary line is
// *absent* rather than wrong, so anything reading only the exit status (CI, a
// script, an agent) concludes the suite is green.
//
// Reproduced on this repo:
//   npx vitest run -t "NO_MATCH"   → exit 0, 116 skipped, 792 skipped
//
// Playwright 1.49.1 exits non-zero on a port collision and on a non-matching
// grep, so it is not currently exposed — but that is a property of one version,
// not a guarantee, and this guard makes both runners version-proof.
//
// Usage:  node scripts/assert-tests-ran.mjs <vitest|playwright> [args...]
//
// @spec .brain/rca/2026-08-17-governance-did-not-govern.md — "exit code 0 must
// mean the work ran and passed, never that the work did not run".
// @tested tests/unit/assert-tests-ran.test.js

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPORT_DIR = path.join(ROOT, 'node_modules', '.cache', 'zuri-test-proof')

/** Count only tests that actually executed. Skipped is not work. */
export function executedFromVitest(report) {
  if (!report || typeof report !== 'object') return null
  const { numPassedTests, numFailedTests } = report
  if (typeof numPassedTests !== 'number' || typeof numFailedTests !== 'number') return null
  return numPassedTests + numFailedTests
}

/**
 * Tests that failed and then passed on a retry.
 *
 * Playwright exits **0** for these, and the summary reports them on a line
 * separate from "failed" — so a flaky suite is green to every automated reader
 * and easy to miss for a human one. A retry that turns red into green is not
 * absorbing noise, it is discarding evidence: the test is not trustworthy, and
 * the build should say so. Keeping `retries: 1` and failing here preserves the
 * diagnosis (flaky, not consistently broken) while removing the concealment.
 */
export function flakyFromPlaywright(report) {
  if (!report || !Array.isArray(report.suites)) return null
  const flaky = []
  const visit = (suite, trail) => {
    const here = suite.title ? [...trail, suite.title] : trail
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        if (test.status === 'flaky') flaky.push([...here, spec.title].filter(Boolean).join(' › '))
      }
    }
    for (const child of suite.suites || []) visit(child, here)
  }
  for (const suite of report.suites) visit(suite, [])
  return flaky
}

export function executedFromPlaywright(report) {
  if (!report || typeof report !== 'object') return null
  let executed = 0
  let sawSuite = false
  const visitSuite = (suite) => {
    sawSuite = true
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        for (const result of test.results || []) {
          // `skipped` never counts; an interrupted run counts as work attempted,
          // because it proves the harness got as far as running something.
          if (result.status && result.status !== 'skipped') executed += 1
        }
      }
    }
    for (const child of suite.suites || []) visitSuite(child)
  }
  for (const suite of report.suites || []) visitSuite(suite)
  return sawSuite || Array.isArray(report.suites) ? executed : null
}

const RUNNERS = {
  vitest: {
    bin: 'vitest',
    reportFile: 'vitest.json',
    extraArgs: (file) => ['--reporter=default', '--reporter=json', `--outputFile.json=${file}`],
    parse: executedFromVitest,
  },
  playwright: {
    bin: 'playwright',
    reportFile: 'playwright.json',
    extraArgs: () => ['--reporter=list,json'],
    env: (file) => ({ PLAYWRIGHT_JSON_OUTPUT_NAME: file }),
    parse: executedFromPlaywright,
  },
}

function main() {
  const [kind, ...argv] = process.argv.slice(2)
  const FLAKY_FLAG = '--fail-on-flaky'
  const failOnFlaky = argv.includes(FLAKY_FLAG)
  const rest = argv.filter((a) => a !== FLAKY_FLAG)
  const runner = RUNNERS[kind]
  if (!runner) {
    console.error(`assert-tests-ran: unknown runner "${kind}" (expected: ${Object.keys(RUNNERS).join(', ')})`)
    process.exit(2)
  }

  mkdirSync(REPORT_DIR, { recursive: true })
  const reportPath = path.join(REPORT_DIR, runner.reportFile)
  rmSync(reportPath, { force: true })

  // Resolve from node_modules/.bin rather than PATH. Relying on PATH made this
  // guard "work" for the wrong reason during development: the spawn failed with
  // ENOENT, the null status was read as a failure, and it looked like the guard
  // had caught a zero-work run it never actually observed.
  const local = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? `${runner.bin}.cmd` : runner.bin)
  const command = existsSync(local) ? local : runner.bin

  const result = spawnSync(command, [...rest, ...runner.extraArgs(reportPath)], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...(runner.env ? runner.env(reportPath) : {}) },
  })

  if (result.error) {
    console.error(`\n::error::assert-tests-ran could not start ${kind} (${command}): ${result.error.message}`)
    process.exit(2)
  }

  let executed = null
  let flaky = null
  if (existsSync(reportPath)) {
    try {
      const report = JSON.parse(readFileSync(reportPath, 'utf8'))
      executed = runner.parse(report)
      if (kind === 'playwright') flaky = flakyFromPlaywright(report)
    } catch {
      executed = null
    }
  }

  // A failing run is already loud — let its own exit code through unchanged, so
  // this guard never masks or restates a real failure.
  if (result.status !== 0) process.exit(result.status ?? 1)

  if (executed === null) {
    console.error(
      `\n::error::${kind} reported success but produced no readable test report ` +
      `(${path.relative(ROOT, reportPath)}). Treating that as zero work, because a run ` +
      'that cannot prove it executed anything must not be reported as green.',
    )
    process.exit(1)
  }
  if (executed === 0) {
    console.error(
      `\n::error::${kind} exited 0 having executed 0 tests. A green exit code must mean ` +
      'the work ran and passed, never that the work did not run. Check the filter, the ' +
      'test paths, and whether the harness aborted before collecting anything.',
    )
    process.exit(1)
  }

  // Always report flakiness, even when it is tolerated — the failure mode this
  // closes is that nobody notices the suite degrading.
  if (flaky?.length) {
    console.error(`\nassert-tests-ran: ${flaky.length} flaky test(s) — passed only on retry:`)
    for (const title of flaky) console.error(`  · ${title}`)
    if (failOnFlaky) {
      console.error(
        '\n::error::A test that passes only on retry is not trustworthy. Playwright exits 0 for ' +
        'these and reports them on a line separate from "failed", so a flaky suite is green to ' +
        'every automated reader. Fix the nondeterminism, or quarantine the test explicitly — do ' +
        'not let the retry hide it.',
      )
      process.exit(1)
    }
  }

  console.log(`\nassert-tests-ran: ${kind} executed ${executed} test(s)${flaky?.length ? `, ${flaky.length} flaky` : ''}.`)
  process.exit(0)
}

// Importable for unit tests; only runs the child process when invoked directly.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
