import { describe, expect, it } from 'vitest'
import {
  KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS,
  KNOWLEDGE_INGESTION_STAGE_CATALOG,
  KNOWLEDGE_QUALITY_GATE_STAGE_ID,
} from '@/platform/integrations/core/pipeline-tracking-contract'
import {
  KNOWLEDGE_JOB_STATES,
  KNOWLEDGE_TIER1_STAGE_IDS,
  knowledgeJobState,
  knowledgeRunOutcome,
  latestKnowledgeGate,
} from '@/modules/knowledge/ingestion-job'

// @req FR-109 — the §5 job lifecycle is derived from ledger facts alone and
// never infers PUBLISHED from elapsed time or a heartbeat (AC-109.11).
// @req FR-110 — a run closes only from what was reported, and PUBLISHED needs
// a closed run behind an approved Stage 17 gate with a publishable verdict.
// @spec ADR-067 D3, ADR-067 D4, ADR-050 D2, SDD-057
// @tested tests/unit/knowledge-ingestion-job-state.test.js

const TIER1 = KNOWLEDGE_TIER1_STAGE_IDS
const EXTERNAL = KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS
const GATE_STAGE = KNOWLEDGE_QUALITY_GATE_STAGE_ID

function board(statusById = {}, extra = {}) {
  return KNOWLEDGE_INGESTION_STAGE_CATALOG.map(({ pipelineStageId, sequence }) => ({
    pipelineStageId,
    sequence,
    status: statusById[pipelineStageId] || 'NOT_STARTED',
    retryable: extra[pipelineStageId]?.retryable ?? null,
    createdAt: '2026-09-07T00:00:00.000Z',
  }))
}

const allOf = (ids, status) => Object.fromEntries(ids.map((id) => [id, status]))
const tier1Done = () => allOf(TIER1, 'SUCCEEDED')
const externalDone = () => ({ ...tier1Done(), ...allOf(EXTERNAL, 'SUCCEEDED') })
const everythingDone = () => ({ ...externalDone(), [GATE_STAGE]: 'SUCCEEDED' })

const gate = (status, verdict, over = {}) => ({
  status,
  createdAt: '2026-09-07T01:00:00.000Z',
  evidence: verdict
    ? { verdict, snapshot: verdict.startsWith('PASS') ? { knowledge_snapshot_id: 'ks_1' } : null, dimensions: {} }
    : {},
  ...over,
})

