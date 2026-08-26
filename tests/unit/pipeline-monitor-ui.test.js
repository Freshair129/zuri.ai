import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// @req FR-071 — Data Migration reads the full-pipeline monitor and keeps
// unavailable/unknown evidence explicit instead of deriving truth from tasks.
// @spec ADR-030 D3-D5, SDD-042, SEC-008
// @tested tests/unit/pipeline-monitor-ui.test.js

const view = readFileSync('src/modules/project-manager/views/execution/mode-bodies.jsx', 'utf8')

describe('FR-071 full pipeline monitor UI contract', () => {
  it('loads a Business-scoped pipeline read model', () => {
    expect(view).toContain('/api/pipelines/runs?businessId=')
    expect(view).toContain('PipelineRun')
    expect(view).toContain('stageTimeline')
    expect(view).toContain('firstFailure')
    expect(view).toContain('reconciliation')
  })

  it('does not turn missing evidence into fake completion', () => {
    expect(view).toContain('UNKNOWN')
    expect(view).toContain('No pipeline run evidence')
    expect(view).not.toContain('pipelineRun.status === \'SUCCEEDED\' ? 100')
  })
})
