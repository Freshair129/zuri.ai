import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { makeOperatorViewer } from '../factories/viewer'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { ingestGenesisRag17Raw } from '@/platform/integrations/core/genesisrag17-executor'
import { GENESIS_RAG17_SCHEMA_VERSION } from '@/modules/knowledge/genesisrag17-contract'

// @req FR-173 — an OWNER-admitted TEXT/FILE document (provider
// `KNOWLEDGE_ADMISSION`, set by `knowledge-runtime.js` `processJob` for every
// ordinary admitted source with no structured descriptor) now runs the
// document Zero-PII policy at Stage 5 classify, through the real Tier 1
// executor against the real database: a phone number or a LINE user id
// stops the run there with terminal evidence, and a clean document still
// reaches Stage 8 exactly as before this lane.
// @spec ADR-072 (Amendment, 2026-09-24), ADR-090 D6 (revised 2026-09-14)
// @tested tests/integration/genesisrag17-tier1-knowledge-admission-zero-pii.test.js

const now = () => new Date('2026-09-24T09:00:00.000Z')

describe('GenesisRAG17 Tier 1 — KNOWLEDGE_ADMISSION Stage 5 Zero-PII gate (FR-173, ADR-072 Amendment)', () => {
  let portfolio
  let tenant
  let business
  let connection
  let viewer

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8)
    portfolio = await createPortfolio({ name: `KI17 KA portfolio ${suffix}`, code: `KI17-KA-PF-${suffix}` })
    tenant = await createTenant({ portfolioId: portfolio.id, name: `KI17 KA tenant ${suffix}`, code: `KI17-KA-TN-${suffix}` })
    business = await createBusiness({ tenantId: tenant.id, name: `KI17 KA business ${suffix}`, code: `KI17-KA-BU-${suffix}` })
    const provider = await prisma.integrationProvider.create({ data: { code: `KI17-KA-${suffix}`, name: 'Knowledge admission source', status: 'ACTIVE' } })
    connection = await prisma.integrationConnection.create({
      data: { tenantId: tenant.id, businessId: business.id, providerId: provider.id, name: 'KI17 KA source connection', status: 'ACTIVE' },
    })
    viewer = makeOperatorViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })
  })

  function input(content, over = {}) {
    const suffix = randomUUID().slice(0, 8)
    return {
      scope: { portfolioId: portfolio.id, tenantId: tenant.id, businessId: business.id, workspaceId: '', agentId: '', visibility: 'private' },
      sourceId: `knowledge-source:doc-${suffix}`,
      documentId: `doc-ka-${suffix}`,
      version: '1',
      content,
      connectionId: connection.id,
      provider: 'KNOWLEDGE_ADMISSION',
      policy: { allowEmbedding: true, allowPublication: true },
      ...over,
    }
  }

  const transport = (name, request) => Promise.resolve({
    schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
    scope: request.scope,
    batchId: request.batch?.batchId,
    decisionId: null,
    status: 'PENDING',
  })

  it('stops a TEXT document containing a phone number at Stage 5 with terminal evidence carrying the KNOWLEDGE_DOCUMENT_ZERO_PII_DENIED errorCode (the thrown error itself carries the policy identity and rule name, matching how SMARTGIFT_CATALOG/LINE_FAQ_CANDIDATE denials behave today — see the executor\'s generic failure path)', async () => {
    const raw = input('นโยบายการจัดส่ง: ติดต่อเจ้าหน้าที่ที่เบอร์ 081-234-5678 ทุกวันจันทร์ถึงศุกร์')
    let thrown
    try {
      await ingestGenesisRag17Raw(raw, { db: prisma, viewer, now, transport, credential: 'test-source' })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ status: 422, code: 'KNOWLEDGE_DOCUMENT_ZERO_PII_DENIED' })
    expect(JSON.stringify(thrown.details || {})).not.toContain('081-234-5678')

    const intent = await prisma.genesisRag17IngestionIntent.findFirst({ where: { sourceId: raw.sourceId } })
    const evidence = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: intent.executionRunId }, orderBy: { stageNumber: 'asc' } })
    expect(evidence.map((row) => row.stageNumber)).toEqual([1, 2, 3, 4, 5])
    expect(evidence.at(-1)).toMatchObject({ stageNumber: 5, outcome: 'FAILED', errorCount: 1 })
    const failureDetails = JSON.parse(evidence.at(-1).detailsJson)
    expect(failureDetails).toMatchObject({ errorCode: 'KNOWLEDGE_DOCUMENT_ZERO_PII_DENIED' })
    expect(JSON.stringify(failureDetails)).not.toContain('081-234-5678')
    expect(evidence.some((row) => row.stageNumber >= 6)).toBe(false)
    expect(await prisma.genesisRag17Batch.count({ where: { executionRunId: intent.executionRunId } })).toBe(0)
    expect(await prisma.genesisRag17SourceMention.count({ where: { executionRunId: intent.executionRunId } })).toBe(0)
    expect(intent).toMatchObject({ status: 'FAILED', nextStageNumber: 5 })
  })

  it('stops a TEXT document containing a LINE user id at Stage 5 with terminal evidence', async () => {
    const lineId = `U${'a1b2c3d4e5f60718293a4b5c6d7e8f90'}`
    const raw = input(`อ้างอิงจากแชทของลูกค้า ${lineId} เรื่องการจัดส่งล่าช้า`)
    let thrown
    try {
      await ingestGenesisRag17Raw(raw, { db: prisma, viewer, now, transport, credential: 'test-source' })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ status: 422, code: 'KNOWLEDGE_DOCUMENT_ZERO_PII_DENIED', details: { policy: 'knowledge-document-zero-pii-1', term: 'line_user_id' } })
    expect(JSON.stringify(thrown.details || {})).not.toContain(lineId)

    const intent = await prisma.genesisRag17IngestionIntent.findFirst({ where: { sourceId: raw.sourceId } })
    const evidence = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: intent.executionRunId }, orderBy: { stageNumber: 'asc' } })
    expect(evidence.map((row) => row.stageNumber)).toEqual([1, 2, 3, 4, 5])
    expect(evidence.at(-1)).toMatchObject({ stageNumber: 5, outcome: 'FAILED', errorCount: 1 })
  })

  // @req FR-173 — the docs (ADR-072 Amendment, CHARTER, flow doc) say a FILE
  // source is covered by the same Stage 5 path as TEXT because the executor
  // never branches on sourceType — only `value.content` matters. Prove it
  // rather than argue it: pass `sourceType: 'FILE'` through the real
  // executor and confirm the same denial.
  it('stops a FILE source containing a phone number at Stage 5, the same as a TEXT source', async () => {
    const raw = input('คู่มือการใช้งาน: ติดต่อฝ่ายสนับสนุนที่ 081-234-5678', { sourceType: 'FILE' })
    let thrown
    try {
      await ingestGenesisRag17Raw(raw, { db: prisma, viewer, now, transport, credential: 'test-source' })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ status: 422, code: 'KNOWLEDGE_DOCUMENT_ZERO_PII_DENIED', details: { policy: 'knowledge-document-zero-pii-1', term: 'phone_number' } })

    const intent = await prisma.genesisRag17IngestionIntent.findFirst({ where: { sourceId: raw.sourceId } })
    const evidence = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: intent.executionRunId }, orderBy: { stageNumber: 'asc' } })
    expect(evidence.map((row) => row.stageNumber)).toEqual([1, 2, 3, 4, 5])
    expect(evidence.at(-1)).toMatchObject({ stageNumber: 5, outcome: 'FAILED', errorCount: 1 })
  })

  it('lets a clean TEXT document reach Stage 8 and records the document policy identity in Stage 5 evidence', async () => {
    const raw = input('นโยบายการคืนสินค้า: ลูกค้าสามารถคืนสินค้าได้ภายใน 7 วันหลังจากได้รับสินค้า ตามเงื่อนไขของร้าน')
    const result = await ingestGenesisRag17Raw(raw, { db: prisma, viewer, now, transport, credential: 'test-source' })
    expect(result.schemaVersion).toBe(GENESIS_RAG17_SCHEMA_VERSION)

    const evidence = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: result.run.executionRunId }, orderBy: { stageNumber: 'asc' } })
    expect(evidence.map((row) => row.stageNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(JSON.parse(evidence[4].detailsJson)).toMatchObject({ zeroPiiPolicy: 'knowledge-document-zero-pii-1' })
  })
})
