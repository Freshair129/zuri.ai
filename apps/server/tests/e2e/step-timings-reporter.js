const { mkdirSync, writeFileSync } = require('node:fs')
const path = require('node:path')

// @req NFR-008 — a fixed `expect` budget is a claim about how long the product
//   takes to answer; this records what it actually took, so the budget can be
//   set from a measurement instead of an argument.
// @tested tests/unit/e2e-step-timings-reporter.test.js
//
// Playwright's JSON reporter keeps only `test.step` steps, so the duration of
// every `expect(...)` and every `page.goto` / `click` is visible nowhere after
// a run. This reporter writes them all — one row per step, with the test, the
// retry, and whether the step failed — to the file named by
// `E2E_STEP_TIMINGS`. `scripts/assert-tests-ran.mjs` adds it to the reporter
// list only when that variable is set, so an ordinary run is unchanged.
//
// Reading the file: a step that *failed* has `duration` ≈ the budget it hit,
// which says nothing about how long the product needed. The question "would a
// smaller budget have been enough?" is answered by the passed steps only:
// their `duration` is the real wait.

class StepTimingsReporter {
  constructor(options = {}) {
    this.file = options.outputFile || process.env.E2E_STEP_TIMINGS
    this.rows = []
  }

  onStepEnd(test, result, step) {
    if (step.category !== 'expect' && step.category !== 'pw:api') return
    this.rows.push({
      file: path.relative(process.cwd(), test.location.file).replace(/\\/g, '/'),
      test: test.titlePath().slice(1).join(' › '),
      retry: result.retry,
      category: step.category,
      title: step.title,
      duration: step.duration,
      failed: Boolean(step.error),
    })
  }

  onEnd(result) {
    if (!this.file) return
    mkdirSync(path.dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify({ status: result.status, rows: this.rows }))
  }

  printsToStdio() {
    return false
  }
}

module.exports = StepTimingsReporter
