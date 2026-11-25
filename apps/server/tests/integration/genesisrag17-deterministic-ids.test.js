import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { makeOperatorViewer } from '../factories/viewer'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { ingestGenesisRag17Raw, resolveGenesisRag17RawLineage } from '@/platform/integrations/core/genesisrag17-executor'
import { pullGenesisRag17Evidence } from '@/platform/integrations/core/genesisrag17-importer'
import { persistGenesisRag17PublicationReceipt } from '@/platform/integrations/core/genesisrag17-publication'
import {
  GENESIS_RAG17_SCHEMA_VERSION,
  hashGenesisRag17Json,
} from '@/modules/knowledge/genesisrag17-contract'

// @req FR-109 — deterministic artifact, intent, mention, batch and stage-evidence identities preserve immutable scoped lineage.
// @req FR-110 — publication receipts and evidence cursors retain deterministic scoped identities.
// @spec ADR-122
// @tested tests/integration/genesisrag17-deterministic-ids.test.js

const fixtureText = [
  '# Employment',
  '',
  'Alice works for Acme Ltd.',
  '',
  '# Purchase',
  '',
  'Alice purchased Atlas.',
  '',
  '# More',
  '',
  'Bob works for Beacon Ltd.',
  '',
  'Bob purchased Nimbus.',
].join('\n')

const now = () => new Date('2026-09-07T15:00:00.000Z')
const viewer = makeOperatorViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })
const idPattern = (prefix) => new RegExp(`^${prefix}_[0-9a-f]{48}$`)

