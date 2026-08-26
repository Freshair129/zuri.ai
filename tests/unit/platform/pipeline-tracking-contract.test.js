import { describe, expect, it } from 'vitest'
import {
  DATA_PIPELINE_DEFINITION_ID,
  EXECUTION_CONTRACT_ID,
  IDENTITY_REFS_EMPTY,
  PIPELINE_STAGE_CATALOG,
  assertStatusTransition,
  parsePipelineEvent,
} from '@/platform/integrations/core/pipeline-tracking-contract'

// @req FR-071 — pipeline events have one stable identity/stage contract and
// reject unsafe or incomplete event payloads before persistence.
// @spec ADR-030 D2-D5, SDD-042, SEC-003, SEC-008
// @tested tests/unit/platform/pipeline-tracking-contract.test.js

const HASH = 'a'.repeat(64)

function event(over = {}) {
  return {
    eventType: 'STEP_FAILED',
    dataPipelineDefinitionId: DATA_PIPELINE_DEFINITION_ID,
    executionContractId: EXECUTION_CONTRACT_ID,
    executionRunId: 'run-1',
    pipelineStageId: 'DPS-RECONCILE',
    executionStepId: 'step-1',
    attemptId: 'attempt-1',
    pipelineRecordId: null,
    sourceRecordKey: null,
    sourceRowNumber: null,
    sourceSha256: HASH,
    docId: null,
    picId: null,
    factId: null,
    sourceDocIds: [],
    sourcePicIds: [],
    destinationRecordId: null,
    sequence: 40,
    status: 'FAILED',
    correlationId: 'corr-1',
    idempotencyKey: 'event-1',
    inputHash: HASH,
    outputHash: null,
    tagIds: [],
    identityRefs: { ...IDENTITY_REFS_EMPTY },
    failureCode: 'SOURCE_ROW_DUPLICATE',
    errorRef: 'err://event-1',
    retryable: false,
    reconciliation: null,
    gate: null,
    ...over,
  }
}

describe('FR-071 pipeline tracking contract', () => {
  it('publishes the canonical stage catalog and execution identities', () => {
    expect(DATA_PIPELINE_DEFINITION_ID).toBe('DPL-SUPABASE-BUSINESS-KNOWLEDGE-V1')
    expect(EXECUTION_CONTRACT_ID).toBe('EXC-DATA-MIGRATION-V1')
    expect(PIPELINE_STAGE_CATALOG.map((stage) => stage.pipelineStageId)).toEqual([
      'DPS-SOURCE-SNAPSHOT',
      'DPS-EXPORT-ARTIFACT',
      'DPS-SCHEMA-VALIDATE',
      'DPS-RECONCILE',
      'DPS-SCOPE-RESOLVE',
      'DPS-STAGING-LOAD',
      'DPS-SUPABASE-APPLY',
      'DPS-POST-APPLY-VERIFY',
      'DPS-PUBLISH',
      'DPS-ROLLBACK',
    ])
  })

  it('requires the complete identity envelope, including explicit null/empty refs', () => {
    const parsed = parsePipelineEvent(event())
    expect(parsed.identityRefs).toEqual(IDENTITY_REFS_EMPTY)
    expect(parsed.sourceDocIds).toEqual([])
    expect(parsed.sourcePicIds).toEqual([])
  })

  it('rejects raw payload, OCR text, image bytes and unknown event keys', () => {
    expect(() => parsePipelineEvent(event({ rawPayload: 'secret' }))).toThrow()
    expect(() => parsePipelineEvent(event({ ocrText: 'ข้อมูลส่วนบุคคล' }))).toThrow()
    expect(() => parsePipelineEvent(event({ imageBytes: 'base64' }))).toThrow()
    expect(() => parsePipelineEvent(event({ identityRefs: { ...IDENTITY_REFS_EMPTY, typo: [] } }))).toThrow()
  })

  it('requires failure evidence and uses an explicit transition graph', () => {
    expect(() => parsePipelineEvent(event({ failureCode: null }))).toThrow()
    expect(() => assertStatusTransition('QUEUED', 'RUNNING')).not.toThrow()
    expect(() => assertStatusTransition('RUNNING', 'FAILED')).not.toThrow()
    expect(() => assertStatusTransition('SUCCEEDED', 'RUNNING')).toThrow()
  })
})
