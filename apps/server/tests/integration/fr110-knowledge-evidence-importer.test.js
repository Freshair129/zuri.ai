import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeOperatorViewer, makeViewer } from '../factories/viewer'
import { ingestKnowledgeDocument, readKnowledgeIngestionJob } from '@/platform/integrations/core/knowledge-ingestion-executor'
import {
  MSP_EVIDENCE_EXPORT_TOOL,
  classifyEvidenceRow,
  pullKnowledgeStageEvidence,
  stageReportFromEvidenceRow,
} from '@/platform/integrations/core/knowledge-evidence-importer'
import { KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS, KNOWLEDGE_QUALITY_GATE_STAGE_ID } from '@/platform/integrations/core/pipeline-tracking-contract'

// @req FR-110 — the pull importer: GKS's exported Stage 9–16 evidence lands on
// the FR-071 ledger through the reporter receiver, attributed by run_id, with
// a per-scope cursor that advances only past rows that landed.
// @req FR-109 — AC-109.12's lawful direction: nothing here calls GKS; the
// transport is MSP's tool surface, injected.
// @spec ADR-068 D1-D4, ADR-067 D2, ADR-050 D3, SDD-057
// @tested tests/integration/fr110-knowledge-evidence-importer.test.js
//
// Real database (the cursor row, the steps, the receipts are the claims);
// the MSP side is an in-memory transport with the exact `(name, input) =>
// Promise<page>` shape the stdio transport has, recording every call.

let operator
let tenantId
let businessId
let portfolioId

const PRODUCED_AT = '2026-09-07T12:00:00.000Z'

function artifact(over = {}) {
  return {
    scope: { tenantId, businessId },
    artifact_id: 'art-fr110-import-1',
    source_id: 'src://drive/fr110-import.md',
    source_type: 'FILE',
    source_uri: 'https://drive.example/fr110-import.md',
    source_version: '1',
    content_hash: 'c'.repeat(64),
    pipeline_version: 'ki-1.0.0',
    ingested_at: '2026-09-07T09:00:00Z',
    parsed_at: '2026-09-07T09:00:05Z',
    extractor_version: 'ki-parse-1',
    ...over,
  }
}

async function ingest(sourceVersion) {
  const result = await ingestKnowledgeDocument({
    documentId: `doc-fr110-import-${sourceVersion}`,
    text: '# Scope\n\nบริษัท เอบีซี จำกัด delivers the console.',
    artifact: artifact({ source_version: sourceVersion }),
    policy: { sensitivity: 'INTERNAL', retention_policy: 'RETAIN_7Y', export_policy: 'NO_EXPORT', cloud_processing_allowed: true, embedding_allowed: true },
  }, { viewer: operator })
  return result.run
}

const scope = (over = {}) => ({ portfolioId, tenantId, businessId, workspaceId: '', projectId: '', sharing: 'private', ...over })

let evidenceCounter = 0
function evidenceRow({ cursor, runId, stage = 'DPS-KI-ENTITY-RESOLVE', metrics = {}, rowScope = null, producedAt = PRODUCED_AT }) {
  evidenceCounter += 1
  return {
    cursor,
    evidence_id: `gks:evidence/${String(evidenceCounter).padStart(32, '0')}`,
    pipeline_stage_id: stage,
    pipeline_definition_id: 'DPL-KNOWLEDGE-INGEST-V1',
    execution_contract_id: 'EXC-KNOWLEDGE-INGEST-V1',
    run_id: runId,
    provenance_ref: `msp:proof/evidence-${cursor}`,
    scope: rowScope,
    evidence: { outcomes: { CREATED: 1 } },
    metrics: { records_in: 3, records_out: 2, records_failed: 1, records_quarantined: 0, processing_time_ms: 1500, retry_count: 0, ...metrics },
    records: [],
    produced_at: producedAt,
  }
}

/** The MSP tool surface, in memory: pages `rows` by since_cursor/limit and records calls. */
function transportOver(rows) {
  const calls = []
  const transport = async (name, input) => {
    calls.push({ name, input })
    if (name !== MSP_EVIDENCE_EXPORT_TOOL) throw new Error(`unexpected tool ${name}`)
    const page = rows.filter((row) => row.cursor > input.since_cursor).slice(0, input.limit)
    return { rows: page, next_cursor: page.length ? page[page.length - 1].cursor : input.since_cursor }
  }
  transport.calls = calls
  return transport
}

