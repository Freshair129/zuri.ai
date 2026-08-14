import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as agent from '@/modules/agent'
import * as knowledge from '@/modules/knowledge'

// @req FR-053, FR-054 — activation-readiness tools are reachable through governed public surfaces.
// @spec SDD-027, SEC-011 — tracked commands remain evaluation/probe/dry-run only.
// @tested tests/unit/activation-readiness-integration.test.js

describe('activation readiness integration', () => {
  it('exports the approved evaluator and dry-run canary contracts', () => {
    expect(agent.evaluateGoldenQuestions).toBeTypeOf('function')
    expect(agent.validateGoldenQuestionCorpus).toBeTypeOf('function')
    expect(agent.createCanaryPreflightPlan).toBeTypeOf('function')
    expect(agent.ACTIVATION_RECEIPT_STATES).toContain('DISPLAYED_UNKNOWN')
  })

  it('exports the runtime isolation probe through the knowledge module', () => {
    expect(knowledge.runRuntimeIsolationProbe).toBeTypeOf('function')
    expect(knowledge.parseRuntimeIsolationEnvironment).toBeTypeOf('function')
  })

  it('registers only readiness commands, not activation or LINE-send commands', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

    expect(pkg.scripts['phase1:evaluate']).toBe('node scripts/evaluate-phase1-golden.mjs')
    expect(pkg.scripts['phase1:isolation:verify']).toBe('node scripts/verify-line-runtime-isolation.mjs')
    expect(pkg.scripts['phase1:canary:plan']).toBe('node scripts/plan-line-canary.mjs')
    expect(Object.keys(pkg.scripts).join(' ')).not.toMatch(/phase1:activate|line:send/)
  })
})
