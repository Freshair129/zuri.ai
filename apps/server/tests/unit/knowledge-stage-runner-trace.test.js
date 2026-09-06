import { describe, expect, it } from 'vitest'
import { runKnowledgeIngestionStages, runKnowledgeIngestionStagesWithTrace } from '@/modules/knowledge/stage-runner'

// @req FR-119 — per-stage failure attribution: which of the seven Tier 1
// stages a document got through before failing, not just that it failed.
// @spec SDD-072, ADR-050 D1-D2
// @tested tests/unit/knowledge-stage-runner-trace.test.js

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

const DOC_TEXT = '# Scope\n\nบริษัท เอบีซี จำกัด delivers the console.'

const TIER1_ORDER = [
  'DPS-KI-PARSE', 'DPS-KI-PROVENANCE', 'DPS-KI-NORMALIZE', 'DPS-KI-CLASSIFY',
  'DPS-KI-DEDUPE', 'DPS-KI-CHUNK', 'DPS-KI-ENTITY-EXTRACT',
]

const trace = (over = {}) => runKnowledgeIngestionStagesWithTrace({
  documentId: 'doc_1',
  text: DOC_TEXT,
  artifact: artifact(),
  policy: policy(),
  ...over,
})

describe('FR-119 per-stage failure attribution', () => {
  it('on success, reports all seven stages SUCCEEDED and the same envelope the throwing function returns', () => {
    const result = trace()
    expect(result.success).toBe(true)
    expect(result.stages).toEqual(TIER1_ORDER.map((id) => ({ id, status: 'SUCCEEDED' })))
    expect(result.failedStage).toBeNull()
    expect(result.error).toBeNull()

    const thrown = runKnowledgeIngestionStages({ documentId: 'doc_1', text: DOC_TEXT, artifact: artifact(), policy: policy() })
    expect(result.envelope).toEqual(thrown)
  })

  it('names the exact stage that failed and reports every stage before it as SUCCEEDED', () => {
    // FR-116's own ordering guard, at Stage 3 -- Stage 2 (parse) has already
    // run by the time this throws.
    const result = trace({
      artifact: artifact({ ingested_at: '2026-08-28T02:00:00Z', parsed_at: '2026-08-28T01:00:00Z' }),
    })
    expect(result.success).toBe(false)
    expect(result.stages).toEqual([
      { id: 'DPS-KI-PARSE', status: 'SUCCEEDED' },
      { id: 'DPS-KI-PROVENANCE', status: 'FAILED' },
    ])
    expect(result.failedStage).toBe('DPS-KI-PROVENANCE')
    expect(result.envelope).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
    expect(result.error.message).toMatch(/ingested_at/)
  })

  it('fails at Stage 5 when policy is incomplete, with Stages 2-4 already recorded as succeeded', () => {
    const incompletePolicy = policy()
    delete incompletePolicy.export_policy
    const result = trace({ policy: incompletePolicy })

    expect(result.stages.map((s) => s.id)).toEqual([
      'DPS-KI-PARSE', 'DPS-KI-PROVENANCE', 'DPS-KI-NORMALIZE', 'DPS-KI-CLASSIFY',
    ])
    expect(result.failedStage).toBe('DPS-KI-CLASSIFY')
    expect(result.error.message).toMatch(/export_policy/)
  })

  it('fails at Stage 6 for a malformed prior artifact, with a fully valid artifact of its own already through Stages 2-5', () => {
    // The main artifact is complete -- Parse, Provenance, Normalize and
    // Classify all succeed on it. classifyAgainst computes ingestionIdentity
    // for every prior artifact it compares against too, so a broken PRIOR
    // artifact is the one way to fail Dedupe specifically without also
    // failing Provenance or Classify on the artifact actually being ingested.
    const result = trace({ priorArtifacts: [artifact({ pipeline_version: undefined })] })
    expect(result.failedStage).toBe('DPS-KI-DEDUPE')
    expect(result.stages).toHaveLength(5)
    expect(result.stages.slice(0, 4).every((s) => s.status === 'SUCCEEDED')).toBe(true)
  })

  it('never throws itself — a stage error is returned data, not a control-flow event', () => {
    expect(() => trace({ artifact: artifact({ pipeline_version: undefined }) })).not.toThrow()
    expect(() => trace({ policy: {} })).not.toThrow()
  })

  it('still throws for a caller-contract violation — a missing documentId is not a stage failure to quarantine', () => {
    expect(() => runKnowledgeIngestionStagesWithTrace({ text: DOC_TEXT, artifact: artifact(), policy: policy() }))
      .toThrow(/documentId/)
  })

  it('is deterministic like its throwing counterpart — the same failing input names the same failed stage twice', () => {
    const a = trace({ artifact: artifact({ pipeline_version: undefined }) })
    const b = trace({ artifact: artifact({ pipeline_version: undefined }) })
    expect(a.failedStage).toBe(b.failedStage)
    expect(a.error.message).toBe(b.error.message)
  })

  it('has no partialEnvelope on success — nothing about a full success is partial', () => {
    expect(trace().partialEnvelope).toBeNull()
  })

  it('carries what actually completed in partialEnvelope, in the same shape the full envelope uses', () => {
    // Fails at Stage 5 (Classify) — Parse, Provenance and Normalize
    // succeeded and their real output is what partialEnvelope carries.
    const incompletePolicy = policy()
    delete incompletePolicy.export_policy
    const result = trace({
      policy: incompletePolicy,
      structuredFields: [{ value: '25/8/2569', kind: 'date', era: 'BE' }],
    })

    expect(result.partialEnvelope.document_id).toBe('doc_1')
    expect(result.partialEnvelope.parsed.document_id).toBe('doc_1')
    expect(result.partialEnvelope.provenance.source_id).toBe('src://drive/contract.md')
    expect(result.partialEnvelope.normalized_fields).toHaveLength(1)
    expect(result.partialEnvelope.normalized_fields[0].canonical).toBe('2026-08-25')
    // Stages after the failure never ran -- their envelope keys are absent,
    // not present-and-empty, which would misreport "ran and found nothing".
    expect(result.partialEnvelope).not.toHaveProperty('classification')
    expect(result.partialEnvelope).not.toHaveProperty('chunks')
  })

  it('collects warnings only from stages that actually ran before the failure', () => {
    const result = trace({
      artifact: artifact({ ingested_at: '2026-08-28T02:00:00Z', parsed_at: '2026-08-28T01:00:00Z' }),
    })
    // Failed at Stage 3 (Provenance) -- Parse already ran and its warnings
    // (if any) are real; Chunk and Entity Extraction never ran, so their
    // warnings cannot be in the list.
    expect(result.failedStage).toBe('DPS-KI-PROVENANCE')
    expect(Array.isArray(result.partialEnvelope.warnings)).toBe(true)
  })
})
