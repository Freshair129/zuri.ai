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
