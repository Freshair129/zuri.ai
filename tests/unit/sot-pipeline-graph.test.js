import { describe, expect, it } from 'vitest'

import { parseSotPipelinePlan, deriveSotPlanStatus } from '@/modules/integration/application/sot-plan'
import { buildSotPipelineGraph } from '@/modules/integration/application/sot-pipeline-graph'

// @req FR-097 — the graph is a pure projection of the plan + derived status
// into the FR-040 data shape, layered by topological depth.
// @tested tests/unit/sot-pipeline-graph.test.js

const PLAN = parseSotPipelinePlan({
  planId: 'SOT-PIPELINE-PLAN', version: '1.0.0', titleTh: 'x',
  phases: [
    { phaseId: 'P0', title: 'a', titleTh: 'ก', summaryTh: 's', kind: 'AUTOMATED', dependsOn: [], pipelineDefinitionIds: ['DPL-A'] },
    { phaseId: 'P1', title: 'b', titleTh: 'ข', summaryTh: 's', kind: 'HUMAN_GATE', dependsOn: ['P0'], pipelineDefinitionIds: [] },
    { phaseId: 'P2', title: 'c', titleTh: 'ค', summaryTh: 's', kind: 'AUTOMATED', dependsOn: ['P1'], pipelineDefinitionIds: [] },
  ],
  context: {
    nodes: [
      { id: 'src-x', type: 'source', title: 'X' },
      { id: 'store-y', type: 'store', title: 'Y' },
    ],
    edges: [
      { id: 'e1', source: 'src-x', target: 'P0' },
      { id: 'e2', source: 'P2', target: 'store-y' },
    ],
  },
})

describe('FR-097 sot pipeline graph', () => {
  const withStatus = deriveSotPlanStatus(PLAN, new Map([['DPL-A', { status: 'SUCCEEDED' }]]), new Map([['P1', 2]]))
  const graph = buildSotPipelineGraph(PLAN, withStatus)

  it('emits the dependency-map data shape', () => {
    expect(graph.version).toBe(1)
    for (const node of graph.nodes) {
      expect(node).toMatchObject({ id: expect.any(String), type: expect.any(String), title: expect.any(String), status: expect.any(String) })
    }
    for (const edge of graph.edges) {
      expect(edge).toMatchObject({ id: expect.any(String), source: expect.any(String), target: expect.any(String) })
    }
  })

  it('carries derived status, human-gate typing and pending badges', () => {
    const p0 = graph.nodes.find((n) => n.id === 'P0')
    const p1 = graph.nodes.find((n) => n.id === 'P1')
    expect(p0.status).toBe('done')
    expect(p1.type).toBe('human-gate')
    expect(p1.status).toBe('blocked')
    expect(p1.pendingDecisions).toBe(2)
  })

  it('layers by topological depth with sources before phases and stores after', () => {
    const depth = Object.fromEntries(graph.nodes.map((n) => [n.id, n.depth]))
    expect(depth['src-x']).toBe(0)
    expect(depth['P0']).toBe(1)
    expect(depth['P1']).toBe(2)
    expect(depth['P2']).toBe(3)
    expect(depth['store-y']).toBeGreaterThan(depth['P2'])
  })

  it('includes one edge per dependsOn plus the declared context edges', () => {
    const ids = graph.edges.map((e) => e.id).sort()
    expect(ids).toEqual(['dep-P0-P1', 'dep-P1-P2', 'e1', 'e2'])
  })
})
