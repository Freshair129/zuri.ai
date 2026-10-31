import { describe, expect, it } from 'vitest'
import { buildOperationsWorkstreamViewModel } from '@/modules/project-manager/views/execution/operations-business-read-model'

describe('Operations Business read model', () => {
  it('uses the existing pure progress calculator and recorded PM dates without mutating the source graph', () => {
    const workstream = {
      id: 'ws-1',
      name: 'Daily operations',
      executionMode: 'OPERATIONS',
      status: 'ACTIVE',
      progressStrategy: 'SLA_SCORE',
      viewConfigJson: '{}',
      containers: [{ id: 'container-1', targetAt: '2026-11-15T00:00:00.000Z' }],
      items: [
        { id: 'item-1', status: 'DONE', metricDataJson: '{"slaMet":3,"slaTotal":4}', metadataJson: '{}' },
        { id: 'item-2', status: 'IN_PROGRESS', metricDataJson: '{"slaMet":0,"slaTotal":1}', metadataJson: '{}', targetAt: '2026-11-03T00:00:00.000Z' },
      ],
      milestones: [{ id: 'milestone-1', targetAt: '2026-11-08T00:00:00.000Z' }],
      gates: [],
      project: { id: 'project-1', code: 'P-1', name: 'Project One' },
    }
    const original = structuredClone(workstream)

    const model = buildOperationsWorkstreamViewModel(workstream)

    expect(model.progress.percent).toBe(55)
    expect(model.progress.evidence).toMatchObject({ strategy: 'SLA_SCORE', slaMet: 3, slaTotal: 5, itemCount: 2 })
    expect(model.earliestRecordedTargetAt.toISOString()).toBe('2026-11-03T00:00:00.000Z')
    expect(model.items).toHaveLength(2)
    expect(model.project).toEqual(workstream.project)
    expect(model.evidenceHref).toBeUndefined()
    expect(workstream).toEqual(original)
  })

  it('does not invent Operations metrics or target dates when the PM records are empty', () => {
    const model = buildOperationsWorkstreamViewModel({
      executionMode: 'OPERATIONS',
      progressStrategy: 'SLA_SCORE',
      items: [],
      containers: [],
      milestones: [],
      gates: [],
    })

    expect(model.progress.evidence).toMatchObject({ strategy: 'SLA_SCORE', signals: [] })
    expect(model.earliestRecordedTargetAt).toBeNull()
  })
})
