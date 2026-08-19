// @req FR-083 — Development Overview Dashboard with Roadmap Stepper and Workstream Execution Lanes.
// @spec SDD-018, SDD-033, ADR-011
// @tested tests/unit/fr083-development-dashboard.test.js

import { describe, it, expect } from 'vitest'
import { zWorkstreamInput } from '@/lib/validation/entities'
import { createWorkstream, updateWorkstream } from '@/modules/project-manager/application/project-service'

describe('FR-083 — Workstream laneId and Development Dashboard contracts', () => {
  it('validates laneId in zWorkstreamInput schema', () => {
    const valid = zWorkstreamInput.parse({
      projectId: 'prj-123',
      name: 'Core Engine Workstream',
      laneId: 'LANE-CORE',
      executionMode: 'SOFTWARE_SPRINT',
    })
    expect(valid.laneId).toBe('LANE-CORE')

    const withoutLane = zWorkstreamInput.parse({
      projectId: 'prj-123',
      name: 'General Workstream',
      executionMode: 'OPERATIONS',
    })
    expect(withoutLane.laneId).toBeUndefined()
  })

  it('allows nullish laneId values', () => {
    const parsedNull = zWorkstreamInput.parse({
      projectId: 'prj-123',
      name: 'Null Lane Workstream',
      laneId: null,
      executionMode: 'DATA_MIGRATION',
    })
    expect(parsedNull.laneId).toBeNull()
  })
})