async function stepsOf(run) {
  const row = await prisma.pipelineRun.findUnique({ where: { executionRunId: run.executionRunId } })
  return Object.fromEntries((await prisma.pipelineStep.findMany({ where: { runId: row.id } })).map((step) => [step.pipelineStageId, step]))
}

const cursorRowFor = (s) => prisma.knowledgeEvidenceCursor.findUnique({
  where: { portfolioId_tenantId_businessId_workspaceId_projectId_sharing: s },
})

describe('FR-110 — the GKS evidence pull importer (ADR-068)', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'KI Import Group', code: 'PF-KIIMP' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'KI Import Tenant', code: 'TNT-KIIMP' })
    const business = await createBusiness({ tenantId: tenant.id, name: 'KI Import Business', code: 'BUS-KIIMP' })
    portfolioId = portfolio.id
    tenantId = tenant.id
    businessId = business.id
    operator = makeOperatorViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
  })

  it('applies exported external-stage rows onto the run they name, and persists the scope cursor after the page', async () => {
    const run = await ingest('v-apply')
    const s = scope({ workspaceId: 'ws-apply' })
    const rows = [
      evidenceRow({ cursor: 1, runId: run.executionRunId, stage: 'DPS-KI-ENTITY-RESOLVE', metrics: { records_in: 4, records_out: 3, records_failed: 0, records_quarantined: 1, processing_time_ms: 2500, retry_count: 1 } }),
      evidenceRow({ cursor: 2, runId: run.executionRunId, stage: 'DPS-KI-FACT-EXTRACT' }),
    ]
    const transport = transportOver(rows)

    const result = await pullKnowledgeStageEvidence({ scope: s }, { viewer: operator, transport })
    expect(result).toMatchObject({ startCursor: 0, cursor: 2, pages: 1, blocked: null, unattributed: [], held: [] })
    expect(result.applied.map((entry) => [entry.cursor, entry.pipelineStageId, entry.status])).toEqual([
      [1, 'DPS-KI-ENTITY-RESOLVE', 'CREATED'],
      [2, 'DPS-KI-FACT-EXTRACT', 'CREATED'],
    ])
    expect(transport.calls[0]).toEqual({ name: MSP_EVIDENCE_EXPORT_TOOL, input: { actor: 'zuri-ai-knowledge-evidence-importer', scope: s, since_cursor: 0, limit: 100 } })

    const steps = await stepsOf(run)
    expect(steps['DPS-KI-ENTITY-RESOLVE']).toMatchObject({ status: 'SUCCEEDED', actualCount: 4, insertedCount: 3, failedCount: 0 })
    expect(steps['DPS-KI-FACT-EXTRACT']).toMatchObject({ status: 'SUCCEEDED', actualCount: 3, insertedCount: 2, failedCount: 1 })
    // ADR-067 D2 — the ledger's step interval is the execution's, reconstructed
    // from produced_at and processing_time_ms, not the moment of the pull.
    expect(steps['DPS-KI-ENTITY-RESOLVE'].finishedAt.toISOString()).toBe(PRODUCED_AT)
    expect(steps['DPS-KI-ENTITY-RESOLVE'].startedAt.toISOString()).toBe('2026-09-07T11:59:57.500Z')
    expect(steps['DPS-KI-ONTOLOGY-MAP'].status).toBe('NOT_STARTED')

    const cursorRow = await cursorRowFor(s)
    expect(cursorRow).toMatchObject({ cursor: 2 })
    expect(cursorRow.lastPulledAt).toBeInstanceOf(Date)

    // The next pull starts from the durable cursor and finds nothing new.
    const again = await pullKnowledgeStageEvidence({ scope: s }, { viewer: operator, transport })
    expect(again).toMatchObject({ startCursor: 2, cursor: 2, applied: [] })
    expect(transport.calls[1].input.since_cursor).toBe(2)
  })

  it('replaying a page is a no-op on the ledger — the receiver’s idempotency, not a second write', async () => {
    const run = await ingest('v-replay')
    const s = scope({ workspaceId: 'ws-replay' })
    const transport = transportOver([evidenceRow({ cursor: 1, runId: run.executionRunId, stage: 'DPS-KI-EMBED' })])
    await pullKnowledgeStageEvidence({ scope: s }, { viewer: operator, transport })
    const runRow = await prisma.pipelineRun.findUnique({ where: { executionRunId: run.executionRunId } })
    const receipts = await prisma.pipelineEventReceipt.count({ where: { runId: runRow.id } })

    // Forget the cursor, as a crash before the upsert would.
    await prisma.knowledgeEvidenceCursor.delete({ where: { portfolioId_tenantId_businessId_workspaceId_projectId_sharing: s } })
    const replay = await pullKnowledgeStageEvidence({ scope: s }, { viewer: operator, transport })
    expect(replay.applied.map((entry) => entry.status)).toEqual(['UNCHANGED'])
    expect(await prisma.pipelineEventReceipt.count({ where: { runId: runRow.id } })).toBe(receipts)
    expect((await cursorRowFor(s)).cursor).toBe(1)
  })

  it('passes over evidence no run of ours owns — recorded as unattributed — and holds GKS’s half of Stage 17', async () => {
    const run = await ingest('v-unattributed')
    const s = scope({ workspaceId: 'ws-unattributed' })
    const transport = transportOver([
      evidenceRow({ cursor: 1, runId: null }), // a backfilled promotion or a human decision
      evidenceRow({ cursor: 2, runId: 'run-that-was-never-minted-here' }),
      evidenceRow({ cursor: 3, runId: run.executionRunId, stage: KNOWLEDGE_QUALITY_GATE_STAGE_ID }),
      evidenceRow({ cursor: 4, runId: run.executionRunId, stage: 'DPS-KI-INDEX' }),
    ])
    const result = await pullKnowledgeStageEvidence({ scope: s }, { viewer: operator, transport })
    expect(result.unattributed.map((entry) => [entry.cursor, entry.reason])).toEqual([[1, 'NO_RUN_ID'], [2, 'RUN_NOT_FOUND']])
    expect(result.held.map((entry) => [entry.cursor, entry.reason])).toEqual([[3, 'STAGE17_PARTIAL_EVIDENCE_NO_VERDICT']])
    expect(result.applied.map((entry) => entry.cursor)).toEqual([4])
    expect(result).toMatchObject({ cursor: 4, blocked: null })
    const steps = await stepsOf(run)
    expect(steps['DPS-KI-INDEX'].status).toBe('SUCCEEDED')
    expect(steps[KNOWLEDGE_QUALITY_GATE_STAGE_ID].status).toBe('NOT_STARTED')
    expect((await prisma.pipelineGateDecision.count({ where: { runId: (await prisma.pipelineRun.findUnique({ where: { executionRunId: run.executionRunId } })).id } }))).toBe(0)
  })

  it('a contract violation on an attributable row blocks: the cursor stops before it and it is seen again next pull', async () => {
    const run = await ingest('v-blocked')
    const s = scope({ workspaceId: 'ws-blocked' })
    const transport = transportOver([
      evidenceRow({ cursor: 1, runId: run.executionRunId, stage: 'DPS-KI-ENRICH' }),
      evidenceRow({ cursor: 2, runId: run.executionRunId, stage: 'DPS-KI-CHUNK' }), // a Tier 1 stage from a Tier 3 export
      evidenceRow({ cursor: 3, runId: run.executionRunId, stage: 'DPS-KI-TEMPORAL-MAP' }),
    ])
    const result = await pullKnowledgeStageEvidence({ scope: s }, { viewer: operator, transport })
    expect(result.applied.map((entry) => entry.cursor)).toEqual([1])
    expect(result.blocked).toMatchObject({ cursor: 2, pipelineStageId: 'DPS-KI-CHUNK', reason: 'NOT_AN_EXTERNAL_STAGE:DPS-KI-CHUNK' })
    expect(result.cursor).toBe(1)
    expect((await cursorRowFor(s)).cursor).toBe(1)
    const steps = await stepsOf(run)
    expect(steps['DPS-KI-ENRICH'].status).toBe('SUCCEEDED')
    expect(steps['DPS-KI-TEMPORAL-MAP'].status).toBe('NOT_STARTED') // never reached past the block
    expect(steps['DPS-KI-CHUNK'].status).toBe('SUCCEEDED') // Tier 1's own evidence, untouched

    const again = await pullKnowledgeStageEvidence({ scope: s }, { viewer: operator, transport })
    expect(again.blocked).toMatchObject({ cursor: 2 })
    expect(again.applied).toEqual([])
  })

  it('a row whose GKS scope contradicts the run’s Tenant or Business blocks rather than lands', async () => {
    const run = await ingest('v-scope')
    const s = scope({ workspaceId: 'ws-scope' })
    const transport = transportOver([
      evidenceRow({ cursor: 1, runId: run.executionRunId, rowScope: scope({ tenantId: 'some-other-tenant' }) }),
    ])
    const result = await pullKnowledgeStageEvidence({ scope: s }, { viewer: operator, transport })
    expect(result.blocked).toMatchObject({ cursor: 1, reason: 'SCOPE_TENANT_MISMATCH' })
    expect((await stepsOf(run))['DPS-KI-ENTITY-RESOLVE'].status).toBe('NOT_STARTED')
  })

  it('pages through the export at the requested limit and stops at maxPages', async () => {
    const run = await ingest('v-pages')
    const s = scope({ workspaceId: 'ws-pages' })
    const stages = [...KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS]
    const transport = transportOver(stages.map((stage, index) => evidenceRow({ cursor: index + 1, runId: run.executionRunId, stage })))

    const first = await pullKnowledgeStageEvidence({ scope: s, limit: 3, maxPages: 2 }, { viewer: operator, transport })
    expect(first).toMatchObject({ pages: 2, cursor: 6 })
    expect(first.applied).toHaveLength(6)
    const rest = await pullKnowledgeStageEvidence({ scope: s, limit: 3 }, { viewer: operator, transport })
    expect(rest).toMatchObject({ startCursor: 6, cursor: 8 })
    expect(rest.applied.map((entry) => entry.cursor)).toEqual([7, 8])
    const job = await readKnowledgeIngestionJob(run.executionRunId, { viewer: operator })
    expect(job.job).toMatchObject({ state: 'VALIDATING', reason: 'EXTERNAL_STAGES_COMPLETE' })
  })

  it('refuses a non-operator, a missing transport, and a page that is not GKS’s contract', async () => {
    const s = scope({ workspaceId: 'ws-refuse' })
    const owner = makeViewer({ visibleBusinessIds: [businessId], ownedBusinessIds: [businessId] })
    await expect(pullKnowledgeStageEvidence({ scope: s }, { viewer: owner, transport: transportOver([]) })).rejects.toMatchObject({ status: 403 })
    await expect(pullKnowledgeStageEvidence({ scope: s }, { viewer: operator })).rejects.toMatchObject({ status: 503 })
    await expect(pullKnowledgeStageEvidence({ scope: { tenantId } }, { viewer: operator, transport: transportOver([]) })).rejects.toThrow()
    const malformed = async () => ({ rows: [{ cursor: 1, pipeline_stage_id: 'DPS-KI-EMBED' }], next_cursor: 1 })
    await expect(pullKnowledgeStageEvidence({ scope: s }, { viewer: operator, transport: malformed })).rejects.toThrow()
    const unordered = async () => ({ rows: [evidenceRow({ cursor: 2, runId: null }), evidenceRow({ cursor: 1, runId: null })], next_cursor: 2 })
    await expect(pullKnowledgeStageEvidence({ scope: s }, { viewer: operator, transport: unordered })).rejects.toMatchObject({ status: 502 })
    expect(await cursorRowFor(s)).toBeNull()
  })

  it('classifies and maps rows purely', () => {
    const run = { executionRunId: 'run-x', tenantId: 'T', businessId: 'B', dataPipelineDefinitionId: 'DPL-KNOWLEDGE-INGEST-V1' }
    const step = { executionStepId: 'step-x', attemptId: 'attempt-x' }
    expect(classifyEvidenceRow(evidenceRow({ cursor: 1, runId: 'run-x' }), run, step)).toEqual({ disposition: 'apply', reason: null })
    expect(classifyEvidenceRow(evidenceRow({ cursor: 1, runId: 'run-x' }), run, null)).toEqual({ disposition: 'blocked', reason: 'STEP_NOT_MATERIALISED' })
    expect(classifyEvidenceRow(evidenceRow({ cursor: 1, runId: 'run-x' }), { ...run, dataPipelineDefinitionId: 'DPL-SUPABASE-BUSINESS-KNOWLEDGE-V1' }, step))
      .toEqual({ disposition: 'unattributed', reason: 'NOT_A_KNOWLEDGE_RUN' })
    const report = stageReportFromEvidenceRow(evidenceRow({ cursor: 9, runId: 'run-x', metrics: { processing_time_ms: 60000 } }), run, step)
    expect(report).toMatchObject({
      executionRunId: 'run-x', executionStepId: 'step-x', attemptId: 'attempt-x',
      scope: { tenantId: 'T', businessId: 'B' }, outcome: 'SUCCEEDED', failure: null,
      startedAt: '2026-09-07T11:59:00.000Z', finishedAt: PRODUCED_AT,
      metrics: { processing_time: 60000, records_in: 3 },
    })
  })
})
