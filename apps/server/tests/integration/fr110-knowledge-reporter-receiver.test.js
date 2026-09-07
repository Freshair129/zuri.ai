import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeOperatorViewer } from '../factories/viewer'
import { mintSotDataPlaneKey, resolveSotDataPlaneViewer } from '@/modules/identity/sot-data-plane-auth'
import {
  KNOWLEDGE_METRICS_NOT_ON_LEDGER,
  KNOWLEDGE_QUALITY_GATE_ID,
  finishKnowledgeIngestionRun,
  ingestKnowledgeDocument,
  readKnowledgeIngestionJob,
  recordKnowledgeStage17Decision,
  recordKnowledgeStageReport,
} from '@/platform/integrations/core/knowledge-ingestion-executor'
import { createPipelineRun, recordPipelineEvent } from '@/platform/integrations/core/pipeline-tracking-service'
import {
  DATA_PIPELINE_DEFINITION_ID,
  EXECUTION_CONTRACT_ID,
  IDENTITY_REFS_EMPTY,
  KNOWLEDGE_INGESTION_CONTRACT_ID,
  KNOWLEDGE_INGESTION_DEFINITION_ID,
  KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS,
  KNOWLEDGE_QUALITY_GATE_STAGE_ID,
  PIPELINE_STAGE_CATALOG,
} from '@/platform/integrations/core/pipeline-tracking-contract'

// @req FR-110 — the zuri-ai half of KNO-02: Stage 9–16 reports, the Stage 17
// decision (AC-110.4) and the derived close land on the FR-071 ledger from a
// Tenant-bound data-plane key, and from nothing else.
// @req FR-109 — one pipeline_job_id resolves the run, its step identities and
// its §5 job state (AC-109.11); Tier 1 stages stay unreportable from outside
// Tier 1 (AC-109.12, the half this repository owns).
// @spec ADR-067 D1-D5, ADR-050 D3, ADR-047, BR-022, SDD-069
// @tested tests/integration/fr110-knowledge-reporter-receiver.test.js
//
// Real database, same reasoning as the fr109/fr119 executor suites: every
// claim here is a real status transition, a real @unique receipt or a real
// gate row, and a fake that does not implement those cannot fail the way a
// bad write fails. The reporter viewer is resolved through the real bearer
// resolver, not hand-built — the shape under test is the one production sees.

let operator
let reporter
let otherTenantReporter
let tenantId
let businessId

const T0 = '2026-09-07T10:00:00.000Z'
const T1 = '2026-09-07T10:00:30.000Z'

function artifact(over = {}) {
  return {
    scope: { tenantId, businessId },
    artifact_id: 'art-fr110-1',
    source_id: 'src://drive/fr110-contract.md',
    source_type: 'FILE',
    source_uri: 'https://drive.example/fr110-contract.md',
    source_version: '1',
    content_hash: 'a'.repeat(64),
    pipeline_version: 'ki-1.0.0',
    ingested_at: '2026-09-07T09:00:00Z',
    parsed_at: '2026-09-07T09:00:05Z',
    extractor_version: 'ki-parse-1',
    ...over,
  }
}

const policy = () => ({
  sensitivity: 'INTERNAL', retention_policy: 'RETAIN_7Y', export_policy: 'NO_EXPORT',
  cloud_processing_allowed: true, embedding_allowed: true,
})

async function ingest(sourceVersion, artifactOver = {}) {
  const result = await ingestKnowledgeDocument({
    documentId: `doc-fr110-${sourceVersion}`,
    text: '# Scope\n\nบริษัท เอบีซี จำกัด delivers the console.',
    artifact: artifact({ source_version: sourceVersion, ...artifactOver }),
    policy: policy(),
  }, { viewer: operator })
  return result.run
}

async function stepsOf(run) {
  const row = await prisma.pipelineRun.findUnique({ where: { executionRunId: run.executionRunId } })
  const steps = await prisma.pipelineStep.findMany({ where: { runId: row.id } })
  return Object.fromEntries(steps.map((step) => [step.pipelineStageId, step]))
}

const metrics = (over = {}) => ({
  records_in: 12, records_out: 11, records_failed: 1, records_quarantined: 0, processing_time: 30, retry_count: 0, ...over,
})

