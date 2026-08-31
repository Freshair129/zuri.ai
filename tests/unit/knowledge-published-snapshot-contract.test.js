import { describe, expect, it } from 'vitest'

import {
  DATA_PIPELINE_DEFINITION_ID,
  EXECUTION_CONTRACT_ID,
  GATE_STATUSES,
  IDENTITY_REFS_EMPTY,
  KNOWLEDGE_INGESTION_CONTRACT_ID,
  KNOWLEDGE_INGESTION_DEFINITION_ID,
  KNOWLEDGE_QUALITY_GATE_STAGE_ID,
  parsePipelineEvent,
} from '@/platform/integrations/core/pipeline-tracking-contract'
import {
  KNOWLEDGE_GATE_VERDICTS,
  KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS,
  parseKnowledgeStage17Decision,
  parseKnowledgeStage17Evidence,
  parseKnowledgeStageReport,
  parseKnowledgeSnapshot,
  toKnowledgeStage17Evidence,
  evaluateKnowledgePublication,
} from '@/modules/knowledge/published-snapshot-contract'

// @req FR-110 — a published knowledge corpus is identified by one strict,
// scope-bound snapshot and Stage 17's quality result is auditable evidence.
// @spec SDD-057, ADR-042, ADR-043 D2.1, ADR-046, ADR-050 D3-D5,
// docs/domains/knowledge/features/FR-110-published-knowledge-snapshot-contract.md
// @tested tests/unit/knowledge-published-snapshot-contract.test.js

const SNAPSHOT = {
  knowledge_snapshot_id: 'ks_20260831_001',
  tenant_id: 'tenant-1',
  business_id: 'business-1',
  ontology_version: 'ontology-1',
  pipeline_version: 'pipeline-1',
  published_at: '2026-08-31T00:00:00.000Z',
  statistics: {
    documents: 4,
    chunks: 12,
    entities: 8,
    facts: 16,
    relations: 10,
  },
}

const DIMENSIONS = {
  data: { result: 'PASS', critical: false },
  graph: { result: 'PASS', critical: false },
  knowledge: { result: 'PASS', critical: false },
  security: { result: 'PASS', critical: false },
  retrieval: { result: 'PASS', critical: false },
}

function stageReport(over = {}) {
  return {
    dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
    executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
    executionRunId: 'run-knowledge-1',
    pipelineStageId: 'DPS-KI-ENTITY-RESOLVE',
    executionStepId: 'step-knowledge-1',
    attemptId: 'attempt-knowledge-1',
    scope: { tenantId: 'tenant-1', businessId: 'business-1' },
    metrics: {
      records_in: 10,
      records_out: 9,
      records_failed: 1,
      records_quarantined: 1,
      processing_time: 125.5,
      retry_count: 0,
    },
    ...over,
  }
}

function stage17Decision(over = {}) {
  return {
    dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
    executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
    executionRunId: 'run-knowledge-1',
    pipelineStageId: KNOWLEDGE_QUALITY_GATE_STAGE_ID,
    executionStepId: 'step-quality-gate-1',
    attemptId: 'attempt-quality-gate-1',
    scope: { tenantId: 'tenant-1', businessId: 'business-1' },
    ledgerStatus: 'APPROVED',
    verdict: 'PASS',
    snapshot: { ...SNAPSHOT, statistics: { ...SNAPSHOT.statistics } },
    dimensions: structuredClone(DIMENSIONS),
    ...over,
  }
}

function pipelineGateEvent(over = {}) {
  return {
    eventType: 'GATE_UPDATED',
    dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
    executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
    executionRunId: 'run-knowledge-1',
    tenantId: 'tenant-1',
    businessId: 'business-1',
    pipelineStageId: KNOWLEDGE_QUALITY_GATE_STAGE_ID,
    executionStepId: 'step-quality-gate-1',
    attemptId: 'attempt-quality-gate-1',
    pipelineRecordId: null,
    sourceRecordKey: null,
    sourceRowNumber: null,
    sourceSha256: null,
    docId: null,
    picId: null,
    factId: null,
    sourceDocIds: [],
    sourcePicIds: [],
    destinationRecordId: null,
    sequence: 170,
    status: 'APPROVED',
    correlationId: 'corr-knowledge-1',
    idempotencyKey: 'gate-knowledge-1',
    inputHash: null,
    outputHash: null,
    tagIds: [],
    identityRefs: { ...IDENTITY_REFS_EMPTY },
    failureCode: null,
    errorRef: null,
    retryable: null,
    reconciliation: null,
    gate: {
      gateId: 'GATE-KNOWLEDGE-QUALITY',
      status: 'APPROVED',
      required: true,
      decidedByPersonId: 'person-1',
      reason: null,
      evidence: toKnowledgeStage17Evidence(stage17Decision()),
    },
    ...over,
  }
}

