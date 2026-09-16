import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

// @req NFR-008 — the `expect` budget is set from what steps actually took,
//   and this is the thing that records it.
// @tested tests/unit/e2e-step-timings-reporter.test.js

const require = createRequire(import.meta.url)
const StepTimingsReporter = require('../e2e/step-timings-reporter.js')

const dir = mkdtempSync(path.join(tmpdir(), 'step-timings-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const fakeTest = {
  location: { file: path.join(process.cwd(), 'tests', 'e2e', 'smoke.spec.js') },
  titlePath: () => ['', 'universal routes', 'dependencies view renders edges'],
}

describe('the step-timings reporter', () => {
  it('records expect and pw:api steps with their real duration, and nothing else', () => {
    const file = path.join(dir, 'timings.json')
    const reporter = new StepTimingsReporter({ outputFile: file })
    reporter.onStepEnd(fakeTest, { retry: 0 }, { category: 'expect', title: 'expect.toBeVisible', duration: 812 })
    reporter.onStepEnd(fakeTest, { retry: 0 }, { category: 'pw:api', title: 'page.goto', duration: 1500 })
    reporter.onStepEnd(fakeTest, { retry: 0 }, { category: 'test.step', title: 'a named step', duration: 99 })
    reporter.onStepEnd(fakeTest, { retry: 1 }, { category: 'expect', title: 'expect.toHaveURL', duration: 30000, error: { message: 'Timed out' } })
    reporter.onEnd({ status: 'passed' })

    const written = JSON.parse(readFileSync(file, 'utf8'))
    expect(written.status).toBe('passed')
    expect(written.rows).toEqual([
      { file: 'tests/e2e/smoke.spec.js', test: 'universal routes › dependencies view renders edges', retry: 0, category: 'expect', title: 'expect.toBeVisible', duration: 812, failed: false },
      { file: 'tests/e2e/smoke.spec.js', test: 'universal routes › dependencies view renders edges', retry: 0, category: 'pw:api', title: 'page.goto', duration: 1500, failed: false },
      { file: 'tests/e2e/smoke.spec.js', test: 'universal routes › dependencies view renders edges', retry: 1, category: 'expect', title: 'expect.toHaveURL', duration: 30000, failed: true },
    ])
  })

  it('writes nothing when no output file is named, so an ordinary run is unchanged', () => {
    const previous = process.env.E2E_STEP_TIMINGS
    delete process.env.E2E_STEP_TIMINGS
    try {
      const reporter = new StepTimingsReporter()
      reporter.onStepEnd(fakeTest, { retry: 0 }, { category: 'expect', title: 'expect.toBeVisible', duration: 1 })
      expect(() => reporter.onEnd({ status: 'passed' })).not.toThrow()
      expect(existsSync(path.join(dir, 'undefined'))).toBe(false)
    } finally {
      if (previous !== undefined) process.env.E2E_STEP_TIMINGS = previous
    }
  })

  it('is added to the runner only when E2E_STEP_TIMINGS is set', () => {
    const source = readFileSync('scripts/assert-tests-ran.mjs', 'utf8')
    expect(source).toContain("process.env.E2E_STEP_TIMINGS ? ['./tests/e2e/step-timings-reporter.js'] : []")
    expect(source).toContain("['list', 'json'")
  })
})
