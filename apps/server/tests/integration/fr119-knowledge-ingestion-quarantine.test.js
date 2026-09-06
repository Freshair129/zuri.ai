import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeOperatorViewer } from '../factories/viewer'
import { ingestKnowledgeDocument } from '@/platform/integrations/core/knowledge-ingestion-executor'

// @req FR-119 — a document that fails partway is quarantined with BR-022's
// envelope, not reported as nothing having happened.
// @spec SDD-072, BR-022, ADR-050 D4
// @tested tests/integration/fr119-knowledge-ingestion-quarantine.test.js
//
// Real database, same reasoning as every other executor suite: the claim is
// about real PipelineStep/PipelineRecordEvent rows and real status
// transitions, which a fake db cannot enforce.

let viewer
let businessId
let tenantId

const DOC_TEXT = '# Scope\n\nบริษัท เอบีซี จำกัด delivers the console.'

function artifact(over = {}) {
  return {
    scope: { tenantId, businessId },
    artifact_id: 'art-fr119-1',
    source_id: 'src://drive/fr119-contract.md',
    source_type: 'FILE',
    source_uri: 'https://drive.example/fr119-contract.md',
    source_version: '1',
    content_hash: 'f'.repeat(64),
    pipeline_version: 'ki-1.0.0',
    ingested_at: '2026-08-28T01:00:00Z',
    parsed_at: '2026-08-28T01:00:05Z',
    extractor_version: 'ki-parse-1',
    ...over,
  }
}

const policy = () => ({
  sensitivity: 'INTERNAL', retention_policy: 'RETAIN_7Y', export_policy: 'NO_EXPORT',
  cloud_processing_allowed: true, embedding_allowed: true,
})

function ingest({ documentId = 'doc-fr119-1', artifactOver = {}, ...over } = {}) {
  return ingestKnowledgeDocument({
    documentId, text: DOC_TEXT, artifact: artifact(artifactOver), policy: policy(), ...over,
  }, { viewer })
}

