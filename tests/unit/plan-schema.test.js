import { describe, it, expect } from 'vitest'
import { zPlanEnvelope, validatePlanSemantics } from '@/modules/project-manager/import/plan-schema'

const validPlan = {
  schemaVersion: '1.0',
  project: { code: 'PRJ-T', name: 'Test' },
  workstreams: [
    {
      code: 'WST-A',
      name: 'A',
      executionMode: 'SOFTWARE_SPRINT',
      progressStrategy: 'TASK_WEIGHT',
      containers: [{ code: 'C1', subtype: 'SPRINT', title: 'Sprint 1' }],
      items: [{ code: 'I1', containerCode: 'C1', subtype: 'TASK', title: 'Task 1' }],
    },
  ],
}

describe('plan envelope schema', () => {
  it('accepts a valid plan', () => {
    expect(zPlanEnvelope.safeParse(validPlan).success).toBe(true)
  })

  it('accepts the project target date used by the human intake wizard', () => {
    const plan = structuredClone(validPlan)
    plan.project.targetAt = '2026-12-20'
    expect(zPlanEnvelope.safeParse(plan).success).toBe(true)
  })

  it('rejects unknown execution modes', () => {
    const bad = structuredClone(validPlan)
    bad.workstreams[0].executionMode = 'KANBAN_FLOW'
    const result = zPlanEnvelope.safeParse(bad)
    expect(result.success).toBe(false)
  })

  it('rejects unknown progress strategies', () => {
    const bad = structuredClone(validPlan)
    bad.workstreams[0].progressStrategy = 'VELOCITY'
    expect(zPlanEnvelope.safeParse(bad).success).toBe(false)
  })

  it('rejects wrong schema version', () => {
    const bad = { ...structuredClone(validPlan), schemaVersion: '2.0' }
    expect(zPlanEnvelope.safeParse(bad).success).toBe(false)
  })

  it('rejects additional properties', () => {
    const bad = { ...structuredClone(validPlan), evil: 'payload' }
    expect(zPlanEnvelope.safeParse(bad).success).toBe(false)
  })

  it('rejects out-of-range probability', () => {
    const bad = structuredClone(validPlan)
    bad.workstreams[0].items[0].probability = 1.5
    expect(zPlanEnvelope.safeParse(bad).success).toBe(false)
  })

  it('rejects a container subtype from a different execution mode', () => {
    const bad = structuredClone(validPlan)
    bad.workstreams[0].executionMode = 'DATA_MIGRATION'
    bad.workstreams[0].progressStrategy = 'RECORD_VALIDATION'
    bad.workstreams[0].containers[0].subtype = 'SPRINT'
    bad.workstreams[0].items[0].subtype = 'TASK'
    const errors = validatePlanSemantics(zPlanEnvelope.parse(bad))
    expect(errors.some((e) => e.includes('DATA_MIGRATION') && e.includes('SPRINT'))).toBe(true)
  })

  it('rejects mode-specific metric keys from a different execution mode', () => {
    const bad = structuredClone(validPlan)
    bad.workstreams[0].items[0].metrics = { recordsTotal: 100, processed: 90 }
    const errors = validatePlanSemantics(zPlanEnvelope.parse(bad))
    expect(errors.some((e) => e.includes('SOFTWARE_SPRINT') && e.includes('recordsTotal'))).toBe(true)
  })
})

describe('plan semantics', () => {
  it('passes for the valid plan', () => {
    expect(validatePlanSemantics(zPlanEnvelope.parse(validPlan))).toEqual([])
  })

  it('detects dangling container reference', () => {
    const bad = structuredClone(validPlan)
    bad.workstreams[0].items[0].containerCode = 'NOPE'
    const errors = validatePlanSemantics(zPlanEnvelope.parse(bad))
    expect(errors.some((e) => e.includes('unknown container'))).toBe(true)
  })

  it('detects duplicate codes', () => {
    const bad = structuredClone(validPlan)
    bad.workstreams.push({ ...structuredClone(bad.workstreams[0]), code: 'WST-A', containers: [], items: [] })
    const errors = validatePlanSemantics(zPlanEnvelope.parse(bad))
    expect(errors.some((e) => e.includes('Duplicate code'))).toBe(true)
  })

  it('detects dangling dependency refs', () => {
    const bad = structuredClone(validPlan)
    bad.dependencies = [{ sourceRef: 'GHOST', targetRef: 'WST-A', type: 'BLOCKS' }]
    const errors = validatePlanSemantics(zPlanEnvelope.parse(bad))
    expect(errors.some((e) => e.includes('sourceRef "GHOST"'))).toBe(true)
  })
})

// @req FR-019 — envelope 1.1 carries the customer's own core ids.
describe('external refs in the envelope', () => {
  const withRefs = () => {
    const plan = structuredClone(validPlan)
    plan.schemaVersion = '1.1'
    plan.project.externalRefs = [{ system: 'SAP', id: 'PRJ-1' }]
    plan.workstreams[0].items[0].externalRefs = [{ system: 'SAP', id: 'TASK-1', labelAs: false }]
    return plan
  }

  it('accepts refs on every keyable entity', () => {
    const parsed = zPlanEnvelope.safeParse(withRefs())
    expect(parsed.success).toBe(true)
    expect(validatePlanSemantics(parsed.data)).toEqual([])
  })

  it('still accepts a 1.0 envelope with no refs at all', () => {
    expect(zPlanEnvelope.safeParse(validPlan).success).toBe(true)
  })

  it('rejects a ref missing its system or id', () => {
    const bad = withRefs()
    bad.project.externalRefs = [{ id: 'PRJ-1' }]
    expect(zPlanEnvelope.safeParse(bad).success).toBe(false)
    const empty = withRefs()
    empty.project.externalRefs = [{ system: 'SAP', id: '' }]
    expect(zPlanEnvelope.safeParse(empty).success).toBe(false)
  })

  it('rejects unknown fields inside a ref (strict contract)', () => {
    const bad = withRefs()
    bad.project.externalRefs = [{ system: 'SAP', id: 'PRJ-1', primaryKey: true }]
    expect(zPlanEnvelope.safeParse(bad).success).toBe(false)
  })

  it('flags the same external id claimed by two entities', () => {
    const bad = withRefs()
    bad.workstreams[0].externalRefs = [{ system: 'SAP', id: 'PRJ-1' }]
    const errors = validatePlanSemantics(zPlanEnvelope.parse(bad))
    expect(errors.some((e) => e.includes('claimed twice'))).toBe(true)
  })

  it('rejects an unsupported schemaVersion', () => {
    const bad = withRefs()
    bad.schemaVersion = '2.0'
    expect(zPlanEnvelope.safeParse(bad).success).toBe(false)
  })
})