describe('FR-109 AC-109.11 — job state is derived from ledger facts and never from time', () => {
  it('declares the nine §5 states and takes no clock, so PUBLISHED cannot come from a heartbeat', () => {
    expect(KNOWLEDGE_JOB_STATES).toEqual([
      'RECEIVED', 'PROCESSING', 'VALIDATING', 'READY_TO_PUBLISH', 'PUBLISHED',
      'RETRYABLE_FAILED', 'QUARANTINED', 'REJECTED', 'SUPERSEDED',
    ])
    expect(TIER1).toEqual([
      'DPS-KI-PARSE', 'DPS-KI-PROVENANCE', 'DPS-KI-NORMALIZE', 'DPS-KI-CLASSIFY',
      'DPS-KI-DEDUPE', 'DPS-KI-CHUNK', 'DPS-KI-ENTITY-EXTRACT',
    ])
    // The signature is the proof: one argument, no `now`, no freshness, no heartbeat.
    expect(knowledgeJobState.length).toBe(1)
    expect(knowledgeJobState({ ledgerStatus: 'RUNNING', stages: board(everythingDone()), gates: [gate('APPROVED', 'PASS')] }).state)
      .toBe('READY_TO_PUBLISH')
  })

  it('walks RECEIVED → PROCESSING → VALIDATING → READY_TO_PUBLISH → PUBLISHED on evidence alone', () => {
    expect(knowledgeJobState({ ledgerStatus: 'QUEUED', stages: board(), gates: [] }))
      .toMatchObject({ state: 'RECEIVED', reason: 'NO_STAGE_EVIDENCE' })
    expect(knowledgeJobState({ ledgerStatus: 'RUNNING', stages: board({ 'DPS-KI-PARSE': 'RUNNING' }), gates: [] }).state)
      .toBe('PROCESSING')
    expect(knowledgeJobState({ ledgerStatus: 'RUNNING', stages: board(tier1Done()), gates: [] }).state)
      .toBe('PROCESSING')
    expect(knowledgeJobState({ ledgerStatus: 'RUNNING', stages: board(externalDone()), gates: [] }))
      .toMatchObject({ state: 'VALIDATING', reason: 'EXTERNAL_STAGES_COMPLETE' })
    expect(knowledgeJobState({ ledgerStatus: 'RUNNING', stages: board({ ...tier1Done(), [GATE_STAGE]: 'RUNNING' }), gates: [] }))
      .toMatchObject({ state: 'VALIDATING', reason: 'QUALITY_GATE_RUNNING' })
    expect(knowledgeJobState({ ledgerStatus: 'RUNNING', stages: board(everythingDone()), gates: [gate('APPROVED', 'PASS_WITH_WARNINGS')] }))
      .toMatchObject({ state: 'READY_TO_PUBLISH', gate: { status: 'APPROVED', verdict: 'PASS_WITH_WARNINGS', snapshotId: 'ks_1' } })
    expect(knowledgeJobState({ ledgerStatus: 'SUCCEEDED', stages: board(everythingDone()), gates: [gate('APPROVED', 'PASS')] }))
      .toMatchObject({ state: 'PUBLISHED', reason: 'RUN_SUCCEEDED_BEHIND_APPROVED_GATE' })
  })

  it('never reports PUBLISHED without an approved gate, whatever the run row says', () => {
    expect(knowledgeJobState({ ledgerStatus: 'SUCCEEDED', stages: board(everythingDone()), gates: [] }))
      .toMatchObject({ state: 'VALIDATING', reason: 'RUN_SUCCEEDED_WITHOUT_APPROVED_GATE' })
    expect(knowledgeJobState({ ledgerStatus: 'SUCCEEDED', stages: board(everythingDone()), gates: [gate('PENDING', null)] }))
      .toMatchObject({ state: 'VALIDATING', reason: 'GATE_PENDING' })
    expect(knowledgeJobState({ ledgerStatus: 'RUNNING', stages: board(everythingDone()), gates: [gate('WAIVED', null)] }))
      .toMatchObject({ state: 'VALIDATING', reason: 'GATE_WAIVED' })
  })

  it('maps the failure states: Tier 1 failure quarantines, external failure follows retryable, the verdict decides held vs rejected', () => {
    expect(knowledgeJobState({ ledgerStatus: 'RUNNING', stages: board({ 'DPS-KI-PARSE': 'SUCCEEDED', 'DPS-KI-PROVENANCE': 'FAILED' }), gates: [] }))
      .toMatchObject({ state: 'QUARANTINED', reason: 'TIER1_STAGE_FAILED:DPS-KI-PROVENANCE', failedStage: 'DPS-KI-PROVENANCE' })
    expect(knowledgeJobState({
      ledgerStatus: 'RUNNING',
      stages: board({ ...tier1Done(), 'DPS-KI-ENTITY-RESOLVE': 'FAILED' }, { 'DPS-KI-ENTITY-RESOLVE': { retryable: true } }),
      gates: [],
    })).toMatchObject({ state: 'RETRYABLE_FAILED', failedStage: 'DPS-KI-ENTITY-RESOLVE' })
    expect(knowledgeJobState({
      ledgerStatus: 'RUNNING',
      stages: board({ ...tier1Done(), 'DPS-KI-EMBED': 'FAILED' }, { 'DPS-KI-EMBED': { retryable: false } }),
      gates: [],
    })).toMatchObject({ state: 'QUARANTINED', reason: 'STAGE_FAILED:DPS-KI-EMBED' })
    expect(knowledgeJobState({ ledgerStatus: 'RUNNING', stages: board(everythingDone()), gates: [gate('REJECTED', 'QUARANTINE')] }))
      .toMatchObject({ state: 'QUARANTINED', reason: 'GATE_VERDICT_QUARANTINE' })
    expect(knowledgeJobState({ ledgerStatus: 'FAILED', stages: board(everythingDone()), gates: [gate('REJECTED', 'FAIL')] }))
      .toMatchObject({ state: 'REJECTED', reason: 'GATE_VERDICT_FAIL' })
    // An FR-071 rejection written without knowledge evidence still rejects.
    expect(knowledgeJobState({ ledgerStatus: 'RUNNING', stages: board(everythingDone()), gates: [gate('REJECTED', null)] }))
      .toMatchObject({ state: 'REJECTED', reason: 'GATE_REJECTED' })
    expect(knowledgeJobState({ ledgerStatus: 'CANCELLED', stages: board(tier1Done()), gates: [] }))
      .toMatchObject({ state: 'REJECTED', reason: 'RUN_CANCELLED_WITHOUT_PUBLICATION' })
  })

  it('reads the newest decision carrying Stage 17 evidence over a newer one without it', () => {
    const later = gate('PENDING', null, { createdAt: '2026-09-07T02:00:00.000Z' })
    expect(latestKnowledgeGate([later, gate('APPROVED', 'PASS')])).toEqual({ status: 'APPROVED', verdict: 'PASS', snapshotId: 'ks_1' })
    expect(latestKnowledgeGate([])).toBeNull()
    expect(latestKnowledgeGate([later])).toEqual({ status: 'PENDING', verdict: null, snapshotId: null })
  })

  it('treats Stage 1 as out of band — a NOT_STARTED ingest row blocks nothing', () => {
    const stages = board(everythingDone())
    expect(stages.find((s) => s.pipelineStageId === 'DPS-KI-INGEST').status).toBe('NOT_STARTED')
    expect(knowledgeRunOutcome({ stages, gates: [gate('APPROVED', 'PASS')] })).toMatchObject({ status: 'SUCCEEDED', blocking: [] })
  })
})

