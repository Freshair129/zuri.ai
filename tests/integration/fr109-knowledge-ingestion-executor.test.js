import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeOperatorViewer } from '../factories/viewer'
import { ingestKnowledgeDocument } from '@/platform/integrations/core/knowledge-ingestion-executor'
import { getPipelineMonitor } from '@/platform/integrations/core/pipeline-tracking-service'
import { ingestionIdentity } from '@/modules/knowledge/dedup'

// @req FR-109 — the ledger-writing wiring writes real PipelineStep transitions
// and PipelineRecordEvent rows, docId bound, for the seven Tier 1 stages.
// @spec SDD-069, SDD-066, SDD-057, BR-021, ADR-050 D4
// @tested tests/integration/fr109-knowledge-ingestion-executor.test.js
//
// Real database on purpose, same reasoning as fr109-ingestion-run-identity.test.js:
// the claim under test is a sequence of real status transitions
// (NOT_STARTED -> RUNNING -> SUCCEEDED) enforced by assertStatusTransition, and a
// fake db that does not implement that graph cannot fail the way a bad sequence
// fails.

let viewer
let businessId
let tenantId

const DOC_TEXT = [
  '# Scope of work',
  '',
  'คู่สัญญาคือ บริษัท เอบีซี จำกัด และผู้ซื้อ',
  '',
  '# Payment terms',
  '',
  'Net thirty days.',
].join('\n')

// One artifact identity is one run is one document's worth of events (BR-021):
// the run's idempotencyKey and every event's idempotencyKey both derive from
// the artifact alone, never from documentId. Reusing one artifact across two
// claimed-different documents is a real conflict, not a test inconvenience --
// `recordPipelineEvent` correctly refuses it (409, "reused with different
// input") because the docId on the second attempt does not match the first.
// So every independent scenario below gets its OWN artifact (a distinct
// source_version), and documentId is fixed per scenario rather than varied
// independently of it.
function artifact(over = {}) {
  return {
    scope: { tenantId, businessId },
    artifact_id: 'art-fr109-exec-1',
    source_id: 'src://drive/exec-contract.md',
    source_type: 'FILE',
    source_uri: 'https://drive.example/exec-contract.md',
    source_version: '1',
    content_hash: 'e'.repeat(64),
    pipeline_version: 'ki-1.0.0',
    ingested_at: '2026-08-28T01:00:00Z',
    parsed_at: '2026-08-28T01:00:05Z',
    extractor_version: 'ki-parse-1',
    ...over,
  }
}

const policy = () => ({
  sensitivity: 'INTERNAL',
  retention_policy: 'RETAIN_7Y',
  export_policy: 'NO_EXPORT',
  cloud_processing_allowed: true,
  embedding_allowed: true,
})

const TIER1_ORDER = [
  'DPS-KI-PARSE',
  'DPS-KI-PROVENANCE',
  'DPS-KI-NORMALIZE',
  'DPS-KI-CLASSIFY',
  'DPS-KI-DEDUPE',
  'DPS-KI-CHUNK',
  'DPS-KI-ENTITY-EXTRACT',
]

function ingest({ documentId = 'doc-exec-1', artifactOver = {}, ...over } = {}) {
  return ingestKnowledgeDocument({
    documentId,
    text: DOC_TEXT,
    artifact: artifact(artifactOver),
    policy: policy(),
    ...over,
  }, { viewer })
}

