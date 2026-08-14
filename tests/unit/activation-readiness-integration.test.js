import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import * as agent from '@/modules/agent'
import * as lineOperator from '@/modules/agent/line-operator'
import * as knowledge from '@/modules/knowledge'

// @req FR-053, FR-054, FR-055 — readiness and controlled activation tools use governed public surfaces.
// @spec SDD-027, NFR-013, BR-014, SDD-028, SEC-011, SEC-012 — public exports preserve the approved operator boundary.
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

  it('keeps FR-055 off the generic agent surface and exposes it only through the operator port', () => {
    expect(agent).not.toHaveProperty('createLineBindingActivationService')
    expect(agent).not.toHaveProperty('adaptZuriCliCanaryReceiptFile')
    expect(lineOperator.parseLineActivationInput).toBeTypeOf('function')
    expect(lineOperator.parseLineRollbackInput).toBeTypeOf('function')
    expect(lineOperator.parseLineCanaryReceipt).toBeTypeOf('function')
    expect(lineOperator.createLineBindingActivationService).toBeTypeOf('function')
    expect(lineOperator.parseZuriCliTransportArtifact).toBeTypeOf('function')
    expect(lineOperator.adaptZuriCliCanaryReceiptFile).toBeTypeOf('function')
  })

  it('loads the dedicated operator port through direct Node ESM resolution', () => {
    const moduleUrl = new URL('../../src/modules/agent/line-operator.js', import.meta.url).href
    const output = execFileSync(process.execPath, [
      '--input-type=module',
      '--eval',
      `await import(${JSON.stringify(moduleUrl)}); console.log('LINE_OPERATOR_IMPORT_OK')`,
    ], { encoding: 'utf8' })
    expect(output.trim()).toBe('LINE_OPERATOR_IMPORT_OK')
  })

  it('registers one direct operator command without adding a send surface', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

    expect(pkg.scripts['phase1:line-binding']).toBe('node scripts/manage-line-binding.mjs')
    expect(Object.keys(pkg.scripts).join(' ')).not.toMatch(/line:send/)
    expect(pkg.devDependencies.ajv).toBe('8.20.0')
    expect(pkg.devDependencies['ajv-formats']).toBe('3.0.1')
  })
})
