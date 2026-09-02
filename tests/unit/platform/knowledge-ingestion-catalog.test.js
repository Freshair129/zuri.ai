import { describe, expect, it } from 'vitest'
import {
  ASSET_REGISTER_IMPORT_CONTRACT_ID,
  ASSET_REGISTER_IMPORT_DEFINITION_ID,
  ASSET_REGISTER_IMPORT_STAGE_CATALOG,
  DATA_PIPELINE_DEFINITION_ID,
  EXECUTION_CONTRACT_ID,
  IDENTITY_REFS_EMPTY,
  KNOWLEDGE_INGESTION_CONTRACT_ID,
  KNOWLEDGE_INGESTION_DEFINITION_ID,
  KNOWLEDGE_INGESTION_STAGE_CATALOG,
  PIPELINE_DEFINITIONS,
  PIPELINE_STAGE_CATALOG,
  catalogFor,
  parsePipelineEvent,
  parsePipelineRunInput,
  stageById,
} from '@/platform/integrations/core/pipeline-tracking-contract'

// @req FR-109 — the seventeen-stage knowledge ingestion catalog is registered as
// one pipeline definition, and a stage id belongs to the definition that owns it.
// @spec SDD-066, SDD-057, ADR-050 D1-D3
// @tested tests/unit/platform/knowledge-ingestion-catalog.test.js

const HASH = 'a'.repeat(64)

function runInput(over = {}) {
  return {
    dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
    executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
    businessId: 'b-1',
    correlationId: 'corr-1',
    idempotencyKey: 'key-1',
    identityRefs: { ...IDENTITY_REFS_EMPTY },
    ...over,
  }
}

function event(over = {}) {
  return {
    eventType: 'STEP_SUCCEEDED',
    dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
    executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
    executionRunId: 'run-1',
    pipelineStageId: 'DPS-KI-CHUNK',
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
    sequence: 70,
    status: 'SUCCEEDED',
    correlationId: 'corr-1',
    idempotencyKey: 'event-1',
    inputHash: HASH,
    outputHash: null,
    tagIds: [],
    identityRefs: { ...IDENTITY_REFS_EMPTY },
    failureCode: null,
    errorRef: null,
    retryable: null,
    reconciliation: null,
    gate: null,
    ...over,
  }
}

describe('FR-109 knowledge ingestion stage catalog', () => {
  it('publishes exactly the seventeen DPS-KI ids in the sequence the feature note fixes', () => {
    expect(KNOWLEDGE_INGESTION_DEFINITION_ID).toBe('DPL-KNOWLEDGE-INGEST-V1')
    expect(KNOWLEDGE_INGESTION_STAGE_CATALOG.map((stage) => stage.pipelineStageId)).toEqual([
      'DPS-KI-INGEST',
      'DPS-KI-PARSE',
      'DPS-KI-PROVENANCE',
      'DPS-KI-NORMALIZE',
      'DPS-KI-CLASSIFY',
      'DPS-KI-DEDUPE',
      'DPS-KI-CHUNK',
      'DPS-KI-ENTITY-EXTRACT',
      'DPS-KI-ENTITY-RESOLVE',
      'DPS-KI-FACT-EXTRACT',
      'DPS-KI-ONTOLOGY-MAP',
      'DPS-KI-TEMPORAL-MAP',
      'DPS-KI-GRAPH-BUILD',
      'DPS-KI-ENRICH',
      'DPS-KI-EMBED',
      'DPS-KI-INDEX',
      'DPS-KI-QUALITY-GATE',
    ])
    expect(KNOWLEDGE_INGESTION_STAGE_CATALOG.map((stage) => stage.sequence))
      .toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170])
  })

  it('keeps the sequence strictly ascending, because the step board sorts on it', () => {
    // ADR-050 D1: sequence is display ordering and never a lookup key, but a
    // non-monotonic one renders the board out of order.
    const sequences = KNOWLEDGE_INGESTION_STAGE_CATALOG.map((stage) => stage.sequence)
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b))
    expect(new Set(sequences).size).toBe(sequences.length)
  })

  it('shares no stage id with the FR-071 catalog, so neither definition can borrow the other', () => {
    const supabase = new Set(PIPELINE_STAGE_CATALOG.map((stage) => stage.pipelineStageId))
    const overlap = KNOWLEDGE_INGESTION_STAGE_CATALOG
      .map((stage) => stage.pipelineStageId)
      .filter((id) => supabase.has(id))
    expect(overlap).toEqual([])
  })

  it('registers every definition, each with its own contract id and its own catalog', () => {
    expect(Object.keys(PIPELINE_DEFINITIONS).sort())
      .toEqual([
        ASSET_REGISTER_IMPORT_DEFINITION_ID,
        DATA_PIPELINE_DEFINITION_ID,
        KNOWLEDGE_INGESTION_DEFINITION_ID,
      ].sort())
    expect(PIPELINE_DEFINITIONS[DATA_PIPELINE_DEFINITION_ID].executionContractId).toBe(EXECUTION_CONTRACT_ID)
    expect(PIPELINE_DEFINITIONS[KNOWLEDGE_INGESTION_DEFINITION_ID].executionContractId)
      .toBe(KNOWLEDGE_INGESTION_CONTRACT_ID)
    expect(PIPELINE_DEFINITIONS[ASSET_REGISTER_IMPORT_DEFINITION_ID].executionContractId)
      .toBe(ASSET_REGISTER_IMPORT_CONTRACT_ID)
    expect(catalogFor(KNOWLEDGE_INGESTION_DEFINITION_ID)).toBe(KNOWLEDGE_INGESTION_STAGE_CATALOG)
    expect(catalogFor(DATA_PIPELINE_DEFINITION_ID)).toBe(PIPELINE_STAGE_CATALOG)
    expect(catalogFor(ASSET_REGISTER_IMPORT_DEFINITION_ID)).toBe(ASSET_REGISTER_IMPORT_STAGE_CATALOG)
  })

  it('refuses to resolve a catalog for a definition nobody registered', () => {
    expect(() => catalogFor('DPL-INVENTED-V1')).toThrow(/DPL-INVENTED-V1/)
  })
})

