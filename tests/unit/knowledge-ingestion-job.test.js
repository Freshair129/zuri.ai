import { describe, expect, it } from 'vitest'
import {
  KNOWLEDGE_INGESTION_CONTRACT_ID,
  KNOWLEDGE_INGESTION_DEFINITION_ID,
  parsePipelineRunInput,
} from '@/platform/integrations/core/pipeline-tracking-contract'
import { ingestionIdentity } from '@/modules/knowledge/dedup'
import { knowledgeIngestionRunInput } from '@/modules/knowledge/ingestion-job'

// @req FR-109 — an ingestion job is registered on the FR-071 ledger under
// BR-021's ingestion identity, so re-ingesting an artifact is a no-op.
// @spec SDD-067, SDD-066, SDD-057, BR-021, SEC-021, ADR-050 D4
// @tested tests/unit/knowledge-ingestion-job.test.js

const HASH = 'c'.repeat(64)

function artifact(over = {}) {
  return {
    scope: { tenantId: 't-1', businessId: 'b-1' },
    artifact_id: 'art-1',
    source_id: 'src://drive/contract.md',
    source_uri: 'https://drive.example/contract.md',
    source_version: '2',
    content_hash: HASH,
    pipeline_version: 'ki-1.0.0',
    ...over,
  }
}

describe('FR-109 knowledge ingestion run input', () => {
  it('keys the run on BR-021 ingestion identity, not on anything the caller chose', () => {
    const input = knowledgeIngestionRunInput(artifact())
    expect(input.idempotencyKey).toBe(ingestionIdentity(artifact()))
  })

  it('carries the knowledge definition and its own execution contract', () => {
    const input = knowledgeIngestionRunInput(artifact())
    expect(input.dataPipelineDefinitionId).toBe(KNOWLEDGE_INGESTION_DEFINITION_ID)
    expect(input.executionContractId).toBe(KNOWLEDGE_INGESTION_CONTRACT_ID)
  })

  it('produces an input FR-071 accepts, rather than one that only looks right', () => {
    // The SDD-063 seam rule: a written claim that two shapes agree is prose.
    const parsed = parsePipelineRunInput(knowledgeIngestionRunInput(artifact()))
    expect(parsed.businessId).toBe('b-1')
  })

  it('derives every field, correlation id included, so re-ingestion is byte-identical', () => {
    // SDD-067: createPipelineRun returns UNCHANGED only when requestHash also
    // matches, and requestHash covers the whole input. A caller-supplied
    // correlation id would turn the second ingestion into a 409.
    expect(knowledgeIngestionRunInput(artifact())).toEqual(knowledgeIngestionRunInput(artifact()))
    expect(knowledgeIngestionRunInput(artifact()).correlationId)
      .toBe(knowledgeIngestionRunInput(artifact()).correlationId)
  })

  it('ignores a correlation id offered by the caller instead of quietly honouring it', () => {
    const withCaller = knowledgeIngestionRunInput({ ...artifact(), correlationId: 'req-9999' })
    expect(withCaller.correlationId).toBe(knowledgeIngestionRunInput(artifact()).correlationId)
    expect(withCaller.correlationId).not.toBe('req-9999')
  })

  it('gives two different artifacts two different keys', () => {
    const a = knowledgeIngestionRunInput(artifact())
    const b = knowledgeIngestionRunInput(artifact({ source_version: '3' }))
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey)
    expect(a.correlationId).not.toBe(b.correlationId)
  })

  it('treats a reparse under a new pipeline version as a different run', () => {
    const a = knowledgeIngestionRunInput(artifact())
    const b = knowledgeIngestionRunInput(artifact({ pipeline_version: 'ki-1.1.0' }))
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey)
  })

  it('never lets two tenants share a run key for a byte-identical document', () => {
    // SEC-021 by construction: the tenant is inside the hash (SDD-065).
    const a = knowledgeIngestionRunInput(artifact())
    const b = knowledgeIngestionRunInput(artifact({ scope: { tenantId: 't-2', businessId: 'b-2' } }))
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey)
  })

  it('refuses an artifact missing a part of the key rather than hashing a hole', () => {
    expect(() => knowledgeIngestionRunInput(artifact({ content_hash: undefined })).idempotencyKey).toThrow()
    expect(() => knowledgeIngestionRunInput(artifact({ pipeline_version: '' }))).toThrow()
    expect(() => knowledgeIngestionRunInput(artifact({ scope: { businessId: 'b-1' } }))).toThrow(/tenant/i)
  })

  it('refuses an artifact with no business to attribute the run to', () => {
    expect(() => knowledgeIngestionRunInput(artifact({ scope: { tenantId: 't-1' } }))).toThrow(/business/i)
  })

  it('carries the artifact id in the FR-071 identity envelope, where FR-109 says it lives', () => {
    expect(knowledgeIngestionRunInput(artifact()).identityRefs.artifactIds).toEqual(['art-1'])
    expect(knowledgeIngestionRunInput(artifact({ artifact_id: undefined })).identityRefs.artifactIds).toEqual([])
  })

  it('passes the content hash through as sourceSha256 only when it is one', () => {
    // FR-071 validates sourceSha256 as a SHA-256 digest. BR-021 does not
    // require content_hash to be one, so a non-digest is withheld rather than
    // reshaped into something that would fail the envelope.
    expect(knowledgeIngestionRunInput(artifact()).sourceSha256).toBe(HASH)
    expect(knowledgeIngestionRunInput(artifact({ content_hash: 'md5:abc' })).sourceSha256).toBeNull()
    expect(() => parsePipelineRunInput(knowledgeIngestionRunInput(artifact({ content_hash: 'md5:abc' })))).not.toThrow()
  })

  it('records where the artifact came from without inventing it', () => {
    expect(knowledgeIngestionRunInput(artifact()).sourceRef).toBe('https://drive.example/contract.md')
    expect(knowledgeIngestionRunInput(artifact({ source_uri: undefined })).sourceRef).toBeNull()
    expect(knowledgeIngestionRunInput(artifact()).artifactRef).toBe('art-1')
  })
})
