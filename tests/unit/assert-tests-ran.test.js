import { describe, it, expect } from 'vitest'
import { executedFromVitest, executedFromPlaywright, flakyFromPlaywright } from '../../scripts/assert-tests-ran.mjs'

// @spec .brain/rca/2026-08-17-governance-did-not-govern.md — a green exit code
// must mean the work ran and passed, never that the work did not run.
// @tested tests/unit/assert-tests-ran.test.js
//
// These pin the counting rule, which is the whole guard: skipped is not work,
// and an unreadable report is not proof of work.

describe('executedFromVitest', () => {
  it('counts passed and failed, never skipped', () => {
    expect(executedFromVitest({ numPassedTests: 5, numFailedTests: 2, numPendingTests: 99 })).toBe(7)
  })

  it('returns 0 for the real zero-work shape — every test skipped by a filter', () => {
    // This is exactly what `vitest run -t "NO_MATCH"` produces, and what used to
    // exit 0.
    expect(executedFromVitest({ numPassedTests: 0, numFailedTests: 0, numPendingTests: 792 })).toBe(0)
  })

  it('returns null when the report cannot be trusted, rather than assuming zero or many', () => {
    expect(executedFromVitest(null)).toBeNull()
    expect(executedFromVitest({})).toBeNull()
    expect(executedFromVitest({ numPassedTests: 'lots', numFailedTests: 0 })).toBeNull()
  })
})

describe('executedFromPlaywright', () => {
  const suite = (specs, suites = []) => ({ specs, suites })
  const spec = (...statuses) => ({ tests: [{ results: statuses.map((status) => ({ status })) }] })

  it('counts every non-skipped result, including retries', () => {
    const report = { suites: [suite([spec('failed', 'passed'), spec('passed')])] }
    expect(executedFromPlaywright(report)).toBe(3)
  })

  it('does not count skipped tests as work', () => {
    expect(executedFromPlaywright({ suites: [suite([spec('skipped'), spec('skipped')])] })).toBe(0)
  })

  it('descends into nested suites', () => {
    const report = { suites: [suite([spec('passed')], [suite([spec('passed')])])] }
    expect(executedFromPlaywright(report)).toBe(2)
  })

  it('returns 0 for a run that collected suites but executed nothing', () => {
    expect(executedFromPlaywright({ suites: [] })).toBe(0)
  })

  it('returns null when there is no report shape at all', () => {
    expect(executedFromPlaywright(null)).toBeNull()
    expect(executedFromPlaywright({})).toBeNull()
  })
})

describe('flakyFromPlaywright', () => {
  // The status values here are taken from a real report produced by planting a
  // test that fails on its first attempt and passes on retry: Playwright marks
  // the test `flaky`, its results are ["failed","passed"], and it exits 0.
  const flakyTest = { status: 'flaky', results: [{ status: 'failed' }, { status: 'passed' }] }
  const goodTest = { status: 'expected', results: [{ status: 'passed' }] }

  it('finds a test that passed only on retry', () => {
    const report = { suites: [{ title: 'file.spec.js', specs: [{ title: 'does a thing', tests: [flakyTest] }], suites: [] }] }
    expect(flakyFromPlaywright(report)).toEqual(['file.spec.js › does a thing'])
  })

  it('reports nothing for a clean run', () => {
    const report = { suites: [{ title: 'f', specs: [{ title: 't', tests: [goodTest] }], suites: [] }] }
    expect(flakyFromPlaywright(report)).toEqual([])
  })

  it('descends into nested suites and builds a readable trail', () => {
    const report = {
      suites: [{
        title: 'file.spec.js',
        specs: [],
        suites: [{ title: 'a describe', specs: [{ title: 'inner', tests: [flakyTest] }], suites: [] }],
      }],
    }
    expect(flakyFromPlaywright(report)).toEqual(['file.spec.js › a describe › inner'])
  })

  it('returns null for an unusable report, so the caller can tell it apart from "none"', () => {
    expect(flakyFromPlaywright(null)).toBeNull()
    expect(flakyFromPlaywright({})).toBeNull()
  })
})