describe('SDD-066 a stage belongs to its own definition, never to the union', () => {
  it('rejects a knowledge stage reported on a Supabase migration run', () => {
    // The failure this exists to prevent: DPS-KI-EMBED is a Tier 4 substrate
    // write (ADR-050 D2). Validating against the union of both catalogs would
    // have let a Supabase run claim it and pass every check.
    expect(() => parsePipelineEvent(event({
      dataPipelineDefinitionId: DATA_PIPELINE_DEFINITION_ID,
      executionContractId: EXECUTION_CONTRACT_ID,
      pipelineStageId: 'DPS-KI-EMBED',
    }))).toThrow()
  })

  it('rejects a Supabase stage reported on a knowledge ingestion run', () => {
    expect(() => parsePipelineEvent(event({ pipelineStageId: 'DPS-SUPABASE-APPLY' }))).toThrow()
  })

  it('accepts each definition’s own stage ids', () => {
    expect(parsePipelineEvent(event()).pipelineStageId).toBe('DPS-KI-CHUNK')
    expect(parsePipelineEvent(event({
      dataPipelineDefinitionId: DATA_PIPELINE_DEFINITION_ID,
      executionContractId: EXECUTION_CONTRACT_ID,
      pipelineStageId: 'DPS-RECONCILE',
      sequence: 40,
    })).pipelineStageId).toBe('DPS-RECONCILE')
  })

  it('validates the definition and the execution contract as a pair, not as two independent fields', () => {
    // Two z.literal pins could only ever check each half alone.
    expect(() => parsePipelineRunInput(runInput({ executionContractId: EXECUTION_CONTRACT_ID }))).toThrow()
    expect(() => parsePipelineRunInput(runInput({
      dataPipelineDefinitionId: DATA_PIPELINE_DEFINITION_ID,
      executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
    }))).toThrow()
    expect(() => parsePipelineEvent(event({ executionContractId: EXECUTION_CONTRACT_ID }))).toThrow()
  })

  it('rejects a definition id that is not registered at all', () => {
    expect(() => parsePipelineRunInput(runInput({ dataPipelineDefinitionId: 'DPL-INVENTED-V1' }))).toThrow()
    expect(() => parsePipelineEvent(event({ dataPipelineDefinitionId: 'DPL-INVENTED-V1' }))).toThrow()
  })

  it('still accepts the FR-071 envelope unchanged, which is what every existing caller sends', () => {
    const parsed = parsePipelineRunInput(runInput({
      dataPipelineDefinitionId: DATA_PIPELINE_DEFINITION_ID,
      executionContractId: EXECUTION_CONTRACT_ID,
    }))
    expect(parsed.dataPipelineDefinitionId).toBe(DATA_PIPELINE_DEFINITION_ID)
    expect(parsed.executionContractId).toBe(EXECUTION_CONTRACT_ID)
  })

  it('makes stageById name its definition, with no default that would silently answer for the wrong one', () => {
    // A default of DATA_PIPELINE_DEFINITION_ID would return null for every
    // knowledge stage, and the caller at record-event time falls back to
    // `sequence: 0` on a null — a stage board silently out of order.
    expect(stageById(KNOWLEDGE_INGESTION_DEFINITION_ID, 'DPS-KI-CHUNK')).toMatchObject({ sequence: 70 })
    expect(stageById(DATA_PIPELINE_DEFINITION_ID, 'DPS-KI-CHUNK')).toBeNull()
    expect(() => stageById('DPS-KI-CHUNK')).toThrow()
  })
})
