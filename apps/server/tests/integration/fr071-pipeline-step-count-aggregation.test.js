import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeOperatorViewer } from '../factories/viewer'
import {
  DATA_PIPELINE_DEFINITION_ID,
  EXECUTION_CONTRACT_ID,
  IDENTITY_REFS_EMPTY,
} from '@/platform/integrations/core/pipeline-tracking-contract'
import { createPipelineRun, recordPipelineEvent } from '@/platform/integrations/core/pipeline-tracking-service'

// @req NFR-020 — the run-level count aggregate is proven against the real
// database, not only the fake, because the fake cannot enforce a uniqueness
// constraint and would keep passing after a migration made this scenario
// impossible.
// @spec SDD-070, SDD-071, ADR-030 (rejected: retry reusing run/step ids)
// @tested tests/integration/fr071-pipeline-step-count-aggregation.test.js
//
// This is the counterpart to the "sums every step row sharing a stage" test
// in tests/unit/platform/pipeline-tracking-service.test.js, run against a
// real Prisma-backed database on purpose. `(runId, pipelineStageId)` has no
// uniqueness constraint today — a non-unique index only — so this asserts
// TODAY's real behaviour: a second PipelineStep row for a stage this run
// already has gets summed, not refused. Once `@@unique([runId,
// pipelineStageId])` lands (pending a production duplicate check), the
// `prisma.pipelineStep.create` below will throw instead of succeeding, and
// this test is the one that will fail and say why — the fake-db unit test
// cannot, because its `create()` has no concept of a unique constraint.

let viewer
let businessId
let tenantId

function runInput(over = {}) {
  return {
    dataPipelineDefinitionId: DATA_PIPELINE_DEFINITION_ID,
    executionContractId: EXECUTION_CONTRACT_ID,
    businessId,
    sourceRef: 'duckdb://count-agg/business-01',
    sourceSha256: 'a'.repeat(64),
    artifactRef: 'artifact://count-agg/export.jsonl',
    artifactSha256: 'a'.repeat(64),
    expectedCount: 3,
    bootstrapBatchId: 'batch-count-agg',
    correlationId: 'corr-count-agg',
    idempotencyKey: 'run-count-agg-1',
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
    pipelineStageId: 'DPS-SCHEMA-VALIDATE',
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
    sequence: 30,
    status: 'SUCCEEDED',
    correlationId: 'corr-count-agg-event',
    idempotencyKey: 'event-count-agg-1',
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

describe('NFR-020 run-level count aggregation, against the real database', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Count Agg Group', code: 'PF-COUNTAGG' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Count Agg Tenant', code: 'TNT-COUNTAGG' })
    const business = await createBusiness({ tenantId: tenant.id, name: 'Count Agg Business', code: 'BUS-COUNTAGG' })
    businessId = business.id
    tenantId = tenant.id
    viewer = makeOperatorViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
  })

  it('aggregates one stage’s counts onto the run', async () => {
    const created = await createPipelineRun(runInput(), { viewer })
    const step = await prisma.pipelineStep.findFirst({
      where: { run: { executionRunId: created.run.executionRunId }, pipelineStageId: 'DPS-SCHEMA-VALIDATE' },
    })

    await recordPipelineEvent(event({
      eventType: 'STEP_STARTED', status: 'RUNNING',
      executionRunId: created.run.executionRunId, executionStepId: step.executionStepId, attemptId: step.attemptId,
      idempotencyKey: 'real-agg-start-1',
    }), { viewer })
    const succeeded = await recordPipelineEvent(event({
      executionRunId: created.run.executionRunId, executionStepId: step.executionStepId, attemptId: step.attemptId,
      idempotencyKey: 'real-agg-success-1',
      actualCount: 6, insertedCount: 4, failedCount: 2,
    }), { viewer })

    expect(succeeded.run.actualCount).toBe(6)
    expect(succeeded.run.insertedCount).toBe(4)
    expect(succeeded.run.failedCount).toBe(2)
  })

  it('today: a second PipelineStep row for an already-run stage is constructible and gets summed, not refused', async () => {
    const created = await createPipelineRun(runInput({ idempotencyKey: 'run-count-agg-2', correlationId: 'corr-count-agg-2' }), { viewer })
    const step = await prisma.pipelineStep.findFirst({
      where: { run: { executionRunId: created.run.executionRunId }, pipelineStageId: 'DPS-SCHEMA-VALIDATE' },
    })

    await recordPipelineEvent(event({
      eventType: 'STEP_STARTED', status: 'RUNNING',
      executionRunId: created.run.executionRunId, executionStepId: step.executionStepId, attemptId: step.attemptId,
      idempotencyKey: 'real-retry-start-1',
    }), { viewer })
    await recordPipelineEvent(event({
      executionRunId: created.run.executionRunId, executionStepId: step.executionStepId, attemptId: step.attemptId,
      idempotencyKey: 'real-retry-success-1',
      actualCount: 5, insertedCount: 5, failedCount: 0,
    }), { viewer })

    // A second executionStepId for the SAME pipelineStageId, in the SAME
    // run. `recordPipelineEvent` auto-creates it because nothing today
    // refuses `(runId, pipelineStageId)` to repeat. This `create` is the
    // exact call a `@@unique([runId, pipelineStageId])` migration would make
    // throw -- when it does, this test starts failing here, not at the
    // assertion below, and that is the signal to update it.
    await recordPipelineEvent(event({
      eventType: 'STEP_STARTED', status: 'RUNNING',
      executionRunId: created.run.executionRunId, executionStepId: 'real-retry-step-2', attemptId: 'real-retry-attempt-2',
      idempotencyKey: 'real-retry-start-2',
    }), { viewer })
    const secondAttempt = await recordPipelineEvent(event({
      executionRunId: created.run.executionRunId, executionStepId: 'real-retry-step-2', attemptId: 'real-retry-attempt-2',
      idempotencyKey: 'real-retry-success-2',
      actualCount: 5, insertedCount: 5, failedCount: 0,
    }), { viewer })

    const rows = await prisma.pipelineStep.count({
      where: { run: { executionRunId: created.run.executionRunId }, pipelineStageId: 'DPS-SCHEMA-VALIDATE' },
    })
    expect(rows).toBe(2) // two rows for one stage -- the gap SDD-071 names
    expect(secondAttempt.run.actualCount).toBe(10) // summed, not the true 5
  })
})
