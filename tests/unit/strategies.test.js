import { describe, it, expect } from 'vitest'
import {
  taskWeight,
  recordValidation,
  weightedPipeline,
  kpiAttainment,
  milestoneReadiness,
  slaScore,
  expansionReadiness,
  calculateWorkstreamProgress,
} from '@/modules/project-manager/progress/strategies'

describe('TASK_WEIGHT', () => {
  it('returns 0 with no items and warns', () => {
    const r = taskWeight({ items: [] })
    expect(r.percent).toBe(0)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('computes completed/planned weight', () => {
    const r = taskWeight({
      items: [
        { status: 'DONE', weight: 3, subtype: 'TASK' },
        { status: 'IN_PROGRESS', weight: 5, subtype: 'TASK' },
        { status: 'DONE', weight: 2, subtype: 'TASK' },
      ],
    })
    expect(r.percent).toBe(50)
    expect(r.evidence.completedWeight).toBe(5)
    expect(r.evidence.plannedWeight).toBe(10)
  })

  it('excludes cancelled items from denominator', () => {
    const r = taskWeight({
      items: [
        { status: 'DONE', weight: 1, subtype: 'TASK' },
        { status: 'CANCELLED', weight: 99, subtype: 'TASK' },
      ],
    })
    expect(r.percent).toBe(100)
  })

  it('handles invalid denominator (all zero weights)', () => {
    const r = taskWeight({ items: [{ status: 'DONE', weight: 0, subtype: 'TASK' }] })
    expect(r.percent).toBe(0)
    expect(r.warnings.some((w) => w.includes('Planned weight is 0'))).toBe(true)
  })

  it('caps at 99 when required gate open at 100%', () => {
    const r = taskWeight({
      items: [{ status: 'DONE', weight: 1, subtype: 'TASK' }],
      gates: [{ required: true, status: 'OPEN' }],
    })
    expect(r.percent).toBe(99)
  })

  it('reaches 100 when gates passed', () => {
    const r = taskWeight({
      items: [{ status: 'DONE', weight: 1, subtype: 'TASK' }],
      gates: [{ required: true, status: 'PASSED' }],
    })
    expect(r.percent).toBe(100)
  })
})

describe('RECORD_VALIDATION', () => {
  it('aggregates validated/total across datasets', () => {
    const r = recordValidation({
      items: [
        { status: 'IN_PROGRESS', metrics: { recordsTotal: 100, validated: 50 } },
        { status: 'IN_PROGRESS', metrics: { recordsTotal: 100, validated: 90 } },
      ],
    })
    expect(r.percent).toBe(70)
    expect(r.evidence.recordsTotal).toBe(200)
  })

  it('warns on missing metrics', () => {
    const r = recordValidation({ items: [{ status: 'PLANNED', metrics: {} }] })
    expect(r.percent).toBe(0)
    expect(r.warnings.some((w) => w.includes('missing recordsTotal'))).toBe(true)
  })

  it('returns 0 with no items', () => {
    expect(recordValidation({ items: [] }).percent).toBe(0)
  })

  it('reaches 100 when all validated', () => {
    const r = recordValidation({
      items: [{ status: 'DONE', metrics: { recordsTotal: 10, validated: 10 } }],
    })
    expect(r.percent).toBe(100)
  })
})

describe('WEIGHTED_PIPELINE', () => {
  it('computes weighted value over target', () => {
    const r = weightedPipeline({
      items: [
        { status: 'DONE', subtype: 'DEAL', numericValue: 100, probability: 1 },
        { status: 'IN_PROGRESS', subtype: 'DEAL', numericValue: 200, probability: 0.5 },
      ],
      viewConfig: { revenueTarget: 400 },
    })
    // (100 won + 200*0.5) / 400 = 50%
    expect(r.percent).toBe(50)
    expect(r.evidence.wonRevenue).toBe(100)
    expect(r.evidence.weightedValue).toBe(200)
  })

  it('falls back to total pipeline value without a target', () => {
    const r = weightedPipeline({
      items: [{ status: 'IN_PROGRESS', subtype: 'DEAL', numericValue: 100, probability: 0.5 }],
      viewConfig: {},
    })
    expect(r.percent).toBe(50)
    expect(r.warnings.some((w) => w.includes('revenueTarget'))).toBe(true)
  })

  it('warns on missing probability', () => {
    const r = weightedPipeline({
      items: [{ status: 'IN_PROGRESS', subtype: 'DEAL', code: 'D1', numericValue: 100 }],
      viewConfig: { revenueTarget: 100 },
    })
    expect(r.percent).toBe(0)
    expect(r.warnings.some((w) => w.includes('probability'))).toBe(true)
  })

  it('clamps above-target performance to 100', () => {
    const r = weightedPipeline({
      items: [{ status: 'DONE', subtype: 'DEAL', numericValue: 500 }],
      viewConfig: { revenueTarget: 100 },
    })
    expect(r.percent).toBe(100)
  })
})

describe('KPI_ATTAINMENT', () => {
  it('returns 0 with no configured KPIs', () => {
    const r = kpiAttainment({ items: [], viewConfig: {} })
    expect(r.percent).toBe(0)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('weights KPI attainment', () => {
    const r = kpiAttainment({
      items: [
        { status: 'DONE', metrics: { leads: 50, revenue: 100 } },
        { status: 'IN_PROGRESS', metrics: { leads: 50, revenue: 0 } },
      ],
      viewConfig: {
        kpis: [
          { key: 'leads', target: 100, weight: 1 }, // attainment 1
          { key: 'revenue', target: 200, weight: 3 }, // attainment 0.5
        ],
      },
    })
    // (1*1 + 0.5*3) / 4 = 0.625
    expect(r.percent).toBe(62.5)
  })

  it('inverts lower-is-better KPIs', () => {
    const r = kpiAttainment({
      items: [{ status: 'DONE', metrics: { cpa: 100 } }],
      viewConfig: { kpis: [{ key: 'cpa', target: 100, weight: 1, direction: 'down' }] },
    })
    expect(r.percent).toBe(100) // at target = full credit
  })
})

describe('MILESTONE_READINESS', () => {
  it('computes weighted milestone completion', () => {
    const r = milestoneReadiness({
      milestones: [
        { status: 'DONE', weight: 2 },
        { status: 'PLANNED', weight: 2 },
      ],
      gates: [],
    })
    expect(r.percent).toBe(50)
  })

  it('caps at 99 with open required gates', () => {
    const r = milestoneReadiness({
      milestones: [{ status: 'DONE', weight: 1 }],
      gates: [{ required: true, status: 'OPEN' }],
    })
    expect(r.percent).toBe(99)
  })

  it('warns on blocked gates', () => {
    const r = milestoneReadiness({
      milestones: [{ status: 'DONE', weight: 1 }, { status: 'PLANNED', weight: 1 }],
      gates: [{ required: true, status: 'BLOCKED' }],
    })
    expect(r.warnings.some((w) => w.includes('BLOCKED'))).toBe(true)
  })

  it('handles zero milestones', () => {
    expect(milestoneReadiness({ milestones: [], gates: [] }).percent).toBe(0)
  })
})

describe('SLA_SCORE', () => {
  it('blends completion and SLA attainment', () => {
    const r = slaScore({
      items: [
        { status: 'DONE', metrics: { slaMet: 8, slaTotal: 10 } },
        { status: 'IN_PROGRESS', metrics: {} },
      ],
    })
    // completion 0.5, sla 0.8 → 65%
    expect(r.percent).toBe(65)
  })

  it('uses completion only when no SLA metrics', () => {
    const r = slaScore({ items: [{ status: 'DONE', metrics: {} }] })
    expect(r.percent).toBe(100)
    expect(r.warnings.some((w) => w.includes('SLA metrics'))).toBe(true)
  })

  it('returns 0 with no items', () => {
    expect(slaScore({ items: [] }).percent).toBe(0)
  })
})

describe('EXPANSION_READINESS', () => {
  it('computes weighted readiness across dimensions', () => {
    const r = expansionReadiness({
      items: [
        { status: 'DONE', weight: 2, metadata: { dimension: 'legal' } },
        { status: 'PLANNED', weight: 2, metadata: { dimension: 'hiring' } },
      ],
      gates: [],
    })
    expect(r.percent).toBe(50)
    expect(r.evidence.dimensions.length).toBe(2)
  })

  it('caps at 99 with open go-live gates', () => {
    const r = expansionReadiness({
      items: [{ status: 'DONE', weight: 1, metadata: {} }],
      gates: [{ required: true, status: 'OPEN' }],
    })
    expect(r.percent).toBe(99)
  })
})

describe('dispatcher', () => {
  it('warns for unknown strategy', () => {
    const r = calculateWorkstreamProgress('NOT_A_STRATEGY', { items: [] })
    expect(r.percent).toBe(0)
    expect(r.warnings[0]).toContain('Unknown progress strategy')
  })
})