describe('FR-110 / KNO-01 — Stage 9–16 external evidence is control metadata plus counters', () => {
  it('exposes exactly the eight external stage ids and excludes Tier 1 and Stage 17', () => {
    expect(KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS).toEqual([
      'DPS-KI-ENTITY-RESOLVE',
      'DPS-KI-FACT-EXTRACT',
      'DPS-KI-ONTOLOGY-MAP',
      'DPS-KI-TEMPORAL-MAP',
      'DPS-KI-GRAPH-BUILD',
      'DPS-KI-ENRICH',
      'DPS-KI-EMBED',
      'DPS-KI-INDEX',
    ])
    expect(KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS).not.toContain('DPS-KI-PARSE')
    expect(KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS).not.toContain(KNOWLEDGE_QUALITY_GATE_STAGE_ID)
  })

  it('accepts a definition-scoped report with run, stage, attempt, scope and all counters', () => {
    const parsed = parseKnowledgeStageReport(stageReport())
    expect(parsed.dataPipelineDefinitionId).toBe(KNOWLEDGE_INGESTION_DEFINITION_ID)
    expect(parsed.executionContractId).toBe(KNOWLEDGE_INGESTION_CONTRACT_ID)
    expect(parsed.scope).toEqual({ tenantId: 'tenant-1', businessId: 'business-1' })
    expect(parsed.metrics).toEqual(stageReport().metrics)
  })

  it('rejects the wrong definition, contract, stage, scope and incomplete control identity', () => {
    expect(() => parseKnowledgeStageReport(stageReport({
      dataPipelineDefinitionId: DATA_PIPELINE_DEFINITION_ID,
    }))).toThrow()
    expect(() => parseKnowledgeStageReport(stageReport({
      executionContractId: EXECUTION_CONTRACT_ID,
    }))).toThrow()
    expect(() => parseKnowledgeStageReport(stageReport({ pipelineStageId: 'DPS-KI-PARSE' }))).toThrow()
    expect(() => parseKnowledgeStageReport(stageReport({ pipelineStageId: KNOWLEDGE_QUALITY_GATE_STAGE_ID }))).toThrow()
    expect(() => parseKnowledgeStageReport(stageReport({ scope: { tenantId: 'tenant-1' } }))).toThrow()
    for (const field of ['executionRunId', 'executionStepId', 'attemptId']) {
      const value = stageReport()
      delete value[field]
      expect(() => parseKnowledgeStageReport(value)).toThrow()
    }
  })

  it('rejects negative, fractional or nonfinite counters and durations', () => {
    for (const field of ['records_in', 'records_out', 'records_failed', 'records_quarantined', 'retry_count']) {
      expect(() => parseKnowledgeStageReport(stageReport({
        metrics: { ...stageReport().metrics, [field]: -1 },
      }))).toThrow()
      expect(() => parseKnowledgeStageReport(stageReport({
        metrics: { ...stageReport().metrics, [field]: Number.POSITIVE_INFINITY },
      }))).toThrow()
      expect(() => parseKnowledgeStageReport(stageReport({
        metrics: { ...stageReport().metrics, [field]: 1.5 },
      }))).toThrow()
    }
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => parseKnowledgeStageReport(stageReport({
        metrics: { ...stageReport().metrics, processing_time: value },
      }))).toThrow()
    }
  })

  it('rejects payload, entity, fact, embedding, index and receipt data at every evidence object', () => {
    const forbidden = ['payload', 'entity', 'fact', 'embedding', 'index', 'receipts', 'receipt']
    for (const field of forbidden) {
      expect(() => parseKnowledgeStageReport(stageReport({ [field]: {} }))).toThrow()
      expect(() => parseKnowledgeStageReport(stageReport({
        metrics: { ...stageReport().metrics, [field]: {} },
      }))).toThrow()
      expect(() => parseKnowledgeStageReport(stageReport({
        scope: { tenantId: 'tenant-1', businessId: 'business-1', [field]: {} },
      }))).toThrow()
    }
  })
})

