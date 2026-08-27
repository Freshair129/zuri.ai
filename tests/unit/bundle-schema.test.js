import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { zExecutionPlanBundle, validateBundleSemantics } from '@/modules/project-manager/import/bundle/bundle-schema'

// @req FR-108 — the runtime bundle validator mirrors the normative JSON Schema
// and the bundle-level semantics fail closed on every broken symbol.
// @spec ADR-049, SDD-056, BR-007

const samplePath = path.resolve(__dirname, '../../contracts/sample-execution-plan-bundle.json')
const sample = () => JSON.parse(readFileSync(samplePath, 'utf8'))

const parsedSample = () => {
  const parsed = zExecutionPlanBundle.safeParse(sample())
  expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [], null, 2)).toBe(true)
  return parsed.data
}

describe('zExecutionPlanBundle', () => {
  it('accepts the worked sample bundle from contracts/', () => {
    const bundle = parsedSample()
    expect(bundle.kind).toBe('EXECUTION_PLAN_BUNDLE')
    expect(bundle.projects).toHaveLength(2)
    expect(bundle.dependencies).toHaveLength(1)
  })

  it('is strict: an undeclared property anywhere is rejected, never ignored', () => {
    const bundle = sample()
    bundle.surprise = { run: 'rm -rf /' }
    expect(zExecutionPlanBundle.safeParse(bundle).success).toBe(false)

    const nested = sample()
    nested.projects[0].execute = 'curl http://evil'
    expect(zExecutionPlanBundle.safeParse(nested).success).toBe(false)
  })

  it('rejects a wrong kind, wrong schemaVersion, and empty projects', () => {
    expect(zExecutionPlanBundle.safeParse({ ...sample(), kind: 'PLAN_ENVELOPE' }).success).toBe(false)
    expect(zExecutionPlanBundle.safeParse({ ...sample(), schemaVersion: '2.0' }).success).toBe(false)
    expect(zExecutionPlanBundle.safeParse({ ...sample(), projects: [] }).success).toBe(false)
  })

  it('rejects a dependency relation outside the canonical dependency vocabulary', () => {
    const bundle = sample()
    bundle.dependencies[0].relation = 'MAKES_COFFEE_FOR'
    expect(zExecutionPlanBundle.safeParse(bundle).success).toBe(false)
  })

  it('validates each nested plan as a canonical PlanEnvelope', () => {
    const bundle = sample()
    bundle.projects[0].plan.workstreams[0].executionMode = 'NOT_A_MODE'
    expect(zExecutionPlanBundle.safeParse(bundle).success).toBe(false)
  })
})

describe('validateBundleSemantics', () => {
  it('accepts the sample bundle', () => {
    expect(validateBundleSemantics(parsedSample())).toEqual([])
  })

  it('fails closed on an unknown goalRef — a symbol is never guessed', () => {
    const bundle = parsedSample()
    bundle.projects[0].goalRefs = ['GOAL-DOES-NOT-EXIST']
    expect(validateBundleSemantics(bundle).join('\n')).toContain('unknown goalRef "GOAL-DOES-NOT-EXIST"')
  })

  it('fails closed on an unknown horizonRef', () => {
    const bundle = parsedSample()
    bundle.strategy.goals[0].horizonRef = 'H9'
    expect(validateBundleSemantics(bundle).join('\n')).toContain('unknown horizonRef "H9"')
  })

  it('rejects duplicate bundle-local symbols', () => {
    const bundle = parsedSample()
    bundle.projects[1].bundleProjectRef = bundle.projects[0].bundleProjectRef
    const errors = validateBundleSemantics(bundle).join('\n')
    expect(errors).toContain('Duplicate bundleProjectRef')
  })

  it('rejects two entries claiming one project code', () => {
    const bundle = parsedSample()
    bundle.projects[1].plan.project.code = bundle.projects[0].plan.project.code
    expect(validateBundleSemantics(bundle).join('\n')).toContain('same project code')
  })

  it('rejects horizons or goals without a roadmap to live on', () => {
    const bundle = parsedSample()
    delete bundle.strategy.roadmap
    expect(validateBundleSemantics(bundle).join('\n')).toContain('require strategy.roadmap')
  })

  it('rejects a dependency to a project the bundle does not carry, a self-dependency, and a cycle', () => {
    const missing = parsedSample()
    missing.dependencies[0].targetProjectRef = 'PROJECT-GONE'
    expect(validateBundleSemantics(missing).join('\n')).toContain('does not resolve to any bundle Project')

    const self = parsedSample()
    self.dependencies[0].targetProjectRef = self.dependencies[0].sourceProjectRef
    expect(validateBundleSemantics(self).join('\n')).toContain('cannot reference itself')

    const cyclic = parsedSample()
    cyclic.dependencies.push({
      sourceProjectRef: 'PROJECT-GKS',
      targetProjectRef: 'PROJECT-MSP',
      relation: 'BLOCKS',
    })
    expect(validateBundleSemantics(cyclic).join('\n')).toContain('cycle')
  })
})