describe('FR-119 quarantine: a document that fails partway', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'KI Quarantine Group', code: 'PF-KIQ' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'KI Quarantine Tenant', code: 'TNT-KIQ' })
    const business = await createBusiness({ tenantId: tenant.id, name: 'KI Quarantine Business', code: 'BUS-KIQ' })
    businessId = business.id
    tenantId = tenant.id
    viewer = makeOperatorViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
  })

  it('no longer rejects — it returns the BR-022 envelope instead', async () => {
    const badFields = { source_version: 'v-quar-1', ingested_at: '2026-08-28T02:00:00Z', parsed_at: '2026-08-28T01:00:00Z' }
    const result = await ingest({ documentId: 'doc-fr119-basic', artifactOver: badFields })

    expect(result.quarantine).toMatchObject({
      artifact_id: 'art-fr119-1',
      stage: 'DPS-KI-PROVENANCE',
      error_code: 'DPS-KI-PROVENANCE_VALIDATION_FAILED',
      retry_count: 0,
      pipeline_version: 'ki-1.0.0',
      classification: 'NON_RETRYABLE',
    })
    expect(result.quarantine.job_id).toBe(result.run.executionRunId)
    expect(result.quarantine.error_message).toMatch(/ingested_at/)
    expect(result.quarantine.first_failed_at).toBe(result.quarantine.last_failed_at)
  })

  it('writes real STEP_SUCCEEDED evidence for every stage that completed before the failure', async () => {
    const badFields = { source_version: 'v-quar-2', ingested_at: '2026-08-28T02:00:00Z', parsed_at: '2026-08-28T01:00:00Z' }
    const result = await ingest({ documentId: 'doc-fr119-partial', artifactOver: badFields })
    const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: result.run.executionRunId } })
    const steps = await prisma.pipelineStep.findMany({ where: { runId: run.id }, orderBy: { sequence: 'asc' } })

    expect(steps.find((s) => s.pipelineStageId === 'DPS-KI-PARSE').status).toBe('SUCCEEDED')
    expect(steps.find((s) => s.pipelineStageId === 'DPS-KI-PROVENANCE').status).toBe('FAILED')
    // Every stage after the failure never ran — NOT_STARTED, not FAILED.
    for (const id of ['DPS-KI-NORMALIZE', 'DPS-KI-CLASSIFY', 'DPS-KI-DEDUPE', 'DPS-KI-CHUNK', 'DPS-KI-ENTITY-EXTRACT']) {
      expect(steps.find((s) => s.pipelineStageId === id).status).toBe('NOT_STARTED')
    }
  })

  it('carries a real, non-zero output hash for the stage that succeeded before the failure', async () => {
    const badFields = { source_version: 'v-quar-3', ingested_at: '2026-08-28T02:00:00Z', parsed_at: '2026-08-28T01:00:00Z' }
    const result = await ingest({ documentId: 'doc-fr119-hash', artifactOver: badFields })
    const succeededStage = result.stages.find((s) => s.pipelineStageId === 'DPS-KI-PARSE')
    expect(succeededStage.step.outputHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('keeps errorRef redacted — the raw message lives only in the returned quarantine envelope', async () => {
    const badFields = { source_version: 'v-quar-4', ingested_at: '2026-08-28T02:00:00Z', parsed_at: '2026-08-28T01:00:00Z' }
    const result = await ingest({ documentId: 'doc-fr119-redacted', artifactOver: badFields })
    const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: result.run.executionRunId } })
    const failedStep = await prisma.pipelineStep.findFirst({ where: { runId: run.id, pipelineStageId: 'DPS-KI-PROVENANCE' } })

    expect(failedStep.errorRef).not.toMatch(/ingested_at/) // the raw message never reaches the ledger
    expect(failedStep.errorRef).toContain('DPS-KI-PROVENANCE')
    expect(failedStep.failureCode).toBe('DPS-KI-PROVENANCE_VALIDATION_FAILED')
    expect(failedStep.retryable).toBe(false)
  })

  it('writes docId onto a RECORD_FAILED event — the document’s failure is bound to its own identity, not just the stage’s', async () => {
    const badFields = { source_version: 'v-quar-5', ingested_at: '2026-08-28T02:00:00Z', parsed_at: '2026-08-28T01:00:00Z' }
    const result = await ingest({ documentId: 'doc-fr119-record', artifactOver: badFields })
    const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: result.run.executionRunId } })
    const records = await prisma.pipelineRecordEvent.findMany({
      where: { runId: run.id, pipelineRecordId: 'doc-fr119-record' },
      orderBy: { occurredAt: 'asc' },
    })

    expect(records).toHaveLength(2) // RECORD_STARTED, RECORD_FAILED — no RECORD_SUCCEEDED
    expect(records.every((r) => r.docId === 'doc-fr119-record')).toBe(true)
    expect(records[0].status).toBe('RUNNING')
    expect(records[1].status).toBe('FAILED')
    expect(records[1].failureCode).toBe('DPS-KI-PROVENANCE_VALIDATION_FAILED')
  })

  it('records real failure counts (NFR-020) on the failing step, and the run aggregate includes them', async () => {
    const badFields = { source_version: 'v-quar-6', ingested_at: '2026-08-28T02:00:00Z', parsed_at: '2026-08-28T01:00:00Z' }
    const result = await ingest({ documentId: 'doc-fr119-counts', artifactOver: badFields })
    const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: result.run.executionRunId } })

    const failedStep = await prisma.pipelineStep.findFirst({ where: { runId: run.id, pipelineStageId: 'DPS-KI-PROVENANCE' } })
    expect(failedStep.failedCount).toBe(1)
    expect(failedStep.insertedCount).toBe(0)

    expect(run.failedCount).toBeGreaterThanOrEqual(1) // SDD-071's run-level aggregate includes the failure
  })

  it('is idempotent on the failure path too — re-ingesting the same broken artifact writes nothing new', async () => {
    const badFields = { source_version: 'v-quar-7', ingested_at: '2026-08-28T02:00:00Z', parsed_at: '2026-08-28T01:00:00Z' }
    const first = await ingest({ documentId: 'doc-fr119-idem', artifactOver: badFields })
    const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: first.run.executionRunId } })
    const before = {
      steps: await prisma.pipelineStep.count({ where: { runId: run.id } }),
      records: await prisma.pipelineRecordEvent.count({ where: { runId: run.id } }),
    }

    const second = await ingest({ documentId: 'doc-fr119-idem', artifactOver: badFields })

    expect(second.run.executionRunId).toBe(first.run.executionRunId)
    expect(second.quarantine.error_code).toBe(first.quarantine.error_code)
    expect(await prisma.pipelineStep.count({ where: { runId: run.id } })).toBe(before.steps)
    expect(await prisma.pipelineRecordEvent.count({ where: { runId: run.id } })).toBe(before.records)
  })

  it('fails at a later stage for a different failure mode, with more stages recorded as succeeded first', async () => {
    // Valid artifact, but a policy missing a required field -- fails at
    // Stage 5 (Classify), so Stages 2-4 (Parse, Provenance, Normalize) are
    // all real STEP_SUCCEEDED evidence.
    const incompletePolicy = policy()
    delete incompletePolicy.export_policy
    const result = await ingestKnowledgeDocument({
      documentId: 'doc-fr119-later-stage',
      text: DOC_TEXT,
      artifact: artifact({ source_version: 'v-quar-8' }),
      policy: incompletePolicy,
    }, { viewer })

    expect(result.quarantine.stage).toBe('DPS-KI-CLASSIFY')
    const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: result.run.executionRunId } })
    const steps = await prisma.pipelineStep.findMany({ where: { runId: run.id } })
    for (const id of ['DPS-KI-PARSE', 'DPS-KI-PROVENANCE', 'DPS-KI-NORMALIZE']) {
      expect(steps.find((s) => s.pipelineStageId === id).status).toBe('SUCCEEDED')
    }
    expect(steps.find((s) => s.pipelineStageId === 'DPS-KI-CLASSIFY').status).toBe('FAILED')
  })
})