describe('FR-110 / ADR-067 D3 — the run outcome is derived, and names what is still owed', () => {
  it('closes SUCCEEDED only when every executed stage succeeded behind an approved, publishable gate', () => {
    expect(knowledgeRunOutcome({ stages: board(everythingDone()), gates: [gate('APPROVED', 'PASS')] }).status).toBe('SUCCEEDED')
    expect(knowledgeRunOutcome({ stages: board(everythingDone()), gates: [gate('APPROVED', 'PASS_WITH_WARNINGS')] }).status).toBe('SUCCEEDED')
  })

  it('refuses to close while stages have no evidence, and lists exactly which', () => {
    const outcome = knowledgeRunOutcome({ stages: board(tier1Done()), gates: [] })
    expect(outcome.status).toBeNull()
    expect(outcome.blocking).toEqual([
      ...EXTERNAL.map((id) => `STAGE_NOT_SUCCEEDED:${id}`),
      `STAGE_NOT_SUCCEEDED:${GATE_STAGE}`,
      'GATE_MISSING',
    ])
    expect(knowledgeRunOutcome({ stages: board(everythingDone()), gates: [gate('PENDING', null)] }).blocking).toEqual(['GATE_PENDING'])
    expect(knowledgeRunOutcome({ stages: board(everythingDone()), gates: [gate('WAIVED', null)] }).blocking).toEqual(['GATE_WAIVED_IS_NOT_A_VERDICT'])
  })

  it('closes FAILED on any failed stage or a rejected gate, even with other stages unreported', () => {
    expect(knowledgeRunOutcome({ stages: board({ 'DPS-KI-PARSE': 'SUCCEEDED', 'DPS-KI-PROVENANCE': 'FAILED' }), gates: [] }))
      .toMatchObject({ status: 'FAILED', failureCode: 'KI_STAGE_FAILED:DPS-KI-PROVENANCE', failedStage: 'DPS-KI-PROVENANCE' })
    expect(knowledgeRunOutcome({ stages: board({ ...tier1Done(), 'DPS-KI-INDEX': 'FAILED' }), gates: [] }))
      .toMatchObject({ status: 'FAILED', failureCode: 'KI_STAGE_FAILED:DPS-KI-INDEX' })
    expect(knowledgeRunOutcome({ stages: board(everythingDone()), gates: [gate('REJECTED', 'FAIL')] }))
      .toMatchObject({ status: 'FAILED', failureCode: 'KI_GATE_REJECTED:FAIL', failedStage: null })
    expect(knowledgeRunOutcome({ stages: board(externalDone()), gates: [gate('REJECTED', 'QUARANTINE')] }).failureCode)
      .toBe('KI_GATE_REJECTED:QUARANTINE')
  })
})
