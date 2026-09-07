import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeOperatorViewer } from '../factories/viewer'
import { createMspStdioTransport } from '@/modules/agent/msp-stdio-transport'
import { ingestKnowledgeDocument, readKnowledgeIngestionJob } from '@/platform/integrations/core/knowledge-ingestion-executor'
import { pullKnowledgeStageEvidence } from '@/platform/integrations/core/knowledge-evidence-importer'

// @req FR-110 — the whole lawful chain, live: zuri-ai's Tier 1 run → a Stage 9
//   execution in the real GKS (reached through the real MSP, naming the run)
//   → GKS's stage_evidence row → pulled back through MSP by the importer →
//   the run's DPS-KI-ENTITY-RESOLVE step on this ledger. Three repositories,
//   one pipeline_job_id.
// @req FR-109 — AC-109.12 with real evidence from a real Tier 3.
// @spec ADR-068 D1-D3, ADR-067 D2, ADR-050 D3, ADR-043 D2
// @tested tests/integration/fr110-knowledge-evidence-chain.test.js
//
// Runs only when both sibling checkouts are named — the same discipline GKS's
// own msp-service-chain suite uses with MSP_REPO_ROOT. Without them it skips
// and proves nothing; that is stated rather than hidden.

const mspRoot = process.env.ZURI_MSP_REPO_ROOT
const gksRoot = process.env.ZURI_GKS_REPO_ROOT

let dir
let transport
let operator
let tenantId
let businessId

describe.skipIf(!mspRoot || !gksRoot)('FR-110 — evidence pull, live across zuri-ai → MSP → GKS', () => {
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'zuri-ki-chain-'))
    transport = createMspStdioTransport({
      command: process.execPath,
      args: [path.join(mspRoot, 'apps/msp-server/bin/msp-server.mjs')],
      cwd: mspRoot,
      env: {
        ...process.env,
        MSP_DB_PATH: path.join(dir, 'msp.sqlite'),
        MSP_GKS_COMMAND: process.execPath,
        MSP_GKS_ARGS: JSON.stringify([path.join(gksRoot, 'apps/gks-server/bin/gks-server.mjs')]),
        MSP_GKS_CWD: gksRoot,
        GKS_DB_PATH: path.join(dir, 'gks.sqlite'),
        OLLAMA_BASE_URL: 'http://127.0.0.1:1',
      },
      timeoutMs: 30_000,
    })
    const portfolio = await createPortfolio({ name: 'KI Chain Group', code: 'PF-KICHAIN' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'KI Chain Tenant', code: 'TNT-KICHAIN' })
    const business = await createBusiness({ tenantId: tenant.id, name: 'KI Chain Business', code: 'BUS-KICHAIN' })
    tenantId = tenant.id
    businessId = business.id
    operator = makeOperatorViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
  })

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250))
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('a Stage 9 execution in GKS reaches this ledger as DPS-KI-ENTITY-RESOLVE on the run that asked for it', async () => {
    const { run } = await ingestKnowledgeDocument({
      documentId: 'doc-ki-chain-1',
      text: '# Scope\n\nบริษัท เอบีซี จำกัด delivers the console.',
      artifact: {
        scope: { tenantId, businessId }, artifact_id: 'art-ki-chain-1', source_id: 'src://drive/ki-chain.md',
        source_type: 'FILE', source_uri: 'https://drive.example/ki-chain.md', source_version: 'chain-1',
        content_hash: 'd'.repeat(64), pipeline_version: 'ki-1.0.0', ingested_at: '2026-09-07T09:00:00Z',
        parsed_at: '2026-09-07T09:00:05Z', extractor_version: 'ki-parse-1',
      },
      policy: { sensitivity: 'INTERNAL', retention_policy: 'RETAIN_7Y', export_policy: 'NO_EXPORT', cloud_processing_allowed: true, embedding_allowed: true },
    }, { viewer: operator })
    const scope = { portfolioId: 'portfolio-zuri', tenantId, businessId, workspaceId: '', projectId: '', sharing: 'private' }

    // Tier 3 executes Stage 9, reached the only lawful way and told which run
    // it is executing for. (What sends Stage 8's candidates here in production
    // is the forward handoff; this test plays that caller.)
    const promoted = await transport('msp_knowledge_promote', {
      schema_version: 'govibe-knowledge-candidate/v1',
      idempotency_key: `ki-chain-${run.executionRunId}`,
      run_id: run.executionRunId,
      stage: 1,
      source_snapshot_hash: 'd'.repeat(64),
      provenance_ref: `msp:proof/ki-chain-${run.executionRunId}`,
      pipeline_stage_id: 'DPS-KI-ENTITY-RESOLVE',
      scope,
      candidate: { entities: [{ candidateRef: 'บริษัท เอบีซี จำกัด', type: 'ENTITY', title: 'บริษัท เอบีซี จำกัด', summary: 'from Stage 8' }] },
    })
    expect(promoted.knowledge_ref).toMatch(/^gks:knowledge\//)

    const pulled = await pullKnowledgeStageEvidence({ scope }, { viewer: operator, transport })
    expect(pulled.blocked).toBeNull()
    expect(pulled.applied).toEqual([expect.objectContaining({ runId: run.executionRunId, pipelineStageId: 'DPS-KI-ENTITY-RESOLVE', status: 'CREATED' })])
    expect(pulled.cursor).toBeGreaterThan(0)

    const runRow = await prisma.pipelineRun.findUnique({ where: { executionRunId: run.executionRunId } })
    const step = await prisma.pipelineStep.findFirst({ where: { runId: runRow.id, pipelineStageId: 'DPS-KI-ENTITY-RESOLVE' } })
    expect(step).toMatchObject({ status: 'SUCCEEDED', actualCount: 1, insertedCount: 1, failedCount: 0 })
    const job = await readKnowledgeIngestionJob(run.executionRunId, { viewer: operator })
    expect(job.job.state).toBe('PROCESSING')

    // The cursor is durable: a second pull reads past what landed.
    const again = await pullKnowledgeStageEvidence({ scope }, { viewer: operator, transport })
    expect(again).toMatchObject({ startCursor: pulled.cursor, applied: [] })
  })
})
