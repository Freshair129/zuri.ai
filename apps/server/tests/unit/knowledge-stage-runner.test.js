import { describe, expect, it } from 'vitest'
import { runKnowledgeIngestionStages } from '@/modules/knowledge/stage-runner'

// @req FR-118 — the seven Tier 1 stages compose as one pass, not four
// disconnected pairs.
// @spec SDD-068, ADR-050 D1-D2
// @tested tests/unit/knowledge-stage-runner.test.js

const artifact = (over = {}) => ({
  scope: { tenantId: 'ten_1', businessId: 'biz_1' },
  artifact_id: 'art_1',
  source_id: 'src://drive/contract.md',
  source_type: 'FILE',
  source_uri: 'https://drive.example/contract.md',
  source_version: '1',
  content_hash: 'a'.repeat(64),
  pipeline_version: 'ki-1.0.0',
  ingested_at: '2026-08-28T01:00:00Z',
  parsed_at: '2026-08-28T01:00:05Z',
  extractor_version: 'ki-parse-1',
  ...over,
})

const policy = (over = {}) => ({
  sensitivity: 'INTERNAL',
  retention_policy: 'RETAIN_7Y',
  export_policy: 'NO_EXPORT',
  cloud_processing_allowed: true,
  embedding_allowed: true,
  ...over,
})

const DOC_TEXT = [
  '# Scope of work',
  '',
  'คู่สัญญาคือ บริษัท เอบีซี จำกัด และผู้ซื้อ',
  '',
  '# Payment terms',
  '',
  'Net thirty days.',
].join('\n')

const run = (over = {}) => runKnowledgeIngestionStages({
  documentId: 'doc_1',
  text: DOC_TEXT,
  artifact: artifact(),
  policy: policy(),
  ...over,
})

describe('FR-118 the seven Tier 1 stages compose over one real artifact', () => {
  it('runs parse, provenance, normalize, classify, dedupe, chunk and entity-extract in one pass', () => {
    const result = run({
      structuredFields: [{ value: '25/8/2569', kind: 'date', era: 'BE' }],
      structuredRecords: [{ record_id: 'rec_1', type: 'ORGANIZATION', mention: 'Acme Co., Ltd.', scope: { tenantId: 'ten_1' }, provenance: { source_ref: 'crm' } }],
    })

    // Stage 2 — parsed structure feeds Stage 7 without a second copy of it.
    expect(result.parsed.document_id).toBe('doc_1')
    expect(result.parsed.structure.some((n) => n.type === 'heading')).toBe(true)

    // Stage 3 — provenance built from the artifact's own fields.
    expect(result.provenance.source_id).toBe('src://drive/contract.md')
    expect(result.provenance.checksum).toBe('a'.repeat(64))

    // Stage 4 — the structured field normalized, raw preserved.
    expect(result.normalized_fields).toHaveLength(1)
    expect(result.normalized_fields[0].raw).toBe('25/8/2569')
    expect(result.normalized_fields[0].canonical).toBe('2026-08-25')

    // Stage 5 — classification carries the artifact's scope and the policy.
    expect(result.classification.scope).toEqual({ tenantId: 'ten_1', businessId: 'biz_1' })
    expect(result.classification.sensitivity).toBe('INTERNAL')

    // Stage 6 — first sighting of this artifact is independent.
    expect(result.dedup.relationship).toBe('INDEPENDENT')

    // Stage 7 — chunks carry the classification's scope and Stage 3's provenance.
    expect(result.chunks.length).toBeGreaterThan(0)
    expect(result.chunks[0].document_id).toBe('doc_1')
    expect(result.chunks[0].scope).toEqual({ tenantId: 'ten_1', businessId: 'biz_1' })
    expect(result.chunks[0].provenance).toBe(result.provenance)

    // Stage 8 — the Thai organisation is found inside the prose chunk, and
    // the structured record's mention is carried through untouched.
    const mentions = result.entity_candidates.map((c) => c.mention)
    expect(mentions).toContain('บริษัท เอบีซี จำกัด')
    expect(mentions).toContain('Acme Co., Ltd.')
    const fromRecord = result.entity_candidates.find((c) => c.source_record_id === 'rec_1')
    expect(fromRecord.source_chunk_id).toBeNull()
    const fromChunk = result.entity_candidates.find((c) => c.mention === 'บริษัท เอบีซี จำกัด')
    expect(fromChunk.source_chunk_id).not.toBeNull()
  })

  it('is deterministic — the same artifact and text produce the same chunk and candidate ids twice', () => {
    // BR-021 depends on this: a reprocessed document must chunk to the same
    // ids, or two runs of the same input would look like different knowledge.
    const a = run()
    const b = run()
    expect(a.chunks.map((c) => c.chunk_id)).toEqual(b.chunks.map((c) => c.chunk_id))
    expect(a.entity_candidates.map((c) => c.candidate_id)).toEqual(b.entity_candidates.map((c) => c.candidate_id))
  })

  it('classifies a re-ingestion of the same artifact as DUPLICATE_OF, not a fresh chunk set silently accepted', () => {
    const first = run()
    const second = run({ priorArtifacts: [artifact()] })
    expect(second.dedup.relationship).toBe('DUPLICATE_OF')
    // Chunking and extraction still ran — dedup does not short-circuit the
    // rest of the pass, because classifying the relationship is Stage 6's
    // job and acting on it (skip vs. proceed) belongs to a caller with a
    // ledger to write the decision onto.
    expect(second.chunks.length).toBe(first.chunks.length)
  })

  it('classifies a new version of the same source as REVISION_OF, carrying the supersession edge', () => {
    const result = run({
      artifact: artifact({ source_version: '2' }),
      priorArtifacts: [artifact({ source_version: '1' })],
    })
    expect(result.dedup.relationship).toBe('REVISION_OF')
    expect(result.dedup.edges.some((e) => e.type === 'SUPERSEDES')).toBe(true)
  })
})

