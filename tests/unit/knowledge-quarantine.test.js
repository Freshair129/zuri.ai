import { describe, expect, it } from 'vitest'
import { runKnowledgeIngestionStagesWithTrace } from '@/modules/knowledge/stage-runner'
import {
  QUARANTINE_CLASSIFICATIONS,
  buildQuarantineEnvelope,
  classifyStageFailure,
} from '@/modules/knowledge/quarantine'

// @req FR-119 — BR-022's quarantine envelope and classification.
// @spec SDD-072, BR-022
// @tested tests/unit/knowledge-quarantine.test.js

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

const policy = () => ({
  sensitivity: 'INTERNAL', retention_policy: 'RETAIN_7Y', export_policy: 'NO_EXPORT',
  cloud_processing_allowed: true, embedding_allowed: true,
})

function failedTrace(over = {}) {
  return runKnowledgeIngestionStagesWithTrace({
    documentId: 'doc_1',
    text: 'irrelevant',
    artifact: artifact({ ingested_at: '2026-08-28T02:00:00Z', parsed_at: '2026-08-28T01:00:00Z' }),
    policy: policy(),
    ...over,
  })
}

describe('BR-022 classification', () => {
  it('names all three values in the vocabulary, not only the one it returns', () => {
    expect(QUARANTINE_CLASSIFICATIONS).toEqual(['RETRYABLE', 'NON_RETRYABLE', 'REVIEW_REQUIRED'])
  })

  it('classifies every Tier 1 stage failure as NON_RETRYABLE — the stages are pure and deterministic', () => {
    expect(classifyStageFailure(new Error('anything'))).toBe('NON_RETRYABLE')
    expect(classifyStageFailure()).toBe('NON_RETRYABLE')
  })
})

describe('BR-022 quarantine envelope', () => {
  it('carries every field the business rule names', () => {
    const trace = failedTrace()
    const envelope = buildQuarantineEnvelope({
      jobId: 'run-1', artifactId: 'art_1', pipelineVersion: 'ki-1.0.0', traceResult: trace,
      now: () => new Date('2026-08-28T03:00:00Z'),
    })

    expect(envelope.job_id).toBe('run-1')
    expect(envelope.artifact_id).toBe('art_1')
    expect(envelope.stage).toBe('DPS-KI-PROVENANCE')
    expect(envelope.error_code).toBe('DPS-KI-PROVENANCE_VALIDATION_FAILED')
    expect(envelope.error_message).toMatch(/ingested_at/)
    expect(envelope.retry_count).toBe(0)
    expect(envelope.first_failed_at).toBe('2026-08-28T03:00:00.000Z')
    expect(envelope.last_failed_at).toBe(envelope.first_failed_at)
    expect(envelope.pipeline_version).toBe('ki-1.0.0')
    expect(envelope.classification).toBe('NON_RETRYABLE')
  })

  it('refuses to build an envelope from a successful trace — there is nothing to quarantine', () => {
    const succeeded = runKnowledgeIngestionStagesWithTrace({
      documentId: 'doc_1', text: 'irrelevant', artifact: artifact(), policy: policy(),
    })
    expect(() => buildQuarantineEnvelope({
      jobId: 'run-1', artifactId: 'art_1', pipelineVersion: 'ki-1.0.0', traceResult: succeeded,
    })).toThrow(/failed/)
  })

  it('never writes the raw message anywhere but the envelope this function returns', () => {
    // The point of the design: error_message is real, and is the ONLY place
    // this information ends up. Nothing here touches a ledger field.
    const trace = failedTrace()
    const envelope = buildQuarantineEnvelope({ jobId: 'run-1', artifactId: 'art_1', pipelineVersion: 'ki-1.0.0', traceResult: trace })
    expect(Object.keys(envelope)).not.toContain('errorRef')
  })
})
