import { describe, expect, it } from 'vitest'
import { canonicalGenesisRag17Json, hashGenesisRag17Json, zGenesisRag17Metrics, validateGenesisRag17EvidencePage, parseGenesisRag17QueryResponse } from '@/modules/knowledge/genesisrag17-contract'

// @req FR-109 — stable cross-tier identities and six measured counters.
// @req FR-110 — old-attempt evidence cannot be silently attributed to a new run.
// @spec ADR-071
// @tested tests/unit/genesisrag17-contract.test.js

describe('GenesisRAG17 cross-tier wire regressions', () => {
  it('accepts pinned native hit identities and rejects mixed or undeclared fields', () => {
    const scope = { portfolioId: 'p', tenantId: 't', businessId: 'b', workspaceId: '', agentId: '', visibility: 'private' }
    const result = { id: 'chunk', snapshotId: 'snapshot', generation: 'generation', score: 1, text: 'text', citation: { sourceId: 'source', rawArtifactId: 'raw', parsedArtifactId: 'parsed', chunkId: 'chunk', contentHash: 'a'.repeat(64) } }
    const response = { schemaVersion: 'genesisrag17.v1', scope, snapshotId: 'snapshot', generation: 'generation', results: [result] }
    expect(parseGenesisRag17QueryResponse(response, scope)).toEqual(response)
    for (const changed of [{ snapshotId: 'foreign' }, { generation: 'foreign' }, { actor: 'trusted' }]) {
      expect(() => parseGenesisRag17QueryResponse({ ...response, results: [{ ...result, ...changed }] }, scope)).toThrow()
    }
  })
  it('sorts integer-looking stage keys lexically without JavaScript object reordering', () => {
    expect(canonicalGenesisRag17Json({ stageMetrics: { 9: 1, 10: 2, 17: 3 } })).toBe('{"stageMetrics":{"10":2,"17":3,"9":1}}')
    expect(hashGenesisRag17Json({ b: [2, 1], a: { 9: 1, 10: 2 } })).toBe(hashGenesisRag17Json({ a: { 10: 2, 9: 1 }, b: [2, 1] }))
    expect(hashGenesisRag17Json([2, 1])).not.toBe(hashGenesisRag17Json([1, 2]))
  })
  it('refuses ambiguous non-JSON hash inputs', () => {
    for (const value of [NaN, Infinity, undefined, { value: undefined }]) expect(() => canonicalGenesisRag17Json(value)).toThrow()
    const cycle = {}; cycle.self = cycle
    expect(() => canonicalGenesisRag17Json(cycle)).toThrow(/cycles/)
  })
  it('requires integer measured counters while retaining fractional duration', () => {
    const metrics = { records_in: 1, records_out: 1, records_quarantined: 0, error_count: 0, retry_count: 0, duration_ms: 0.25 }
    expect(zGenesisRag17Metrics.parse(metrics)).toEqual(metrics)
    expect(() => zGenesisRag17Metrics.parse({ ...metrics, records_out: 0.5 })).toThrow()
    expect(() => zGenesisRag17Metrics.parse({ ...metrics, retry_count: undefined })).toThrow()
  })
  it('cannot advance the cursor over an unreturned row or accept a foreign run', () => {
    const scope = { portfolioId: 'p', tenantId: 't', businessId: 'b', workspaceId: '', agentId: '', visibility: 'private' }
    const page = { schemaVersion: 'genesisrag17.v1', scope, rows: [], nextCursor: 1 }
    expect(() => validateGenesisRag17EvidencePage(page, { scope, runId: 'r', afterCursor: 0 })).toThrow(/nextCursor/)
    const row = { cursor: 1, schemaVersion: page.schemaVersion, scope, runId: 'old-run', pipelineStageId: 'DPS-KI-ENTITY-RESOLVE', executionStepId: 's', attemptId: 'a', stageNumber: 9, outcome: 'SUCCEEDED', startedAt: '2026-09-07T00:00:00.000Z', finishedAt: '2026-09-07T00:00:00.000Z', metrics: { records_in: 0, records_out: 0, records_quarantined: 0, error_count: 0, retry_count: 0, duration_ms: 0 }, details: {} }
    expect(() => validateGenesisRag17EvidencePage({ ...page, rows: [row] }, { scope, runId: 'new-run' })).toThrow(/run id/)
  })
})