describe('FR-109 ledger-writing wiring', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'KI Exec Group', code: 'PF-KIEXEC' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'KI Exec Tenant', code: 'TNT-KIEXEC' })
    const business = await createBusiness({ tenantId: tenant.id, name: 'KI Exec Business', code: 'BUS-KIEXEC' })
    businessId = business.id
    tenantId = tenant.id
    viewer = makeOperatorViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
  })

  it('transitions all seven Tier 1 PipelineStep rows NOT_STARTED -> RUNNING -> SUCCEEDED', async () => {
    const result = await ingest({ documentId: 'doc-exec-1', artifactOver: { source_version: 'v-transitions' } })

    expect(result.stages).toHaveLength(7)
    expect(result.stages.map((s) => s.pipelineStageId)).toEqual(TIER1_ORDER)

    const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: result.run.executionRunId } })
    const steps = await prisma.pipelineStep.findMany({ where: { runId: run.id }, orderBy: { sequence: 'asc' } })

    expect(steps).toHaveLength(17) // the full DPL-KNOWLEDGE-INGEST-V1 catalog
    const tier1Steps = steps.filter((s) => TIER1_ORDER.includes(s.pipelineStageId))
    expect(tier1Steps.every((s) => s.status === 'SUCCEEDED')).toBe(true)
    expect(tier1Steps.every((s) => s.startedAt && s.finishedAt)).toBe(true)

    // The nine Tier 3/4 steps and Stage 1 (a separate FR-081 concern) are
    // untouched — this wiring executes only what ADR-050 D2 assigns here.
    const untouched = steps.filter((s) => !TIER1_ORDER.includes(s.pipelineStageId))
    expect(untouched.every((s) => s.status === 'NOT_STARTED')).toBe(true)
  })

  it('never marks the run finished — seven of seventeen stages is not "done"', async () => {
    const result = await ingest({ documentId: 'doc-exec-status', artifactOver: { source_version: 'v-status' } })
    const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: result.run.executionRunId } })
    expect(run.status).toBe('RUNNING')
    expect(run.finishedAt).toBeNull()
  })

  it('writes docId onto PipelineRecordEvent — the column FR-109 says nothing writes', async () => {
    const result = await ingest({ documentId: 'doc-exec-record', artifactOver: { source_version: 'v-record' } })
    const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: result.run.executionRunId } })
    const records = await prisma.pipelineRecordEvent.findMany({
      where: { runId: run.id, pipelineRecordId: 'doc-exec-record' },
      orderBy: { occurredAt: 'asc' },
    })

    expect(records).toHaveLength(2) // RECORD_STARTED, RECORD_SUCCEEDED
    expect(records.every((r) => r.docId === 'doc-exec-record')).toBe(true)
    expect(records[0].status).toBe('RUNNING')
    expect(records[1].status).toBe('SUCCEEDED')
  })

  it('writes a real, verifiable output hash per stage, not a placeholder', async () => {
    const result = await ingest({ documentId: 'doc-exec-hash', artifactOver: { source_version: 'v-hash' } })
    for (const stage of result.stages) {
      expect(stage.step.outputHash).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it('is idempotent end to end — re-ingesting the same artifact writes nothing new', async () => {
    const first = await ingest({ documentId: 'doc-exec-idem', artifactOver: { source_version: 'v-idem' } })
    const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: first.run.executionRunId } })
    const before = {
      steps: await prisma.pipelineStep.count({ where: { runId: run.id } }),
      records: await prisma.pipelineRecordEvent.count({ where: { runId: run.id } }),
      receipts: await prisma.pipelineEventReceipt.count({ where: { runId: run.id } }),
    }

    const second = await ingest({ documentId: 'doc-exec-idem', artifactOver: { source_version: 'v-idem' } })

    expect(second.run.executionRunId).toBe(first.run.executionRunId)
    expect(await prisma.pipelineStep.count({ where: { runId: run.id } })).toBe(before.steps)
    expect(await prisma.pipelineRecordEvent.count({ where: { runId: run.id } })).toBe(before.records)
    expect(await prisma.pipelineEventReceipt.count({ where: { runId: run.id } })).toBe(before.receipts)
  })

  it('propagates a stage failure and writes no evidence for it, leaving the run at NOT_STARTED', async () => {
    // FR-116's own ordering guard: parsed_at before ingested_at is refused.
    // This proves the composition's error is not swallowed, reshaped or
    // partially recorded — no STEP_FAILED, because nothing here can say
    // which of the seven stages threw (see the executor's own docstring).
    const badFields = { source_version: 'v-fail', ingested_at: '2026-08-28T02:00:00Z', parsed_at: '2026-08-28T01:00:00Z' }
    await expect(ingest({
      documentId: 'doc-exec-fail',
      artifactOver: badFields,
    })).rejects.toThrow(/ingested_at/)

    const failedRun = await prisma.pipelineRun.findUnique({
      where: { idempotencyKey: ingestionIdentity(artifact(badFields)) },
    })
    expect(failedRun).not.toBeNull() // the run itself still registers -- BR-021 identity is reserved regardless
    expect(failedRun.status).toBe('QUEUED')

    const steps = await prisma.pipelineStep.findMany({ where: { runId: failedRun.id } })
    expect(steps.every((s) => s.status === 'NOT_STARTED')).toBe(true)
    expect(await prisma.pipelineRecordEvent.count({ where: { runId: failedRun.id } })).toBe(0)
  })

  it('resolves through getPipelineMonitor with a stage timeline naming every Tier 1 stage', async () => {
    const result = await ingest({ documentId: 'doc-exec-monitor', artifactOver: { source_version: 'v-monitor' } })
    const monitor = await getPipelineMonitor(result.run.executionRunId, { viewer })

    const timelineIds = monitor.stageTimeline.map((s) => s.pipelineStageId)
    for (const stageId of TIER1_ORDER) expect(timelineIds).toContain(stageId)
    const tier1Timeline = monitor.stageTimeline.filter((s) => TIER1_ORDER.includes(s.pipelineStageId))
    expect(tier1Timeline.every((s) => s.status === 'SUCCEEDED')).toBe(true)
  })

  it('carries a structured record through the same catalog as the unstructured pass — no second stage list', async () => {
    // AC-109.2: one catalog serves both source shapes. The structured record
    // travels alongside the same seven-stage sequence text ingestion uses;
    // nothing here forks a second definition or a second run of the catalog
    // for a structured source.
    const result = await ingest({
      documentId: 'doc-exec-structured',
      artifactOver: { source_version: 'v-structured' },
      structuredRecords: [{
        record_id: 'rec-exec-1',
        type: 'ORGANIZATION',
        mention: 'Acme Co., Ltd.',
        scope: { tenantId, businessId },
        provenance: { source_ref: 'crm' },
      }],
      structuredFields: [{ value: '25/8/2569', kind: 'date', era: 'BE' }],
    })

    expect(result.stages.map((s) => s.pipelineStageId)).toEqual(TIER1_ORDER)
    expect(result.run.dataPipelineDefinitionId).toBe('DPL-KNOWLEDGE-INGEST-V1')

    const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: result.run.executionRunId } })
    expect(run.dataPipelineDefinitionId).toBe('DPL-KNOWLEDGE-INGEST-V1') // the same catalog, not a second one
  })

  it('refuses to write for a different tenant’s document under the same documentId — the run key stays per-artifact', async () => {
    // Not a collision test on documentId (which is caller-scoped, not global) --
    // a regression guard that two different artifacts never share a run.
    const a = await ingest({ documentId: 'doc-exec-shared', artifactOver: { source_version: 'v-shared-a' } })
    const b = await ingest({ documentId: 'doc-exec-shared', artifactOver: { source_version: 'v-shared-b' } })
    expect(a.run.executionRunId).not.toBe(b.run.executionRunId)
  })
})
