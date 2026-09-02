import { describe, expect, it } from 'vitest'
import { buildPlanImportRequest } from '@/modules/project-manager/components/planImportRequest'

// @req FR-012, FR-017 — the request body sent to POST /api/import/dry-run
// must be byte-identical to the one later sent to POST /api/import/commit
// (BR-009, SDD-009): a preview that checked one workspace/project target must
// never be followed by a commit against a different one. This is the pure
// builder both legs (and every calling UI surface) share.
// @spec BR-009, SDD-009
// @tested tests/unit/plan-import-request.test.js

describe('buildPlanImportRequest', () => {
  const plan = { schemaVersion: '1.0', project: { code: 'PRJ-1' } }

  it('carries the plan through unchanged under the "plan" key', () => {
    expect(buildPlanImportRequest(plan).plan).toBe(plan)
  })

  it('passes a given workspaceId through', () => {
    expect(buildPlanImportRequest(plan, { workspaceId: 'ws-1' })).toEqual({
      plan,
      workspaceId: 'ws-1',
      projectId: undefined,
    })
  })

  it('passes a given projectId through', () => {
    expect(buildPlanImportRequest(plan, { projectId: 'proj-1' })).toEqual({
      plan,
      workspaceId: undefined,
      projectId: 'proj-1',
    })
  })

  it('normalizes a falsy workspaceId/projectId to undefined rather than forwarding "" or null', () => {
    expect(buildPlanImportRequest(plan, { workspaceId: '', projectId: null })).toEqual({
      plan,
      workspaceId: undefined,
      projectId: undefined,
    })
  })

  it('defaults both target fields to undefined with no second argument', () => {
    expect(buildPlanImportRequest(plan)).toEqual({ plan, workspaceId: undefined, projectId: undefined })
  })

  it('builds the identical request twice for the identical input (dry-run and commit must agree)', () => {
    const target = { workspaceId: 'ws-9', projectId: 'proj-9' }
    expect(buildPlanImportRequest(plan, target)).toEqual(buildPlanImportRequest(plan, target))
  })
})
