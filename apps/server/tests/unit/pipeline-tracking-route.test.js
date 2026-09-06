import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// @req FR-071 — pipeline routes use the trusted viewer boundary and keep
// event/replay writes behind the server-owned tracking service.
// @spec ADR-030 D3-D6, SEC-003, SEC-008
// @tested tests/unit/pipeline-tracking-route.test.js, tests/integration/openapi-docs.test.js

const files = {
  list: readFileSync('src/app/api/pipelines/runs/route.js', 'utf8'),
  detail: readFileSync('src/app/api/pipelines/runs/[executionRunId]/route.js', 'utf8'),
  events: readFileSync('src/app/api/pipelines/runs/[executionRunId]/events/route.js', 'utf8'),
  replay: readFileSync('src/app/api/pipelines/runs/[executionRunId]/replay/route.js', 'utf8'),
}

describe('FR-071 pipeline route boundary', () => {
  it('resolves every route through the trusted viewer and service layer', () => {
    expect(files.list).toContain('resolveRequestViewer')
    expect(files.list).toContain('createPipelineRun')
    expect(files.list).toContain('listPipelineRuns')
    expect(files.detail).toContain('resolveRequestViewer')
    expect(files.detail).toContain('getPipelineMonitor')
    expect(files.events).toContain('resolveRequestViewer')
    expect(files.events).toContain('recordPipelineEvent')
    expect(files.replay).toContain('resolveRequestViewer')
    expect(files.replay).toContain('requestPipelineReplay')
  })

  it('binds event identity to the route and never adds a direct Supabase client', () => {
    expect(files.events).toContain('executionRunId does not match route')
    for (const source of Object.values(files)) {
      expect(source).not.toMatch(/service_role|createClient|SUPABASE_URL|DATABASE_URL/i)
    }
  })
})
