import { describe, expect, it } from 'vitest'
import {
  DATA_PIPELINE_DEFINITION_ID,
  EXECUTION_CONTRACT_ID,
  IDENTITY_REFS_EMPTY,
  KNOWLEDGE_INGESTION_CONTRACT_ID,
  KNOWLEDGE_INGESTION_DEFINITION_ID,
  parsePipelineEvent,
} from '@/platform/integrations/core/pipeline-tracking-contract'
import {
  PUBLISH_STAGE_ID,
  detectGateViolations,
  gateCompliance,
} from '@/platform/integrations/core/pipeline-gate-compliance'

// @req FR-129 — the catalog publication approval gate: the evidence a signer
// acted on is carried by the envelope, and a publish that succeeded without a
// prior approval is detectable on the run's own ledger.
// @spec SDD-075, SDD-066, ADR-043 D2.1, ADR-050 D3
// @tested tests/unit/platform/fr129-catalog-publication-gate.test.js
//
// The database half of this requirement — evidenceJson actually round-tripping
// through a real column and read model — is
// tests/integration/fr129-catalog-publication-gate.test.js, because the fake
// db in the service suite stores objects and would keep passing if the write
// path stopped serializing to text at all.

const EVIDENCE = Object.freeze({
  catalogVersion: 'CAT-2026-08-30-001',
  artifactSha256: 'c'.repeat(64),
  addedCount: 12,
  changedCount: 3,
  unchangedCount: 480,
})

function gateEvent(over = {}) {
  return {
    eventType: 'GATE_UPDATED',
    dataPipelineDefinitionId: DATA_PIPELINE_DEFINITION_ID,
    executionContractId: EXECUTION_CONTRACT_ID,
    executionRunId: 'run-fr129',
    pipelineStageId: null,
    executionStepId: null,
    attemptId: null,
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
    sequence: null,
    status: 'APPROVED',
    correlationId: 'corr-fr129',
    idempotencyKey: 'gate-fr129-1',
    inputHash: null,
    outputHash: null,
    tagIds: [],
    identityRefs: { ...IDENTITY_REFS_EMPTY },
    failureCode: null,
    errorRef: null,
    retryable: null,
    reconciliation: null,
    gate: {
      gateId: 'GATE-CATALOG-PUBLISH',
      status: 'APPROVED',
      required: true,
      decidedByPersonId: 'person-1',
      reason: null,
      evidence: { ...EVIDENCE },
    },
    ...over,
  }
}

