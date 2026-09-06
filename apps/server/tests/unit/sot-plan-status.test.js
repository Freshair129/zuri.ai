import { describe, expect, it } from 'vitest'

import {
  deriveSotPhaseStatus,
  deriveSotPlanStatus,
  loadSotPipelinePlan,
  parseSotPipelinePlan,
  topologicalPhaseOrder,
} from '@/modules/integration/application/sot-plan'

// @req FR-099 — phase status is a pure derivation over run evidence and
// pending-decision counts; the committed plan file itself must parse.
// @tested tests/unit/sot-plan-status.test.js

const phase = (over = {}) => ({
  phaseId: 'P1',
  title: 'x', titleTh: 'x', summaryTh: 'x',
  kind: 'AUTOMATED',
  dependsOn: [],
  pipelineDefinitionIds: ['DPL-A'],
  ...over,
})

const plan = (phases) => ({
  planId: 'SOT-PIPELINE-PLAN', version: '1.0.0', titleTh: 'x',
  phases,
  context: { nodes: [], edges: [] },
})

describe('FR-099 sot plan — file and shape', () => {
  it('the committed contracts/sot-pipeline-plan.v1.json parses and orders P0 first', () => {
    const loaded = loadSotPipelinePlan()
    expect(loaded.phases.length).toBeGreaterThanOrEqual(11)
    expect(topologicalPhaseOrder(loaded)[0]).toBe('P0')
  })

  it('rejects an unknown dependsOn and a dependency cycle', () => {
    expect(() => parseSotPipelinePlan(plan([phase({ dependsOn: ['P9'] })]))).toThrow(/unknown phase/)
    expect(() => parseSotPipelinePlan(plan([
      phase({ phaseId: 'P1', dependsOn: ['P2'] }),
      phase({ phaseId: 'P2', dependsOn: ['P1'] }),
    ]))).toThrow(/cycle/)
  })

  it('rejects unknown fields (.strict envelope)', () => {
    expect(() => parseSotPipelinePlan({ ...plan([phase()]), extra: 1 })).toThrow()
  })
})

describe('FR-099 sot plan — status derivation', () => {
  const noPending = new Map()

  it('planned when no linked runs exist', () => {
    expect(deriveSotPhaseStatus(phase(), new Map(), noPending)).toBe('planned')
  })

  it('running when the newest linked run is QUEUED or RUNNING', () => {
    expect(deriveSotPhaseStatus(phase(), new Map([['DPL-A', { status: 'RUNNING' }]]), noPending)).toBe('running')
    expect(deriveSotPhaseStatus(phase(), new Map([['DPL-A', { status: 'QUEUED' }]]), noPending)).toBe('running')
  })

  it('blocked when the newest run FAILED, and blocked beats running', () => {
    const p = phase({ pipelineDefinitionIds: ['DPL-A', 'DPL-B'] })
    const runs = new Map([['DPL-A', { status: 'FAILED' }], ['DPL-B', { status: 'RUNNING' }]])
    expect(deriveSotPhaseStatus(p, runs, noPending)).toBe('blocked')
  })

  it('blocked when a required decision is PENDING even with no runs (human gate)', () => {
    const p = phase({ phaseId: 'P3', kind: 'HUMAN_GATE', pipelineDefinitionIds: [] })
    expect(deriveSotPhaseStatus(p, new Map(), new Map([['P3', 7]]))).toBe('blocked')
  })

  it('done only when every definition has a newest SUCCEEDED run and nothing is pending', () => {
    const p = phase({ pipelineDefinitionIds: ['DPL-A', 'DPL-B'] })
    const oneDone = new Map([['DPL-A', { status: 'SUCCEEDED' }]])
    const bothDone = new Map([['DPL-A', { status: 'SUCCEEDED' }], ['DPL-B', { status: 'SUCCEEDED' }]])
    expect(deriveSotPhaseStatus(p, oneDone, noPending)).toBe('planned')
    expect(deriveSotPhaseStatus(p, bothDone, noPending)).toBe('done')
    expect(deriveSotPhaseStatus(p, bothDone, new Map([['P1', 1]]))).toBe('blocked')
  })

  it('deriveSotPlanStatus returns phases in dependency order with pending counts attached', () => {
    const p = plan([
      phase({ phaseId: 'P2', dependsOn: ['P1'], pipelineDefinitionIds: [] }),
      phase({ phaseId: 'P1', pipelineDefinitionIds: [] }),
    ])
    const out = deriveSotPlanStatus(parseSotPipelinePlan(p), new Map(), new Map([['P2', 3]]))
    expect(out.map((x) => x.phaseId)).toEqual(['P1', 'P2'])
    expect(out[1].status).toBe('blocked')
    expect(out[1].pendingDecisions).toBe(3)
  })
})
