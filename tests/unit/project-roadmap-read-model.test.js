// @req FR-068 — Human-visible Project Execution Roadmap includes authorized
// Business Goal projections without creating a second Goal owner.
// @spec SDD-039, ADR-028, FR-070
// @tested tests/unit/project-roadmap-read-model.test.js
import { describe, expect, it } from 'vitest'
import {
  buildProjectRoadmapReadModel,
  zProjectRoadmapResponse,
} from '@/modules/project-manager/application/project-roadmap-read-model'

const DATE = '2026-08-18T00:00:00.000Z'

function source() {
  return {
    project: {
      id: 'project-a',
      code: 'PRJ-A',
      name: 'Project A',
      description: 'Business execution outcome',
      businessId: 'business-a',
      status: 'ACTIVE',
      startAt: null,
      targetAt: DATE,
    },
    goals: [{
      id: 'goal-a',
      businessId: 'business-a',
      code: 'GOAL-A',
      title: 'Increase qualified pipeline',
      description: 'A real Business Goal projection',
      status: 'ACTIVE',
      priority: 'HIGH',
      progress: 42,
      startAt: null,
      targetAt: DATE,
    }],
    workstreams: [{
      id: 'workstream-a',
      code: 'WST-A',
      projectId: 'project-a',
      name: 'Sales execution',
      executionMode: 'B2B_SALES',
      progressStrategy: 'WEIGHTED_PIPELINE',
      progressWeight: 2,
      status: 'ACTIVE',
      viewConfigJson: '{}',
      createdAt: DATE,
      updatedAt: DATE,
      containers: [{
        id: 'container-a',
        code: 'PIPE-A',
        workstreamId: 'workstream-a',
        parentId: null,
        subtype: 'SALES_PIPELINE',
        title: 'Enterprise pipeline',
        status: 'ACTIVE',
        startAt: null,
        targetAt: DATE,
        metadataJson: '{}',
        createdAt: DATE,
        updatedAt: DATE,
      }],
      items: [{
        id: 'item-a',
        code: 'DEAL-A',
        workstreamId: 'workstream-a',
        containerId: 'container-a',
        subtype: 'DEAL',
        title: 'Close enterprise account',
        status: 'DONE',
        assigneeRef: 'person-a',
        weight: 1,
        numericValue: 100000,
        probability: 1,
        metricDataJson: '{"wonRevenue":100000,"weightedValue":100000}',
        metadataJson: '{"internal":"must not leak"}',
        startAt: null,
        targetAt: DATE,
        deletedAt: null,
        createdAt: DATE,
        updatedAt: DATE,
      }],
      milestones: [],
      gates: [],
    }],
    dependencyGraph: { version: '1.0', nodes: [], edges: [] },
    roster: [{
      person: { id: 'person-a', code: 'PER-A', displayName: 'Person A' },
      role: 'OWNER',
    }],
    readScope: 'BUSINESS',
  }
}

describe('Project Execution Roadmap read model', () => {
  it('projects linked Business Goals and the existing execution hierarchy', () => {
    const result = buildProjectRoadmapReadModel(source())

    expect(zProjectRoadmapResponse.parse(result)).toEqual(result)
    expect(result.readModel).toBe('EXECUTION_ROADMAP')
    expect(result.project.goalIds).toEqual(['goal-a'])
    expect(result.goals).toEqual([expect.objectContaining({
      id: 'goal-a',
      code: 'GOAL-A',
      title: 'Increase qualified pipeline',
      progress: 42,
    })])
    expect(result.plans[0]).toEqual(expect.objectContaining({
      planId: 'workstream-a',
      planCode: 'WST-A',
      executionModeId: 'B2B_SALES',
    }))
    expect(result.containers[0]).toEqual(expect.objectContaining({
      planId: 'workstream-a',
      containerId: 'container-a',
      typedId: { key: 'pipelineId', value: 'container-a' },
    }))
    expect(result.items[0]).toEqual(expect.objectContaining({
      workItemId: 'item-a',
      assignee: { status: 'READY', personId: 'person-a', displayName: 'Person A', role: 'OWNER' },
    }))
    expect(result.items[0]).not.toHaveProperty('metadataJson')
    expect(result.risks).toEqual({ status: 'UNAVAILABLE', items: [], reasonCode: 'RISK_MODEL_NOT_AVAILABLE' })
  })

  it('keeps an unlinked Goal state explicit and derives progress from evidence', () => {
    const input = source()
    input.goals = []
    const result = buildProjectRoadmapReadModel(input)

    expect(result.project.goalIds).toEqual([])
    expect(result.goals).toEqual([])
    expect(result.summary.completed).toBe(1)
    expect(result.summary.total).toBe(1)
    expect(result.closure.decision).toEqual({ status: 'UNAVAILABLE', reasonCode: 'CLOSURE_DECISION_NOT_MODELED' })
  })
})