describe('FR-129 / SDD-075 — the gate envelope carries the reviewer’s evidence', () => {
  it('accepts an approval whose evidence is the declared shape', () => {
    const parsed = parsePipelineEvent(gateEvent())
    expect(parsed.gate.evidence).toEqual({ ...EVIDENCE })
  })

  // The defect SDD-075 names. Before this member existed the envelope was a
  // five-field .strict() object, so this exact payload was REFUSED and the
  // column could never be written.
  it('refuses an approval that carries no evidence at all', () => {
    const event = gateEvent()
    delete event.gate.evidence
    expect(() => parsePipelineEvent(event)).toThrow(/requires the evidence it was decided on/)
  })

  // SEC-001/append-only: the column is under FORCE ROW LEVEL SECURITY and
  // cannot be un-written. A strict object is what stops it becoming the place
  // rows leak into.
  it('refuses evidence carrying anything beyond the declared members', () => {
    expect(() => parsePipelineEvent(gateEvent({
      gate: {
        gateId: null,
        status: 'APPROVED',
        required: true,
        decidedByPersonId: 'person-1',
        reason: null,
        evidence: { ...EVIDENCE, customerName: 'สมชาย', rows: [{ sku: 'A-1' }] },
      },
    }))).toThrow()
  })

  it('refuses an approval whose evidence names no publication', () => {
    const evidence = { ...EVIDENCE }
    delete evidence.catalogVersion
    expect(() => parsePipelineEvent(gateEvent({
      gate: {
        gateId: null, status: 'APPROVED', required: true, decidedByPersonId: 'p', reason: null, evidence,
      },
    }))).toThrow()
  })

  // FR-129 (b) constrains the signature, not the refusal: a rejection's
  // account is its `reason`, and a run that produced no candidate has no
  // counts to show.
  it('asks no evidence of REJECTED, WAIVED or PENDING decisions', () => {
    for (const status of ['REJECTED', 'WAIVED', 'PENDING']) {
      const parsed = parsePipelineEvent(gateEvent({
        status,
        idempotencyKey: `gate-fr129-${status}`,
        gate: {
          gateId: null,
          status,
          required: status !== 'WAIVED',
          decidedByPersonId: 'person-1',
          reason: status === 'REJECTED' ? 'counts disagree with the artifact' : null,
        },
      }))
      expect(parsed.gate.status).toBe(status)
      expect(parsed.gate.evidence).toBeUndefined()
    }
  })

  // FR-129 §2. The schema cannot say this: `decidedByPersonId` is `String?`
  // with no `Person` relation, so an anonymous approval is writable at the
  // database. Refusing one decides nothing about WHO may sign.
  it('refuses an APPROVED or REJECTED decision that names nobody', () => {
    for (const status of ['APPROVED', 'REJECTED']) {
      expect(() => parsePipelineEvent(gateEvent({
        status,
        idempotencyKey: `gate-fr129-anon-${status}`,
        gate: {
          gateId: null,
          status,
          required: true,
          decidedByPersonId: null,
          reason: 'counts disagree with the artifact',
          ...(status === 'APPROVED' ? { evidence: { ...EVIDENCE } } : {}),
        },
      }))).toThrow(/names the person who made it/)
    }
  })

  it('refuses a REJECTED decision that gives no reason', () => {
    expect(() => parsePipelineEvent(gateEvent({
      status: 'REJECTED',
      idempotencyKey: 'gate-fr129-silent-reject',
      gate: { gateId: null, status: 'REJECTED', required: true, decidedByPersonId: 'person-1', reason: null },
    }))).toThrow(/requires a reason/)
  })

  // PENDING is the gate awaiting a decision, and whether a waiver is a
  // person's act is part of the open `required` question.
  it('leaves PENDING and WAIVED unconstrained on both counts', () => {
    for (const status of ['PENDING', 'WAIVED']) {
      const parsed = parsePipelineEvent(gateEvent({
        status,
        idempotencyKey: `gate-fr129-open-${status}`,
        gate: { gateId: null, status, required: false, decidedByPersonId: null, reason: null },
      }))
      expect(parsed.gate.decidedByPersonId).toBeNull()
    }
  })

  // SDD-066 — the six tables are definition-neutral and FR-110's Stage 17 gate
  // shares this table. FR-129's evidence rule is scoped to FR-129's definition
  // and must not silently become a rule for the other requirement.
  it('does not impose FR-129’s evidence on the knowledge pipeline’s own gate', () => {
    const parsed = parsePipelineEvent(gateEvent({
      dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
      executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
      gate: { gateId: null, status: 'APPROVED', required: true, decidedByPersonId: 'p', reason: null },
    }))
    expect(parsed.gate.evidence).toBeUndefined()
  })
})

const publishStep = (over = {}) => ({
  pipelineStageId: PUBLISH_STAGE_ID,
  status: 'SUCCEEDED',
  executionStepId: 'step-publish-1',
  attemptId: 'attempt-publish-1',
  startedAt: '2026-08-30T10:00:00.000Z',
  finishedAt: '2026-08-30T10:05:00.000Z',
  createdAt: '2026-08-30T09:59:00.000Z',
  ...over,
})

const approval = (createdAt) => ({ status: 'APPROVED', createdAt, decidedByPersonId: 'person-1' })