describe('FR-110 — the published snapshot is a closed, nonnegative allowlist', () => {
  it('accepts the seven identity/time fields and five object statistics', () => {
    expect(parseKnowledgeSnapshot({ ...SNAPSHOT, statistics: { ...SNAPSHOT.statistics } })).toEqual(SNAPSHOT)
  })

  it('rejects fields outside the FR-110 snapshot contract, including spec recommendations not declared here', () => {
    for (const field of [
      'pipeline_job_id',
      'index_generation',
      'payload',
      'entities_payload',
      'facts',
      'embedding',
      'index',
      'receipts',
    ]) {
      expect(() => parseKnowledgeSnapshot({ ...SNAPSHOT, [field]: field })).toThrow()
    }
    expect(() => parseKnowledgeSnapshot({
      ...SNAPSHOT,
      statistics: { ...SNAPSHOT.statistics, payload: {} },
    })).toThrow()
  })

  it('rejects incomplete identity/time/statistics and invalid counts', () => {
    for (const field of [
      'knowledge_snapshot_id',
      'tenant_id',
      'business_id',
      'ontology_version',
      'pipeline_version',
      'published_at',
      'statistics',
    ]) {
      const value = { ...SNAPSHOT }
      delete value[field]
      expect(() => parseKnowledgeSnapshot(value)).toThrow()
    }
    for (const field of Object.keys(SNAPSHOT.statistics)) {
      expect(() => parseKnowledgeSnapshot({
        ...SNAPSHOT,
        statistics: { ...SNAPSHOT.statistics, [field]: -1 },
      })).toThrow()
      expect(() => parseKnowledgeSnapshot({
        ...SNAPSHOT,
        statistics: { ...SNAPSHOT.statistics, [field]: Number.NaN },
      })).toThrow()
      expect(() => parseKnowledgeSnapshot({
        ...SNAPSHOT,
        statistics: { ...SNAPSHOT.statistics, [field]: Number.POSITIVE_INFINITY },
      })).toThrow()
    }
    expect(() => parseKnowledgeSnapshot({ ...SNAPSHOT, published_at: 'not-a-date' })).toThrow()
  })
})

describe('FR-110 — Stage 17 evidence keeps quality verdict, snapshot and five dimensions explicit', () => {
  it('accepts a complete PASS evidence object and exposes only the declared dimensions', () => {
    const evidence = toKnowledgeStage17Evidence(stage17Decision())
    expect(parseKnowledgeStage17Evidence(evidence)).toEqual(evidence)
    expect(KNOWLEDGE_GATE_VERDICTS).toEqual(['PASS', 'PASS_WITH_WARNINGS', 'QUARANTINE', 'FAIL'])
    expect(Object.keys(evidence.dimensions)).toEqual(['data', 'graph', 'knowledge', 'security', 'retrieval'])
  })

  it('requires a snapshot for a publishable verdict and rejects unknown evidence fields', () => {
    for (const verdict of ['PASS', 'PASS_WITH_WARNINGS']) {
      expect(() => parseKnowledgeStage17Evidence({
        ...toKnowledgeStage17Evidence(stage17Decision()),
        verdict,
        snapshot: null,
      })).toThrow()
    }
    for (const field of ['payload', 'entity', 'fact', 'embedding', 'index', 'receipts']) {
      expect(() => parseKnowledgeStage17Evidence({
        ...toKnowledgeStage17Evidence(stage17Decision()),
        [field]: {},
      })).toThrow()
      expect(() => parseKnowledgeStage17Evidence({
        ...toKnowledgeStage17Evidence(stage17Decision()),
        snapshot: { ...SNAPSHOT, [field]: {} },
      })).toThrow()
      expect(() => parseKnowledgeStage17Evidence({
        ...toKnowledgeStage17Evidence(stage17Decision()),
        dimensions: {
          ...DIMENSIONS,
          security: { ...DIMENSIONS.security, [field]: {} },
        },
      })).toThrow()
    }
  })

  it('accepts a held QUARANTINE or FAIL decision without pretending it was published', () => {
    for (const verdict of ['QUARANTINE', 'FAIL']) {
      const evidence = parseKnowledgeStage17Evidence({
        ...toKnowledgeStage17Evidence(stage17Decision()),
        verdict,
        snapshot: null,
      })
      expect(evidence.verdict).toBe(verdict)
      expect(evidence.snapshot).toBeNull()
    }
  })

  it('requires all five dimensions and a closed scalar result per dimension', () => {
    const evidence = toKnowledgeStage17Evidence(stage17Decision())
    for (const field of ['data', 'graph', 'knowledge', 'security', 'retrieval']) {
      const dimensions = { ...evidence.dimensions }
      delete dimensions[field]
      expect(() => parseKnowledgeStage17Evidence({ ...evidence, dimensions })).toThrow()
    }
    expect(() => parseKnowledgeStage17Evidence({
      ...evidence,
      dimensions: { ...evidence.dimensions, security: { result: 'PASS', critical: 'false' } },
    })).toThrow()
    expect(() => parseKnowledgeStage17Evidence({
      ...evidence,
      dimensions: { ...evidence.dimensions, security: { result: 'PASS', critical: false, payload: {} } },
    })).toThrow()
  })
})