async function report(run, pipelineStageId, over = {}) {
  const step = (await stepsOf(run))[pipelineStageId]
  return {
    dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
    executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
    executionRunId: run.executionRunId,
    pipelineStageId,
    executionStepId: step?.executionStepId ?? 'step-unknown',
    attemptId: step?.attemptId ?? 'attempt-unknown',
    scope: { tenantId, businessId },
    outcome: 'SUCCEEDED',
    failure: null,
    startedAt: T0,
    finishedAt: T1,
    metrics: metrics(),
    ...over,
  }
}

const SNAPSHOT = (run) => ({
  knowledge_snapshot_id: `ks_${run.executionRunId}`,
  tenant_id: tenantId,
  business_id: businessId,
  ontology_version: 'onto-1',
  pipeline_version: 'ki-1.0.0',
  published_at: T1,
  statistics: { documents: 1, chunks: 3, entities: 2, facts: 4, relations: 1 },
})

const DIMENSIONS = (result = 'PASS') => Object.fromEntries(
  ['data', 'graph', 'knowledge', 'security', 'retrieval'].map((d) => [d, { result, critical: false }]),
)

async function decision(run, over = {}) {
  const step = (await stepsOf(run))[KNOWLEDGE_QUALITY_GATE_STAGE_ID]
  return {
    dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
    executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
    executionRunId: run.executionRunId,
    pipelineStageId: KNOWLEDGE_QUALITY_GATE_STAGE_ID,
    executionStepId: step.executionStepId,
    attemptId: step.attemptId,
    scope: { tenantId, businessId },
    ledgerStatus: 'APPROVED',
    verdict: 'PASS',
    snapshot: SNAPSHOT(run),
    dimensions: DIMENSIONS(),
    startedAt: T0,
    finishedAt: T1,
    ...over,
  }
}

const finish = (run) => ({
  dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
  executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
  executionRunId: run.executionRunId,
  scope: { tenantId, businessId },
  finishedAt: T1,
})

async function reportAllExternal(run, viewer = reporter) {
  for (const stageId of KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS) {
    await recordKnowledgeStageReport(await report(run, stageId), { viewer })
  }
}

async function viewerForKey(key) {
  return resolveSotDataPlaneViewer(new Request('http://local/', { headers: { authorization: `Bearer ${key}` } }))
}