describe('FR-129 — a publish without a prior approval is detectable', () => {
  const base = { dataPipelineDefinitionId: DATA_PIPELINE_DEFINITION_ID }

  it('fires on a succeeded publish with no gate decision at all', () => {
    const violations = detectGateViolations({ ...base, steps: [publishStep()], gates: [] })
    expect(violations).toHaveLength(1)
    expect(violations[0].code).toBe('PUBLISH_WITHOUT_APPROVAL')
    expect(violations[0].executionStepId).toBe('step-publish-1')
    expect(violations[0].approvalsAfterPublish).toBe(0)
  })

  it('stays silent when the approval preceded the publish', () => {
    const violations = detectGateViolations({
      ...base,
      steps: [publishStep()],
      gates: [approval('2026-08-30T09:30:00.000Z')],
    })
    expect(violations).toEqual([])
  })

  // The case an existence check gets wrong. A row saying APPROVED is present,
  // and the catalog was published before anybody signed it.
  it('fires when the only approval was recorded after the publish succeeded', () => {
    const violations = detectGateViolations({
      ...base,
      steps: [publishStep()],
      gates: [approval('2026-08-30T10:30:00.000Z')],
    })
    expect(violations).toHaveLength(1)
    expect(violations[0].approvalsAfterPublish).toBe(1)
  })

  // The unmade product decision — whether a gate is required per definition or
  // per run — is not answered here. A waiver is reported and named, not
  // silently accepted.
  it('reports a waived-only run and shows the reader it was a waiver', () => {
    const violations = detectGateViolations({
      ...base,
      steps: [publishStep()],
      gates: [{ status: 'WAIVED', createdAt: '2026-08-30T09:30:00.000Z' }, { status: 'PENDING', createdAt: '2026-08-30T09:00:00.000Z' }],
    })
    expect(violations).toHaveLength(1)
    expect(violations[0].observedGateStatuses).toEqual(['PENDING', 'WAIVED'])
  })

  it('ignores a publish step that did not succeed', () => {
    for (const status of ['NOT_STARTED', 'RUNNING', 'FAILED', 'SKIPPED', 'REPLAYING']) {
      expect(detectGateViolations({ ...base, steps: [publishStep({ status })], gates: [] })).toEqual([])
    }
  })

  it('ignores every stage that is not the publish stage', () => {
    expect(detectGateViolations({
      ...base,
      steps: [publishStep({ pipelineStageId: 'DPS-SUPABASE-APPLY' })],
      gates: [],
    })).toEqual([])
  })

  // SDD-071 — (runId, pipelineStageId) is not unique, so a run can hold more
  // than one publish row. Collapsing to the latest would hide the first.
  it('reports each unapproved publish row, not one per stage', () => {
    const violations = detectGateViolations({
      ...base,
      steps: [
        publishStep({ executionStepId: 'step-publish-1', finishedAt: '2026-08-30T10:05:00.000Z' }),
        publishStep({ executionStepId: 'step-publish-2', finishedAt: '2026-08-30T11:05:00.000Z' }),
      ],
      gates: [approval('2026-08-30T10:30:00.000Z')],
    })
    expect(violations.map((violation) => violation.executionStepId)).toEqual(['step-publish-1'])
  })

  // The knowledge lane's gate is FR-110's, about a different artifact. An
  // FR-129 violation reported against it would be the union-catalog mistake
  // relocated into the reporting layer.
  it('says nothing about a knowledge ingestion run', () => {
    const compliance = gateCompliance({
      dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
      steps: [publishStep()],
      gates: [],
    })
    expect(compliance.gated).toBe(false)
    expect(compliance.publishStageId).toBeNull()
    expect(compliance.violations).toEqual([])
  })

  it('never claims to enforce', () => {
    expect(gateCompliance({ ...base, steps: [], gates: [] }).enforced).toBe(false)
  })
})
