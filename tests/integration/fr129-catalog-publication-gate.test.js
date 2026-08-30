import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeOperatorViewer } from '../factories/viewer'
import {
  DATA_PIPELINE_DEFINITION_ID,
  EXECUTION_CONTRACT_ID,
  IDENTITY_REFS_EMPTY,
} from '@/platform/integrations/core/pipeline-tracking-contract'
import {
  createPipelineRun,
  getPipelineMonitor,
  recordPipelineEvent,
} from '@/platform/integrations/core/pipeline-tracking-service'

// @req FR-129 — proved against the real database rather than the service
// suite's fake: `evidenceJson` is untyped `text NOT NULL DEFAULT '{}'`, and a
// fake model that stores whatever object it is handed cannot tell a serialized
// column from an in-memory one. The write path could stop stringifying
// entirely and the unit suite would stay green.
// @spec SDD-075, SDD-071, ADR-043 D2.1, ADR-050 D3
// @tested tests/integration/fr129-catalog-publication-gate.test.js

let viewer
let businessId

const EVIDENCE = Object.freeze({
  catalogVersion: 'CAT-2026-08-30-REAL-DB',
  artifactSha256: 'd'.repeat(64),
  addedCount: 7,
  changedCount: 2,
  unchangedCount: 91,
})

function runInput(over = {}) {
  return {
    dataPipelineDefinitionId: DATA_PIPELINE_DEFINITION_ID,
    executionContractId: EXECUTION_CONTRACT_ID,
    businessId,
    sourceRef: 'duckdb://fr129/business-01',
    sourceSha256: 'e'.repeat(64),
    artifactRef: 'artifact://fr129/export.jsonl',
    artifactSha256: 'e'.repeat(64),
    expectedCount: 100,
    bootstrapBatchId: 'batch-fr129',
    correlationId: 'corr-fr129',
    idempotencyKey: 'run-fr129-1',
    identityRefs: { ...IDENTITY_REFS_EMPTY },
    tagIds: [],
    ...over,
  }
}