describe('FR-110 — the Stage 9–17 reporter receiver', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'KI Reporter Group', code: 'PF-KIREP' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'KI Reporter Tenant', code: 'TNT-KIREP' })
    const business = await createBusiness({ tenantId: tenant.id, name: 'KI Reporter Business', code: 'BUS-KIREP' })
    const otherTenant = await createTenant({ portfolioId: portfolio.id, name: 'KI Other Tenant', code: 'TNT-KIOTH' })
    tenantId = tenant.id
    businessId = business.id
    operator = makeOperatorViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    reporter = await viewerForKey((await mintSotDataPlaneKey({ label: 'gks-reporter', tenantId: tenant.id })).key)
    otherTenantReporter = await viewerForKey((await mintSotDataPlaneKey({ label: 'other-reporter', tenantId: otherTenant.id })).key)
    expect(reporter).toMatchObject({ isSotDataPlane: true, tenantId: tenant.id })
  })

  it('a Tenant-bound data-plane key records all eight external stages with real counts and the reported times', async () => {
    const run = await ingest('v-eight')
    const results = []
    for (const stageId of KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS) {
      results.push(await recordKnowledgeStageReport(await report(run, stageId, {
        metrics: metrics({ records_in: 10 + results.length, records_out: 9 + results.length }),
      }), { viewer: reporter }))
    }
    expect(results.every((r) => r.status === 'CREATED' && r.outcome === 'SUCCEEDED')).toBe(true)
    expect(results[0].declined).toEqual([...KNOWLEDGE_METRICS_NOT_ON_LEDGER])

    const steps = await stepsOf(run)
    for (const [i, stageId] of KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS.entries()) {
      expect(steps[stageId].status).toBe('SUCCEEDED')
      expect(steps[stageId].actualCount).toBe(10 + i)
      expect(steps[stageId].insertedCount).toBe(9 + i)
      expect(steps[stageId].failedCount).toBe(1)
      expect(steps[stageId].outputHash).toMatch(/^[a-f0-9]{64}$/)
      // ADR-067 D2 — the ledger's timestamps are the execution's, not the network's.
      expect(steps[stageId].startedAt.toISOString()).toBe(T0)
      expect(steps[stageId].finishedAt.toISOString()).toBe(T1)
    }
    // The seven Tier 1 steps and Stage 17 are exactly as the reporter found them.
    expect(steps['DPS-KI-PARSE'].status).toBe('SUCCEEDED')
    expect(steps[KNOWLEDGE_QUALITY_GATE_STAGE_ID].status).toBe('NOT_STARTED')

    const row = await prisma.pipelineRun.findUnique({ where: { executionRunId: run.executionRunId } })
    expect(row.status).toBe('RUNNING') // reporting eight stages is not closing the run
    const audit = await prisma.auditEvent.findFirst({
      where: { entityId: steps['DPS-KI-ENTITY-RESOLVE'].executionStepId, action: 'PIPELINE_STEP_SUCCEEDED' },
    })
    expect(audit).toMatchObject({ actorType: 'PIPELINE_REPORTER', actorId: reporter.serviceAccountId })
  })

  it('is idempotent on the same report and refuses a different report under the same attempt (409)', async () => {
    const run = await ingest('v-idem')
    const first = await recordKnowledgeStageReport(await report(run, 'DPS-KI-ENTITY-RESOLVE'), { viewer: reporter })
    expect(first.status).toBe('CREATED')
    const row = await prisma.pipelineRun.findUnique({ where: { executionRunId: run.executionRunId } })
    const receipts = await prisma.pipelineEventReceipt.count({ where: { runId: row.id } })

    const again = await recordKnowledgeStageReport(await report(run, 'DPS-KI-ENTITY-RESOLVE'), { viewer: reporter })
    expect(again.status).toBe('UNCHANGED')
    expect(await prisma.pipelineEventReceipt.count({ where: { runId: row.id } })).toBe(receipts)

    await expect(recordKnowledgeStageReport(await report(run, 'DPS-KI-ENTITY-RESOLVE', {
      metrics: metrics({ records_out: 3 }),
    }), { viewer: reporter })).rejects.toMatchObject({ status: 409 })
  })

  it('refuses a Tier 1 stage id, the quality gate on the stage surface, and a step/attempt/stage that do not agree', async () => {
    const run = await ingest('v-refuse')
    await expect(recordKnowledgeStageReport(await report(run, 'DPS-KI-PARSE'), { viewer: reporter })).rejects.toThrow()
    await expect(recordKnowledgeStageReport(await report(run, KNOWLEDGE_QUALITY_GATE_STAGE_ID), { viewer: reporter })).rejects.toThrow()

    const steps = await stepsOf(run)
    await expect(recordKnowledgeStageReport(await report(run, 'DPS-KI-ENTITY-RESOLVE', {
      executionStepId: steps['DPS-KI-EMBED'].executionStepId, // Stage 15's row under Stage 9's id
    }), { viewer: reporter })).rejects.toMatchObject({ status: 409 })
    await expect(recordKnowledgeStageReport(await report(run, 'DPS-KI-ENTITY-RESOLVE', {
      attemptId: 'attempt-minted-by-reporter',
    }), { viewer: reporter })).rejects.toMatchObject({ status: 409 })
    await expect(recordKnowledgeStageReport(await report(run, 'DPS-KI-ENTITY-RESOLVE', {
      executionStepId: 'step-minted-by-reporter',
    }), { viewer: reporter })).rejects.toMatchObject({ status: 409 })
    await expect(recordKnowledgeStageReport(await report(run, 'DPS-KI-ENTITY-RESOLVE', {
      scope: { tenantId, businessId: 'some-other-business' },
    }), { viewer: reporter })).rejects.toMatchObject({ status: 409 })
    expect((await stepsOf(run))['DPS-KI-ENTITY-RESOLVE'].status).toBe('NOT_STARTED')
  })

  it('binds the key to its Tenant: another Tenant’s key can neither report onto nor read this run', async () => {
    const run = await ingest('v-tenant')
    await expect(recordKnowledgeStageReport(await report(run, 'DPS-KI-ENTITY-RESOLVE'), { viewer: otherTenantReporter }))
      .rejects.toMatchObject({ status: 403 })
    await expect(readKnowledgeIngestionJob(run.executionRunId, { viewer: otherTenantReporter }))
      .rejects.toMatchObject({ status: 404 })
    await expect(recordKnowledgeStageReport(await report(run, 'DPS-KI-ENTITY-RESOLVE'), { viewer: null }))
      .rejects.toMatchObject({ status: 403 })
  })

  it('holds the boundary in the writer, not only in the receiver (ADR-067 D1)', async () => {
    const run = await ingest('v-writer')
    const steps = await stepsOf(run)
    const base = {
      dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
      executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
      executionRunId: run.executionRunId,
      correlationId: 'ki:writer-test',
      sourceSha256: null, pipelineRecordId: null, sourceRecordKey: null, sourceRowNumber: null,
      docId: null, picId: null, factId: null, sourceDocIds: [], sourcePicIds: [], destinationRecordId: null,
      inputHash: null, outputHash: null, tagIds: [], identityRefs: { ...IDENTITY_REFS_EMPTY },
      failureCode: null, errorRef: null, retryable: null, reconciliation: null, gate: null,
    }
    // A Tier 1 stage, well-formed, from the reporter: refused by the writer.
    await expect(recordPipelineEvent({
      ...base, eventType: 'STEP_STARTED', pipelineStageId: 'DPS-KI-CHUNK',
      executionStepId: steps['DPS-KI-CHUNK'].executionStepId, attemptId: steps['DPS-KI-CHUNK'].attemptId,
      sequence: 70, status: 'RUNNING', idempotencyKey: 'writer-test:chunk:started',
    }, { viewer: reporter })).rejects.toMatchObject({ status: 403 })
    // A record event — Tier 1's docId-bound disposition — is not a reporter verb.
    await expect(recordPipelineEvent({
      ...base, eventType: 'RECORD_STARTED', pipelineStageId: null, executionStepId: null,
      attemptId: steps['DPS-KI-ENTITY-RESOLVE'].attemptId, pipelineRecordId: 'doc-x', sequence: null,
      status: 'RUNNING', idempotencyKey: 'writer-test:record:started',
    }, { viewer: reporter })).rejects.toMatchObject({ status: 403 })
    // A run is never minted by a reporter.
    await expect(createPipelineRun({
      dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID, executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
      businessId, sourceRef: null, sourceSha256: null, artifactRef: null, artifactSha256: null, expectedCount: 0,
      bootstrapBatchId: null, correlationId: 'ki:minted', idempotencyKey: 'ki:minted-by-reporter',
      identityRefs: { ...IDENTITY_REFS_EMPTY }, tagIds: [],
    }, { viewer: reporter })).rejects.toMatchObject({ status: 403 })
    // A run of another definition is out of reach however the envelope is shaped.
    const supabase = await createPipelineRun({
      dataPipelineDefinitionId: DATA_PIPELINE_DEFINITION_ID, executionContractId: EXECUTION_CONTRACT_ID,
      businessId, sourceRef: null, sourceSha256: null, artifactRef: null, artifactSha256: null, expectedCount: 0,
      bootstrapBatchId: null, correlationId: 'sb:fr110-writer', idempotencyKey: 'sb:fr110-writer',
      identityRefs: { ...IDENTITY_REFS_EMPTY }, tagIds: [],
    }, { viewer: operator })
    const sbRow = await prisma.pipelineRun.findUnique({ where: { executionRunId: supabase.run.executionRunId } })
    const sbStep = await prisma.pipelineStep.findFirst({ where: { runId: sbRow.id, pipelineStageId: PIPELINE_STAGE_CATALOG[0].pipelineStageId } })
    await expect(recordPipelineEvent({
      ...base, dataPipelineDefinitionId: DATA_PIPELINE_DEFINITION_ID, executionContractId: EXECUTION_CONTRACT_ID,
      executionRunId: supabase.run.executionRunId, eventType: 'STEP_STARTED', pipelineStageId: sbStep.pipelineStageId,
      executionStepId: sbStep.executionStepId, attemptId: sbStep.attemptId, sequence: sbStep.sequence,
      status: 'RUNNING', idempotencyKey: 'writer-test:sb:started',
    }, { viewer: reporter })).rejects.toMatchObject({ status: 403 })
  })

  it('records the Stage 17 decision as gate evidence, closes the gate step, and the job becomes READY_TO_PUBLISH', async () => {
    const run = await ingest('v-gate')
    await reportAllExternal(run)
    const before = await readKnowledgeIngestionJob(run.executionRunId, { viewer: reporter })
    expect(before.job).toMatchObject({ state: 'VALIDATING', reason: 'EXTERNAL_STAGES_COMPLETE' })

    const result = await recordKnowledgeStage17Decision(await decision(run), { viewer: reporter })
    expect(result).toMatchObject({ status: 'CREATED', verdict: 'PASS', ledgerStatus: 'APPROVED' })
    expect(result.gate).toMatchObject({
      gateId: KNOWLEDGE_QUALITY_GATE_ID,
      status: 'APPROVED',
      decidedByPersonId: null,
      evidence: { verdict: 'PASS', snapshot: { knowledge_snapshot_id: `ks_${run.executionRunId}` } },
    })
    expect(Object.keys(result.gate.evidence).sort()).toEqual(['dimensions', 'snapshot', 'verdict'])
    expect((await stepsOf(run))[KNOWLEDGE_QUALITY_GATE_STAGE_ID].status).toBe('SUCCEEDED')

    const after = await readKnowledgeIngestionJob(run.executionRunId, { viewer: reporter })
    expect(after.job).toMatchObject({ state: 'READY_TO_PUBLISH', gate: { status: 'APPROVED', verdict: 'PASS', snapshotId: `ks_${run.executionRunId}` } })
    expect(after.run.status).toBe('RUNNING')

    // The envelope, not the reporter, keeps ledger status and verdict consistent.
    const runB = await ingest('v-gate-inconsistent')
    await reportAllExternal(runB)
    await expect(recordKnowledgeStage17Decision(await decision(runB, { ledgerStatus: 'APPROVED', verdict: 'FAIL', snapshot: null }), { viewer: reporter }))
      .rejects.toThrow()
    await expect(recordKnowledgeStage17Decision(await decision(runB, {
      snapshot: { ...SNAPSHOT(runB), tenant_id: 'tenant-elsewhere' },
    }), { viewer: reporter })).rejects.toThrow(/scope/)
  })

  it('keeps a legacy successful run open until an attempt-bound publication receipt arrives', async () => {
    const run = await ingest('v-finish')
    await expect(finishKnowledgeIngestionRun(finish(run), { viewer: reporter })).rejects.toMatchObject({
      status: 409,
      details: expect.arrayContaining(['STAGE_NOT_SUCCEEDED:DPS-KI-ENTITY-RESOLVE', 'GATE_MISSING']),
    })
    await reportAllExternal(run)
    await expect(finishKnowledgeIngestionRun(finish(run), { viewer: reporter })).rejects.toMatchObject({
      details: [`STAGE_NOT_SUCCEEDED:${KNOWLEDGE_QUALITY_GATE_STAGE_ID}`, 'GATE_MISSING'],
    })
    await recordKnowledgeStage17Decision(await decision(run), { viewer: reporter })

    await expect(finishKnowledgeIngestionRun(finish(run), { viewer: reporter })).rejects.toMatchObject({
      status: 409,
      message: 'Successful finish requires an attempt-bound publication receipt; legacy evidence remains readable',
    })
    const row = await prisma.pipelineRun.findUnique({ where: { executionRunId: run.executionRunId } })
    expect(row).toMatchObject({ status: 'RUNNING', finishedAt: null })

    const job = await readKnowledgeIngestionJob(run.executionRunId, { viewer: operator })
    expect(job.job).toMatchObject({ state: 'READY_TO_PUBLISH' })
    expect(job.pipelineJobId).toBe(run.executionRunId)
    expect(job.stages).toHaveLength(17)
    expect(job.stages.every((s) => s.executionStepId && s.attemptId)).toBe(true)
  })

  it('a FAIL verdict rejects and closes FAILED; a QUARANTINE verdict holds', async () => {
    const run = await ingest('v-fail-verdict')
    await reportAllExternal(run)
    await recordKnowledgeStage17Decision(await decision(run, {
      ledgerStatus: 'REJECTED', verdict: 'FAIL', snapshot: null,
      dimensions: { ...DIMENSIONS(), security: { result: 'FAIL', critical: true } },
    }), { viewer: reporter })
    expect((await readKnowledgeIngestionJob(run.executionRunId, { viewer: reporter })).job)
      .toMatchObject({ state: 'REJECTED', reason: 'GATE_VERDICT_FAIL' })
    const closed = await finishKnowledgeIngestionRun(finish(run), { viewer: reporter })
    expect(closed).toMatchObject({ terminal: 'FAILED', outcome: { failureCode: 'KI_GATE_REJECTED:FAIL' } })
    const row = await prisma.pipelineRun.findUnique({ where: { executionRunId: run.executionRunId } })
    expect(row).toMatchObject({ status: 'FAILED', primaryFailureCode: 'KI_GATE_REJECTED:FAIL', primaryRetryable: false })

    const held = await ingest('v-quarantine-verdict')
    await reportAllExternal(held)
    await recordKnowledgeStage17Decision(await decision(held, { ledgerStatus: 'REJECTED', verdict: 'QUARANTINE', snapshot: null }), { viewer: reporter })
    expect((await readKnowledgeIngestionJob(held.executionRunId, { viewer: reporter })).job)
      .toMatchObject({ state: 'QUARANTINED', reason: 'GATE_VERDICT_QUARANTINE' })
  })

  it('an external stage failure quarantines or marks retryable, and a Tier 1 quarantine finally closes its run FAILED', async () => {
    const run = await ingest('v-ext-fail')
    const failed = await recordKnowledgeStageReport(await report(run, 'DPS-KI-ENTITY-RESOLVE', {
      outcome: 'FAILED',
      failure: { failureCode: 'GKS_RESOLUTION_TIMEOUT', errorRef: 'gks://errors/9/1', retryable: true },
      metrics: metrics({ records_out: 0, records_failed: 12, records_quarantined: 12 }),
    }), { viewer: reporter })
    expect(failed.outcome).toBe('FAILED')
    const steps = await stepsOf(run)
    expect(steps['DPS-KI-ENTITY-RESOLVE']).toMatchObject({ status: 'FAILED', failureCode: 'GKS_RESOLUTION_TIMEOUT', retryable: true, failedCount: 12 })
    expect((await readKnowledgeIngestionJob(run.executionRunId, { viewer: reporter })).job)
      .toMatchObject({ state: 'RETRYABLE_FAILED', failedStage: 'DPS-KI-ENTITY-RESOLVE' })
    expect(await finishKnowledgeIngestionRun(finish(run), { viewer: reporter }))
      .toMatchObject({ terminal: 'FAILED', outcome: { failureCode: 'KI_STAGE_FAILED:DPS-KI-ENTITY-RESOLVE' } })

    // FR-119's quarantined document: until now its run stayed RUNNING forever.
    const quarantined = await ingest('v-tier1-quarantine', { ingested_at: '2026-09-07T09:00:10Z', parsed_at: '2026-09-07T09:00:00Z' })
    expect((await readKnowledgeIngestionJob(quarantined.executionRunId, { viewer: operator })).job)
      .toMatchObject({ state: 'QUARANTINED', reason: 'TIER1_STAGE_FAILED:DPS-KI-PROVENANCE' })
    expect(await finishKnowledgeIngestionRun(finish(quarantined), { viewer: operator }))
      .toMatchObject({ terminal: 'FAILED', outcome: { failedStage: 'DPS-KI-PROVENANCE' } })
  })

  it('reports the job as PROCESSING after Tier 1 alone, and the read carries every identity a reporter must echo', async () => {
    const run = await ingest('v-read')
    const read = await readKnowledgeIngestionJob(run.executionRunId, { viewer: reporter })
    expect(read.job).toMatchObject({ state: 'PROCESSING', gate: null })
    const byStage = Object.fromEntries(read.stages.map((s) => [s.pipelineStageId, s]))
    const steps = await stepsOf(run)
    for (const stageId of KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS) {
      expect(byStage[stageId]).toMatchObject({ executionStepId: steps[stageId].executionStepId, attemptId: steps[stageId].attemptId, status: 'NOT_STARTED' })
    }
    expect(byStage['DPS-KI-CHUNK'].status).toBe('SUCCEEDED')
    expect(read.freshness).toHaveProperty('stale')
    await expect(readKnowledgeIngestionJob('run-that-does-not-exist', { viewer: reporter })).rejects.toMatchObject({ status: 404 })
  })
})