describe('FR-110 — Stage 17 decision binds control scope and keeps ledger status separate', () => {
  it('accepts a complete decision and preserves the FR-071 ledger status independently of the verdict', () => {
    const parsed = parseKnowledgeStage17Decision(stage17Decision())
    expect(parsed.ledgerStatus).toBe('APPROVED')
    expect(parsed.verdict).toBe('PASS')
    expect(parsed.pipelineStageId).toBe(KNOWLEDGE_QUALITY_GATE_STAGE_ID)
  })

  it('accepts all and only the existing FR-071 gate statuses as ledgerStatus', () => {
    for (const status of GATE_STATUSES) {
      expect(parseKnowledgeStage17Decision(stage17Decision({ ledgerStatus: status })).ledgerStatus).toBe(status)
    }
    expect(() => parseKnowledgeStage17Decision(stage17Decision({ ledgerStatus: 'PASS' }))).toThrow()
    expect(() => parseKnowledgeStage17Decision(stage17Decision({ verdict: 'APPROVED' }))).toThrow()
  })

  it('rejects wrong definition, contract, stage, incomplete identity and snapshot scope mismatch', () => {
    expect(() => parseKnowledgeStage17Decision(stage17Decision({
      dataPipelineDefinitionId: DATA_PIPELINE_DEFINITION_ID,
    }))).toThrow()
    expect(() => parseKnowledgeStage17Decision(stage17Decision({
      executionContractId: EXECUTION_CONTRACT_ID,
    }))).toThrow()
    expect(() => parseKnowledgeStage17Decision(stage17Decision({ pipelineStageId: 'DPS-KI-INDEX' }))).toThrow()
    for (const field of ['executionRunId', 'executionStepId', 'attemptId', 'scope', 'dimensions', 'verdict']) {
      const value = stage17Decision()
      delete value[field]
      expect(() => parseKnowledgeStage17Decision(value)).toThrow()
    }
    expect(() => parseKnowledgeStage17Decision(stage17Decision({
      scope: { tenantId: 'tenant-2', businessId: 'business-1' },
    }))).toThrow()
  })

  it('round-trips only the allowlisted evidence into the existing FR-071 gate envelope', () => {
    const parsed = parsePipelineEvent(pipelineGateEvent())
    expect(parsed.gate.evidence).toEqual(toKnowledgeStage17Evidence(stage17Decision()))
  })

  it('rejects knowledge gate evidence on the wrong definition or wrong stage', () => {
    const evidence = toKnowledgeStage17Evidence(stage17Decision())
    expect(() => parsePipelineEvent(pipelineGateEvent({
      dataPipelineDefinitionId: DATA_PIPELINE_DEFINITION_ID,
      executionContractId: EXECUTION_CONTRACT_ID,
    }))).toThrow()
    expect(() => parsePipelineEvent(pipelineGateEvent({
      pipelineStageId: 'DPS-KI-INDEX',
    }))).toThrow()
    expect(() => parsePipelineEvent(pipelineGateEvent({
      gate: {
        ...pipelineGateEvent().gate,
        evidence: { ...evidence, payload: {} },
      },
    }))).toThrow()
    expect(() => parsePipelineEvent(pipelineGateEvent({
      gate: {
        ...pipelineGateEvent().gate,
        evidence: {
          catalogVersion: 'CAT-1',
          addedCount: 1,
          changedCount: 0,
          unchangedCount: 0,
        },
      },
    }))).toThrow()
  })

  it('binds the shared event scope to the snapshot and requires event scope IDs', () => {
    for (const field of ['tenantId', 'businessId']) {
      const value = pipelineGateEvent()
      delete value[field]
      expect(() => parsePipelineEvent(value)).toThrow()
    }
    expect(() => parsePipelineEvent(pipelineGateEvent({ tenantId: 'tenant-2' }))).toThrow()
    expect(() => parsePipelineEvent(pipelineGateEvent({ businessId: 'business-2' }))).toThrow()

    const evidence = toKnowledgeStage17Evidence(stage17Decision())
    expect(() => parsePipelineEvent(pipelineGateEvent({
      gate: {
        ...pipelineGateEvent().gate,
        evidence: {
          ...evidence,
          snapshot: { ...evidence.snapshot, tenant_id: 'tenant-2' },
        },
      },
    }))).toThrow()
  })

  it('rejects an APPROVED shared gate when the verdict or any dimension blocks publication', () => {
    const evidence = toKnowledgeStage17Evidence(stage17Decision())
    expect(() => parsePipelineEvent(pipelineGateEvent({
      gate: {
        ...pipelineGateEvent().gate,
        status: 'APPROVED',
        evidence: { ...evidence, verdict: 'FAIL', snapshot: null },
      },
    }))).toThrow()
    expect(() => parsePipelineEvent(pipelineGateEvent({
      gate: {
        ...pipelineGateEvent().gate,
        status: 'APPROVED',
        evidence: {
          ...evidence,
          dimensions: { ...evidence.dimensions, graph: { result: 'FAIL', critical: false } },
        },
      },
    }))).toThrow()
  })

  it('rejects catalog publication evidence on the knowledge definition', () => {
    expect(() => parsePipelineEvent(pipelineGateEvent({
      pipelineStageId: 'DPS-KI-INDEX',
      executionStepId: 'step-index-1',
      attemptId: 'attempt-index-1',
      gate: {
        ...pipelineGateEvent().gate,
        evidence: {
          catalogVersion: 'CAT-1',
          artifactSha256: null,
          addedCount: 1,
          changedCount: 0,
          unchangedCount: 0,
        },
      },
    }))).toThrow()
  })
})