describe('GenesisRAG17 deterministic scoped identities', () => {
  let scopeA
  let scopeB

  beforeAll(async () => {
    scopeA = await createSourceScope('A')
    scopeB = await createSourceScope('B')
  })

  async function createSourceScope(label) {
    const suffix = `${label}-${randomUUID().slice(0, 8)}`
    const portfolio = await createPortfolio({ name: `D7 portfolio ${suffix}`, code: `D7-PF-${suffix}` })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: `D7 tenant ${suffix}`, code: `D7-TN-${suffix}` })
    const business = await createBusiness({ tenantId: tenant.id, name: `D7 business ${suffix}`, code: `D7-BU-${suffix}` })
    const provider = await prisma.integrationProvider.create({
      data: { code: `D7-${suffix}`, name: 'GenesisRAG17 deterministic identity source', status: 'ACTIVE' },
    })
    const connection = await prisma.integrationConnection.create({
      data: { tenantId: tenant.id, businessId: business.id, providerId: provider.id, name: `D7 source ${suffix}`, status: 'ACTIVE' },
    })
    return {
      portfolio,
      tenant,
      business,
      connection,
      scope: { portfolioId: portfolio.id, tenantId: tenant.id, businessId: business.id, workspaceId: '', agentId: '', visibility: 'private' },
    }
  }

  function input(sourceScope, over = {}) {
    return {
      scope: sourceScope.scope,
      sourceId: 'synthetic://ki17/d7/deterministic-identity',
      documentId: 'doc-ki17-d7-deterministic-identity',
      version: '1',
      content: fixtureText,
      connectionId: sourceScope.connection.id,
      policy: { allowEmbedding: true, allowPublication: true },
      ...over,
    }
  }

  function sourceTransport(name, request) {
    return Promise.resolve({
      schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
      scope: request.scope,
      batchId: request.batch.batchId,
      decisionId: null,
      status: 'PENDING',
    })
  }

  async function ingest(sourceScope, over = {}) {
    return ingestGenesisRag17Raw(input(sourceScope, over), {
      db: prisma,
      viewer,
      now,
      transport: sourceTransport,
      credential: 'test-source',
    })
  }

  async function identityRows(result) {
    const [raw, parsed, intent, mentions, batches, evidence] = await Promise.all([
      prisma.knowledgeRawArtifact.findUnique({ where: { id: result.source.rawArtifactId } }),
      prisma.knowledgeParsedArtifact.findUnique({ where: { id: result.source.parsedArtifactId } }),
      prisma.genesisRag17IngestionIntent.findUnique({ where: { executionRunId: result.run.executionRunId } }),
      prisma.genesisRag17SourceMention.findMany({ where: { executionRunId: result.run.executionRunId }, orderBy: { id: 'asc' } }),
      prisma.genesisRag17Batch.findMany({ where: { executionRunId: result.run.executionRunId } }),
      prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: result.run.executionRunId }, orderBy: { stageNumber: 'asc' } }),
    ])
    return { raw, parsed, intent, mentions, batches, evidence }
  }

  function expectScopedRows(rows, scope) {
    expect(rows.raw).toMatchObject(scope)
    expect(rows.parsed).toMatchObject(scope)
    expect(rows.intent).toMatchObject(scope)
    expect(rows.mentions.length).toBeGreaterThan(0)
    expect(rows.mentions.every((row) => Object.entries(scope).every(([key, value]) => row[key] === value))).toBe(true)
    expect(rows.batches).toHaveLength(1)
    expect(JSON.parse(rows.batches[0].scopeJson)).toEqual(scope)
    expect(rows.evidence.length).toBeGreaterThan(0)
  }

  it('replays the same input with stable IDs and no additional persisted lineage rows', async () => {
    const first = await ingest(scopeA, { sourceId: 'synthetic://ki17/d7/reproducible' })
    const rows = await identityRows(first)

    expect(first.source.rawArtifactId).toMatch(idPattern('kra'))
    expect(first.source.parsedArtifactId).toMatch(idPattern('kpa'))
    expect(first.batch.batchId).toMatch(idPattern('grb'))
    expectScopedRows(rows, scopeA.scope)
    expect(rows.intent.id).toMatch(idPattern('gii'))
    expect(rows.mentions.every((row) => idPattern('gsm').test(row.id))).toBe(true)
    expect(rows.batches[0].id).toMatch(idPattern('grb'))
    expect(rows.batches[0].batchId).toBe(first.batch.batchId)
    expect(rows.evidence.every((row) => idPattern('gre').test(row.id))).toBe(true)

    const countSnapshot = await Promise.all([
      prisma.knowledgeRawArtifact.count({ where: { id: first.source.rawArtifactId } }),
      prisma.knowledgeParsedArtifact.count({ where: { id: first.source.parsedArtifactId } }),
      prisma.genesisRag17IngestionIntent.count({ where: { executionRunId: first.run.executionRunId } }),
      prisma.genesisRag17SourceMention.count({ where: { executionRunId: first.run.executionRunId } }),
      prisma.genesisRag17Batch.count({ where: { executionRunId: first.run.executionRunId } }),
      prisma.genesisRag17StageEvidence.count({ where: { executionRunId: first.run.executionRunId } }),
    ])

    const second = await ingest(scopeA, { sourceId: 'synthetic://ki17/d7/reproducible' })
    expect(second.run.executionRunId).toBe(first.run.executionRunId)
    expect(second.source.rawArtifactId).toBe(first.source.rawArtifactId)
    expect(second.source.parsedArtifactId).toBe(first.source.parsedArtifactId)
    expect(second.batch.batchId).toBe(first.batch.batchId)

    const countAfterReplay = await Promise.all([
      prisma.knowledgeRawArtifact.count({ where: { id: first.source.rawArtifactId } }),
      prisma.knowledgeParsedArtifact.count({ where: { id: first.source.parsedArtifactId } }),
      prisma.genesisRag17IngestionIntent.count({ where: { executionRunId: first.run.executionRunId } }),
      prisma.genesisRag17SourceMention.count({ where: { executionRunId: first.run.executionRunId } }),
      prisma.genesisRag17Batch.count({ where: { executionRunId: first.run.executionRunId } }),
      prisma.genesisRag17StageEvidence.count({ where: { executionRunId: first.run.executionRunId } }),
    ])
    expect(countAfterReplay).toEqual(countSnapshot)
  })

  it('keeps all deterministic row IDs isolated across tenants and rejects foreign-scope lineage', async () => {
    const sourceId = 'synthetic://ki17/d7/cross-tenant'
    const a = await ingest(scopeA, { sourceId })
    const b = await ingest(scopeB, { sourceId })
    const rowsA = await identityRows(a)
    const rowsB = await identityRows(b)
    expectScopedRows(rowsA, scopeA.scope)
    expectScopedRows(rowsB, scopeB.scope)

    const idsA = {
      raw: [rowsA.raw.id],
      parsed: [rowsA.parsed.id],
      intent: [rowsA.intent.id],
      mention: rowsA.mentions.map((row) => row.id),
      batch: rowsA.batches.map((row) => row.id),
      evidence: rowsA.evidence.map((row) => row.id),
    }
    const idsB = {
      raw: [rowsB.raw.id],
      parsed: [rowsB.parsed.id],
      intent: [rowsB.intent.id],
      mention: rowsB.mentions.map((row) => row.id),
      batch: rowsB.batches.map((row) => row.id),
      evidence: rowsB.evidence.map((row) => row.id),
    }
    for (const key of Object.keys(idsA)) {
      expect(idsA[key].every((id) => idPattern({ raw: 'kra', parsed: 'kpa', intent: 'gii', mention: 'gsm', batch: 'grb', evidence: 'gre' }[key]).test(id))).toBe(true)
      expect(idsB[key].every((id) => idPattern({ raw: 'kra', parsed: 'kpa', intent: 'gii', mention: 'gsm', batch: 'grb', evidence: 'gre' }[key]).test(id))).toBe(true)
      expect(idsA[key].filter((id) => idsB[key].includes(id))).toEqual([])
    }

    const aRun = await prisma.pipelineRun.findUnique({ where: { executionRunId: a.run.executionRunId } })
    const bRun = await prisma.pipelineRun.findUnique({ where: { executionRunId: b.run.executionRunId } })
    expect(aRun).toMatchObject({ tenantId: scopeA.tenant.id, businessId: scopeA.business.id })
    expect(bRun).toMatchObject({ tenantId: scopeB.tenant.id, businessId: scopeB.business.id })
    expect(rowsA.evidence.every((row) => row.runId === aRun.id)).toBe(true)
    expect(rowsB.evidence.every((row) => row.runId === bRun.id)).toBe(true)

    const bIds = Object.values(idsB).flat()
    for (const model of ['knowledgeRawArtifact', 'knowledgeParsedArtifact', 'genesisRag17IngestionIntent', 'genesisRag17SourceMention']) {
      const found = await prisma[model].findMany({ where: { ...scopeA.scope, id: { in: bIds } } })
      expect(found).toEqual([])
    }
    expect(await prisma.genesisRag17Batch.findMany({ where: { executionRunId: a.run.executionRunId, id: { in: bIds } } })).toEqual([])
    expect(await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: a.run.executionRunId, id: { in: bIds } } })).toEqual([])

    await expect(resolveGenesisRag17RawLineage({
      scope: scopeA.scope,
      sourceId,
      documentId: b.source.documentId,
      version: b.source.version,
      rawArtifactId: b.source.rawArtifactId,
      parsedArtifactId: b.source.parsedArtifactId,
      chunkId: b.chunks[0].chunkId,
    }, { db: prisma })).rejects.toMatchObject({
      status: 404,
      code: 'GENESISRAG17_LINEAGE_NOT_FOUND',
      message: 'GenesisRAG17 raw artifact is outside the requested scope or missing',
    })

    const nextVersion = await ingest(scopeA, { sourceId, version: '2' })
    expect(nextVersion.source.rawArtifactId).not.toBe(a.source.rawArtifactId)
    expect(nextVersion.source.parsedArtifactId).not.toBe(a.source.parsedArtifactId)
    expect(nextVersion.source.rawArtifactId).toMatch(idPattern('kra'))
    expect(nextVersion.source.parsedArtifactId).toMatch(idPattern('kpa'))

    const receiptFor = (sourceScope, result) => ({
      schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
      scope: sourceScope.scope,
      runId: result.run.executionRunId,
      decisionId: 'd7-shared-decision',
      decisionHash: '1'.repeat(64),
      snapshotId: 'd7-shared-snapshot',
      generation: 'd7-shared-generation',
      receiptHash: '2'.repeat(64),
      publishedAt: '2026-11-25T00:00:00.000Z',
      pointerHash: '3'.repeat(64),
      modelRevision: '614241f622f53c4eeff9890bdc4f31cfecc418b3',
      transactionFrontier: 'd7-shared-frontier',
      readback: { ok: true },
    })
    const receiptA = await persistGenesisRag17PublicationReceipt(receiptFor(scopeA, a), { db: prisma, now })
    const receiptARepeat = await persistGenesisRag17PublicationReceipt(receiptFor(scopeA, a), { db: prisma, now })
    const receiptB = await persistGenesisRag17PublicationReceipt(receiptFor(scopeB, b), { db: prisma, now })
    const receiptBRepeat = await persistGenesisRag17PublicationReceipt(receiptFor(scopeB, b), { db: prisma, now })
    expect(receiptA.status).toBe('CREATED')
    expect(receiptB.status).toBe('CREATED')
    expect(receiptARepeat.status).toBe('UNCHANGED')
    expect(receiptBRepeat.status).toBe('UNCHANGED')
    expect(receiptA.receipt.id).toMatch(idPattern('gpr'))
    expect(receiptB.receipt.id).toMatch(idPattern('gpr'))
    expect(receiptARepeat.receipt.id).toBe(receiptA.receipt.id)
    expect(receiptBRepeat.receipt.id).toBe(receiptB.receipt.id)
    expect(receiptA.receipt.id).not.toBe(receiptB.receipt.id)
    expect(JSON.parse(receiptA.receipt.scopeJson)).toEqual(scopeA.scope)
    expect(JSON.parse(receiptB.receipt.scopeJson)).toEqual(scopeB.scope)

    const evidenceTransport = async (name, request) => {
      expect(name).toBe('msp_pipeline_evidence')
      return {
        schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
        scope: request.scope,
        rows: [],
        nextCursor: request.afterCursor,
      }
    }
    const pull = (sourceScope, result) => pullGenesisRag17Evidence({
      schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
      scope: sourceScope.scope,
      runId: result.run.executionRunId,
    }, { db: prisma, viewer, transport: evidenceTransport, credential: 'test-source', now })
    await pull(scopeA, a)
    await pull(scopeA, a)
    await pull(scopeB, b)
    await pull(scopeB, b)

    const cursorFor = (sourceScope, result) => prisma.genesisRag17EvidenceCursor.findUnique({
      where: {
        runId_portfolioId_tenantId_businessId_workspaceId_agentId_visibility: {
          runId: result.run.executionRunId,
          ...sourceScope.scope,
        },
      },
    })
    const cursorA = await cursorFor(scopeA, a)
    const cursorB = await cursorFor(scopeB, b)
    expect(cursorA.id).toMatch(idPattern('gcur'))
    expect(cursorB.id).toMatch(idPattern('gcur'))
    expect(cursorA.id).not.toBe(cursorB.id)
    expect(cursorA).toMatchObject({ ...scopeA.scope, runId: a.run.executionRunId, cursor: 0 })
    expect(cursorB).toMatchObject({ ...scopeB.scope, runId: b.run.executionRunId, cursor: 0 })
    expect((await cursorFor(scopeA, a)).id).toBe(cursorA.id)
    expect((await cursorFor(scopeB, b)).id).toBe(cursorB.id)
    expect(await prisma.genesisRag17EvidenceCursor.findMany({ where: { ...scopeA.scope, id: cursorB.id } })).toEqual([])
    expect(await prisma.genesisRag17PublicationReceipt.findMany({ where: { executionRunId: a.run.executionRunId, id: receiptB.receipt.id } })).toEqual([])
  })

  it('hashes the same scope identically when its object keys are reordered', () => {
    const scope = { portfolioId: 'pf-d7', tenantId: 'tn-d7', businessId: 'bu-d7', workspaceId: '', agentId: '', visibility: 'private' }
    const reorderedScope = { visibility: 'private', agentId: '', workspaceId: '', businessId: 'bu-d7', tenantId: 'tn-d7', portfolioId: 'pf-d7' }
    expect(hashGenesisRag17Json(scope)).toBe(hashGenesisRag17Json(reorderedScope))
  })
})