function event(over = {}) {
  return {
    eventType: 'STEP_SUCCEEDED',
    dataPipelineDefinitionId: DATA_PIPELINE_DEFINITION_ID,
    executionContractId: EXECUTION_CONTRACT_ID,
    executionRunId: null,
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
    status: 'SUCCEEDED',
    correlationId: 'corr-fr129-event',
    idempotencyKey: 'event-fr129-1',
    inputHash: null,
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

/** Drive this run's DPS-PUBLISH step to SUCCEEDED, the way a worker reports it. */
async function publish(executionRunId, key, at) {
  const step = await prisma.pipelineStep.findFirst({
    where: { run: { executionRunId }, pipelineStageId: 'DPS-PUBLISH' },
  })
  const common = {
    executionRunId,
    pipelineStageId: 'DPS-PUBLISH',
    executionStepId: step.executionStepId,
    attemptId: step.attemptId,
    sequence: 90,
  }
  await recordPipelineEvent(
    event({ ...common, eventType: 'STEP_STARTED', status: 'RUNNING', idempotencyKey: `${key}-start` }),
    { viewer, now: () => new Date(at) },
  )
  return recordPipelineEvent(
    event({ ...common, idempotencyKey: `${key}-success` }),
    { viewer, now: () => new Date(at) },
  )
}

async function decide(executionRunId, key, at, gate) {
  return recordPipelineEvent(event({
    eventType: 'GATE_UPDATED',
    executionRunId,
    status: gate.status,
    idempotencyKey: key,
    correlationId: `corr-${key}`,
    gate,
  }), { viewer, now: () => new Date(at) })
}

const approval = (over = {}) => ({
  gateId: 'GATE-CATALOG-PUBLISH',
  status: 'APPROVED',
  required: true,
  decidedByPersonId: 'person-fr129',
  reason: null,
  evidence: { ...EVIDENCE },
  ...over,
})

describe('FR-129 catalog publication approval gate, against the real database', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'FR129 Group', code: 'PF-FR129' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'FR129 Tenant', code: 'TNT-FR129' })
    const business = await createBusiness({ tenantId: tenant.id, name: 'FR129 Business', code: 'BUS-FR129' })
    businessId = business.id
    viewer = makeOperatorViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
  })

  // SDD-075's whole subject: the column has existed since FR-071 and held
  // nothing. This asserts the stored TEXT, then the read model, then the API's
  // own response shape — the three places the value was being dropped.
  it('round-trips a signer’s evidence from the column through the read model', async () => {
    const created = await createPipelineRun(runInput(), { viewer })
    const recorded = await decide(
      created.run.executionRunId,
      'gate-fr129-approve-1',
      '2026-08-30T09:00:00.000Z',
      approval(),
    )

    const row = await prisma.pipelineGateDecision.findUnique({ where: { id: recorded.gate.id } })
    expect(typeof row.evidenceJson).toBe('string')
    expect(row.evidenceJson).not.toBe('{}')
    expect(JSON.parse(row.evidenceJson)).toEqual({ ...EVIDENCE })
    expect(row.decidedByPersonId).toBe('person-fr129')

    const monitor = await getPipelineMonitor(created.run.executionRunId, { viewer })
    expect(monitor.gates).toHaveLength(1)
    expect(monitor.gates[0].evidence).toEqual({ ...EVIDENCE })
    // `createdAt` is the "approvedAt" CR-003 wanted as a column; the row's own
    // timestamp already is that fact (SDD-075).
    expect(monitor.gates[0].createdAt).toBeTruthy()
  })

  // A decision recorded before this write path existed holds the DDL default.
  // It must still read, as an empty object rather than a crash or a string.
  it('reads a decision that carries no evidence as an empty object', async () => {
    const created = await createPipelineRun(runInput({
      idempotencyKey: 'run-fr129-legacy', correlationId: 'corr-fr129-legacy',
    }), { viewer })
    const recorded = await decide(
      created.run.executionRunId,
      'gate-fr129-reject-1',
      '2026-08-30T09:00:00.000Z',
      { gateId: null, status: 'REJECTED', required: true, decidedByPersonId: 'person-fr129', reason: 'counts disagree with the artifact' },
    )

    const row = await prisma.pipelineGateDecision.findUnique({ where: { id: recorded.gate.id } })
    expect(row.evidenceJson).toBe('{}')
    const monitor = await getPipelineMonitor(created.run.executionRunId, { viewer })
    expect(monitor.gates[0].evidence).toEqual({})
    expect(monitor.gates[0].reason).toBe('counts disagree with the artifact')
  })

  it('reports a publish that succeeded with no approval on the run’s own monitor', async () => {
    const created = await createPipelineRun(runInput({
      idempotencyKey: 'run-fr129-violation', correlationId: 'corr-fr129-violation',
    }), { viewer })
    await publish(created.run.executionRunId, 'fr129-violation-publish', '2026-08-30T10:00:00.000Z')

    const monitor = await getPipelineMonitor(created.run.executionRunId, { viewer })
    expect(monitor.gateCompliance.gated).toBe(true)
    expect(monitor.gateCompliance.enforced).toBe(false)
    expect(monitor.gateCompliance.violations).toHaveLength(1)
    expect(monitor.gateCompliance.violations[0].code).toBe('PUBLISH_WITHOUT_APPROVAL')
    expect(monitor.gateCompliance.violations[0].observedGateStatuses).toEqual([])
  })

  it('stays silent on a run whose approval preceded its publish', async () => {
    const created = await createPipelineRun(runInput({
      idempotencyKey: 'run-fr129-clean', correlationId: 'corr-fr129-clean',
    }), { viewer })
    await decide(created.run.executionRunId, 'gate-fr129-approve-2', '2026-08-30T09:00:00.000Z', approval())
    await publish(created.run.executionRunId, 'fr129-clean-publish', '2026-08-30T10:00:00.000Z')

    const monitor = await getPipelineMonitor(created.run.executionRunId, { viewer })
    expect(monitor.gateCompliance.violations).toEqual([])
    expect(monitor.gateCompliance.gated).toBe(true)
  })

  // The ledger does not prevent this — the worker published and then somebody
  // signed. An existence check would call it compliant; the ordering is what
  // makes it a violation, and it is the reason detection is worth having at
  // all when the executor is not ours (ADR-043 D2.1, ADR-050 D3).
  it('reports an approval that arrived after the catalog was already published', async () => {
    const created = await createPipelineRun(runInput({
      idempotencyKey: 'run-fr129-late', correlationId: 'corr-fr129-late',
    }), { viewer })
    await publish(created.run.executionRunId, 'fr129-late-publish', '2026-08-30T10:00:00.000Z')
    await decide(created.run.executionRunId, 'gate-fr129-approve-3', '2026-08-30T11:00:00.000Z', approval())

    const monitor = await getPipelineMonitor(created.run.executionRunId, { viewer })
    expect(monitor.gates).toHaveLength(1)
    expect(monitor.gates[0].status).toBe('APPROVED')
    expect(monitor.gateCompliance.violations).toHaveLength(1)
    expect(monitor.gateCompliance.violations[0].approvalsAfterPublish).toBe(1)
  })

  // FR-129 (b) is enforced at the envelope, so an unaccounted signature never
  // reaches the column in the first place.
  it('refuses to record an approval that says nothing about what was approved', async () => {
    const created = await createPipelineRun(runInput({
      idempotencyKey: 'run-fr129-blind', correlationId: 'corr-fr129-blind',
    }), { viewer })
    const blind = approval()
    delete blind.evidence

    await expect(decide(created.run.executionRunId, 'gate-fr129-blind', '2026-08-30T09:00:00.000Z', blind))
      .rejects.toThrow(/requires the evidence it was decided on/)
    expect(await prisma.pipelineGateDecision.count({ where: { run: { executionRunId: created.run.executionRunId } } })).toBe(0)
  })
})