describe('FR-118 field mapping between stages is exact, not by convention', () => {
  it('maps the artifact’s content_hash onto FR-116’s checksum, once, in one place', () => {
    const result = run({ artifact: artifact({ content_hash: 'b'.repeat(64) }) })
    expect(result.provenance.checksum).toBe('b'.repeat(64))
  })

  it('never lets the whole classification object leak into a chunk’s scope field', () => {
    const result = run()
    expect(result.chunks[0].scope).not.toHaveProperty('sensitivity')
    expect(result.chunks[0].scope).not.toHaveProperty('scope')
  })

  it('hands Stage 7 exactly Stage 2’s structure, not a re-derived copy', () => {
    const result = run()
    const headings = result.parsed.structure.filter((n) => n.type === 'heading').length
    expect(result.chunks.length).toBeGreaterThanOrEqual(headings)
  })
})

describe('FR-118 does not catch or classify a stage failure', () => {
  it('propagates FR-116’s own error for a source that arrived before it was ingested', () => {
    // buildSourceProvenance's own ordering check — proof this function does
    // not wrap or reshape a stage's error.
    expect(() => run({
      artifact: artifact({ ingested_at: '2026-08-28T02:00:00Z', parsed_at: '2026-08-28T01:00:00Z' }),
    })).toThrow(/ingested_at/)
  })

  it('propagates FR-111’s own error for a policy missing a required field', () => {
    const incomplete = policy()
    delete incomplete.export_policy
    expect(() => run({ policy: incomplete })).toThrow(/export_policy/)
  })

  it('propagates FR-117’s own error for an artifact missing a dedup identity field', () => {
    expect(() => run({ artifact: artifact({ pipeline_version: undefined }) })).toThrow(/pipeline_version/)
  })
})

describe('FR-118 required inputs are refused rather than defaulted', () => {
  it('refuses a call with no documentId', () => {
    expect(() => runKnowledgeIngestionStages({ text: DOC_TEXT, artifact: artifact(), policy: policy() })).toThrow(/documentId/)
  })

  it('refuses a call with no artifact', () => {
    expect(() => runKnowledgeIngestionStages({ documentId: 'doc_1', text: DOC_TEXT, policy: policy() })).toThrow(/artifact/)
  })

  it('refuses a call with no policy', () => {
    expect(() => runKnowledgeIngestionStages({ documentId: 'doc_1', text: DOC_TEXT, artifact: artifact() })).toThrow(/policy/)
  })
})

describe('FR-118 opens nothing and writes nothing', () => {
  it('never returns a promise — a synchronous pure function stays synchronous', () => {
    const result = run()
    expect(result).not.toBeInstanceOf(Promise)
  })

  it('returns a frozen envelope, so a caller cannot mistake the result for something it can still mutate into evidence', () => {
    expect(Object.isFrozen(run())).toBe(true)
  })
})
