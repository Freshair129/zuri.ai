import { describe, it, expect } from 'vitest'
import { assertPublishable } from '@/modules/knowledge/provenance'

// @req FR-116 — derived-object provenance and the lineage chain back to a source
// @spec SDD-064, docs/KNOWLEDGE-INGESTION-17-STAGE-SPEC.md §8 (Stage 3)

describe('declaring an object derived is a claim, not an exemption', () => {
  it('refuses DERIVED with nothing named as its source', () => {
    expect(() =>
      assertPublishable({ id: 'fact_1', provenance: { derivation_method: 'DERIVED' } }, () => undefined),
    ).toThrow(/source/i)
  })

  it('refuses DERIVED with an empty source list — an empty list names nothing', () => {
    expect(() =>
      assertPublishable({ id: 'fact_1', provenance: { derivation_method: 'DERIVED', source_objects: [] } }, () => undefined),
    ).toThrow(/source/i)
  })

  it('accepts DERIVED that names what it came from — and that resolves', () => {
    const chunk = { id: 'chunk_1', provenance: { source_id: 'src_1' } }
    expect(() =>
      assertPublishable(
        {
          id: 'fact_1',
          provenance: {
            derivation_method: 'DERIVED',
            source_objects: ['chunk_1'],
            confidence: 0.8,
            pipeline_version: 'ki-1',
          },
        },
        (id) => (id === 'chunk_1' ? chunk : undefined),
      ),
    ).not.toThrow()
  })
})

import { buildSourceProvenance, traceToSource } from '@/modules/knowledge/provenance'

const source = () => ({
  source_id: 'src_1',
  source_type: 'DOCUMENT',
  source_uri: 'line://oa/message/1',
  source_version: '1',
  artifact_id: 'raw_1',
  ingested_at: '2026-08-27T01:00:00.000Z',
  parsed_at: '2026-08-27T02:00:00.000Z',
  pipeline_version: 'ki-1',
  extractor_version: 'ki-parse-1',
  checksum: 'a'.repeat(64),
})

describe('a present field is not a provenance', () => {
  it('refuses an empty object — the field being there proves nothing', () => {
    expect(() => assertPublishable({ id: 'k1', provenance: {} }, () => undefined)).toThrow()
  })

  it.each(Object.keys(source()))('refuses a source provenance missing %s', (field) => {
    const input = source()
    delete input[field]
    expect(() => buildSourceProvenance(input)).toThrow(new RegExp(field))
  })
})

describe('time that could not have happened', () => {
  it('refuses an artifact parsed before it was ingested', () => {
    expect(() =>
      buildSourceProvenance({ ...source(), ingested_at: '2026-08-27T03:00:00.000Z' }),
    ).toThrow(/ingested|parsed|order/i)
  })

  it('allows the two to be the same instant', () => {
    const at = '2026-08-27T02:00:00.000Z'
    expect(() => buildSourceProvenance({ ...source(), ingested_at: at, parsed_at: at })).not.toThrow()
  })
})

describe('the chain reaches a source or the object does not publish', () => {
  const graph = {
    fact_1: { id: 'fact_1', provenance: { derivation_method: 'DERIVED', source_objects: ['chunk_1'], pipeline_version: 'ki-1' } },
    chunk_1: { id: 'chunk_1', provenance: { derivation_method: 'DERIVED', source_objects: ['parsed_1'], pipeline_version: 'ki-1' } },
    parsed_1: { id: 'parsed_1', provenance: buildSourceProvenance(source()) },
  }
  const resolve = (id) => graph[id]

  it('walks Fact to Chunk to ParsedArtifact and reaches the source', () => {
    const trace = traceToSource(graph.fact_1, resolve)
    expect(trace.reached).toBe(true)
    expect(trace.path).toEqual(['fact_1', 'chunk_1', 'parsed_1'])
    expect(trace.source_id).toBe('src_1')
  })

  it('reports a chain that names a link nothing resolves, rather than declaring success', () => {
    const broken = { id: 'fact_2', provenance: { derivation_method: 'DERIVED', source_objects: ['ghost_1'] } }
    const trace = traceToSource(broken, resolve)
    expect(trace.reached).toBe(false)
    expect(trace.unresolved).toContain('ghost_1')
  })

  it('does not loop forever on a chain that points at itself', () => {
    const loop = { id: 'loop_1', provenance: { derivation_method: 'DERIVED', source_objects: ['loop_1'] } }
    const trace = traceToSource(loop, (id) => (id === 'loop_1' ? loop : undefined))
    expect(trace.reached).toBe(false)
  })
})

describe('naming a source is not the same as having one', () => {
  const graph = { chunk_1: { id: 'chunk_1', provenance: buildSourceProvenance(source()) } }
  const resolve = (id) => graph[id]

  it('refuses DERIVED naming a source nothing resolves', () => {
    expect(() =>
      assertPublishable(
        { id: 'fact_1', provenance: { derivation_method: 'DERIVED', source_objects: ['ghost_1'] } },
        resolve,
      ),
    ).toThrow(/ghost_1/)
  })

  it('accepts DERIVED naming a source that resolves', () => {
    expect(() =>
      assertPublishable(
        { id: 'fact_1', provenance: { derivation_method: 'DERIVED', source_objects: ['chunk_1'] } },
        resolve,
      ),
    ).not.toThrow()
  })

  it('refuses to run at all without a resolver — shape-only is not a mode this offers', () => {
    expect(() =>
      assertPublishable({ id: 'fact_1', provenance: { derivation_method: 'DERIVED', source_objects: ['chunk_1'] } }),
    ).toThrow(/resolver/i)
  })

  it('refuses an object that is neither sourced nor declared derived', () => {
    expect(() => assertPublishable({ id: 'k1', provenance: { pipeline_version: 'ki-1' } }, resolve)).toThrow()
  })
})

describe('the terminal link is not taken on faith either', () => {
  const resolve = () => undefined

  it('refuses a bare source_id with none of the fields a source provenance requires', () => {
    expect(() => assertPublishable({ id: 'k1', provenance: { source_id: 'anything' } }, resolve)).toThrow()
  })

  it('accepts a source_id whose provenance is complete', () => {
    expect(() => assertPublishable({ id: 'k1', provenance: buildSourceProvenance(source()) }, resolve)).not.toThrow()
  })
})

describe('timestamps that are not timestamps', () => {
  it.each(['yesterday', '', 'null', '2026-13-45T99:99:99Z'])('refuses %s as ingested_at', (bad) => {
    expect(() => buildSourceProvenance({ ...source(), ingested_at: bad })).toThrow()
  })

  it('refuses a parsed_at that is not a date', () => {
    expect(() => buildSourceProvenance({ ...source(), parsed_at: 'soon' })).toThrow()
  })
})

describe('traceToSource reports, including about its own arguments', () => {
  it('does not throw a bare TypeError when given no resolver', () => {
    expect(() => traceToSource({ id: 'a', provenance: {} })).toThrow(/resolver/i)
  })

  it('walks every parent, not only the first', () => {
    const graph = {
      dead_end: { id: 'dead_end', provenance: { derivation_method: 'DERIVED', source_objects: [] } },
      real: { id: 'real', provenance: buildSourceProvenance(source()) },
    }
    const fanIn = {
      id: 'fact_1',
      provenance: { derivation_method: 'DERIVED', source_objects: ['dead_end', 'real'] },
    }
    const trace = traceToSource(fanIn, (id) => graph[id])
    expect(trace.reached).toBe(true)
    expect(trace.source_id).toBe('src_1')
  })
})