describe('FR-110 — publication eligibility is necessary-condition policy evaluation', () => {
  it('allows PASS only with APPROVED ledger status, a complete snapshot and explicit policy allow', () => {
    const result = evaluateKnowledgePublication(stage17Decision(), { allowPublish: true })
    expect(result).toEqual({ allowed: true, reasons: [] })
  })

  it('allows PASS_WITH_WARNINGS only when policy explicitly allows it', () => {
    const result = evaluateKnowledgePublication(stage17Decision({ verdict: 'PASS_WITH_WARNINGS' }), { allowPublish: true })
    expect(result.allowed).toBe(true)
    expect(evaluateKnowledgePublication(stage17Decision({ verdict: 'PASS_WITH_WARNINGS' }), { allowPublish: false }).allowed)
      .toBe(false)
  })

  it('blocks missing or false policy, nonpublishable verdicts and non-approved ledger status', () => {
    expect(evaluateKnowledgePublication(stage17Decision()).allowed).toBe(false)
    expect(evaluateKnowledgePublication(stage17Decision(), { allowPublish: false }).allowed).toBe(false)
    for (const verdict of ['QUARANTINE', 'FAIL']) {
      const result = evaluateKnowledgePublication(stage17Decision({ verdict, snapshot: null }), { allowPublish: true })
      expect(result.allowed).toBe(false)
    }
    for (const ledgerStatus of ['PENDING', 'REJECTED', 'WAIVED']) {
      expect(evaluateKnowledgePublication(stage17Decision({ ledgerStatus }), { allowPublish: true }).allowed).toBe(false)
    }
  })

  it('blocks a critical security finding regardless of a PASS verdict or caller policy', () => {
    const dimensions = structuredClone(DIMENSIONS)
    dimensions.security = { result: 'FAIL', critical: true }
    const result = evaluateKnowledgePublication(stage17Decision({ dimensions }), { allowPublish: true })
    expect(result.allowed).toBe(false)
    expect(result.reasons).toContain('CRITICAL_SECURITY_FAILURE')
  })

  it('blocks any failed quality dimension even when the overall verdict is PASS', () => {
    for (const dimension of Object.keys(DIMENSIONS)) {
      const dimensions = structuredClone(DIMENSIONS)
      dimensions[dimension] = { result: 'FAIL', critical: false }
      const result = evaluateKnowledgePublication(stage17Decision({ dimensions }), { allowPublish: true })
      expect(result.allowed).toBe(false)
      expect(result.reasons).toContain('QUALITY_DIMENSION_BLOCKS_PUBLICATION')
    }
  })
})
