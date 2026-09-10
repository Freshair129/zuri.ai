// @req FR-187 — one SmartGift projection enters through the FR-173 admission
// queue as N immutable FILE sources sharing one FileAsset, and a
// customer-shaped record dies at Stage 5 classify with terminal evidence and
// no Stage 6+ result, against the real database.
// @spec ADR-075 D2, ADR-075 D3, ADR-075 D5, ADR-072, ADR-073
// @tested tests/integration/smartgift-catalog-admission.test.js
import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeOperatorViewer, makeViewer } from '../factories/viewer'
import { admitKnowledge } from '@/modules/knowledge/knowledge-admission-service'
import { ingestGenesisRag17Raw } from '@/platform/integrations/core/genesisrag17-executor'
import {
  canonicalGenesisRag17Json,
  GENESIS_RAG17_SCHEMA_VERSION,
} from '@/modules/knowledge/genesisrag17-contract'
import {
  SMARTGIFT_CATALOG_CONTENT_TYPE,
  SMARTGIFT_CATALOG_FORMAT,
  SMARTGIFT_CATALOG_PROVIDER,
} from '@/modules/knowledge/smartgift-catalog-adapter'

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/genesisrag17/smartgift-catalog',
)
const productsText = readFileSync(path.join(fixtureDir, 'products.json'), 'utf8')
const sha256 = (text) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')

let portfolio
let tenant
let business
let viewer
let operator
let connection
const saved = {}

const scopeFor = () => ({
  portfolioId: portfolio.id,
  tenantId: tenant.id,
  businessId: business.id,
  workspaceId: 'workspace-smartgift-catalog',
  agentId: 'agent-smartgift-catalog',
  visibility: 'private',
})

async function createJsonAsset(text, { mime = 'application/json', name = 'products.json' } = {}) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
  return prisma.fileAsset.create({
    data: {
      code: `FA-SG-${suffix}`,
      tenantId: tenant.id,
      businessId: business.id,
      projectId: null,
      storageKind: 'MANAGED_BLOB',
      blobRef: `memory://${suffix}`,
      name,
      mime,
      size: Buffer.byteLength(text, 'utf8'),
      sha256: sha256(text),
      status: 'ACTIVE',
    },
  })
}

const contentResolverFor = (text) => async () => ({ content: Buffer.from(text, 'utf8') })

function admit(asset, text, { idempotencyKey, format = SMARTGIFT_CATALOG_FORMAT } = {}) {
  return admitKnowledge({
    businessId: business.id,
    idempotencyKey: idempotencyKey || `smartgift-${randomUUID().slice(0, 8)}`,
    source: { kind: 'FILE', fileAssetId: asset.id, ...(format ? { format } : {}) },
  }, { viewer, fileContentResolver: contentResolverFor(text) })
}

describe('SmartGift structured-record admission (FR-187)', () => {
  beforeAll(async () => {
    for (const name of ['ZURI_KNOWLEDGE_ENABLED', 'ZURI_KNOWLEDGE_BINDINGS', 'MSP_PIPELINE_PRINCIPALS', 'ZURI_MSP_COMMAND']) saved[name] = process.env[name]
    const suffix = randomUUID().slice(0, 8)
    portfolio = await createPortfolio({ name: `SmartGift portfolio ${suffix}`, code: `SG-PF-${suffix}` })
    tenant = await createTenant({ portfolioId: portfolio.id, name: `SmartGift tenant ${suffix}`, code: `SG-TN-${suffix}` })
    business = await createBusiness({ tenantId: tenant.id, name: `SmartGift business ${suffix}`, code: `SG-BU-${suffix}` })
    viewer = makeViewer({ role: 'OWNER', visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    operator = makeOperatorViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })
    const provider = await prisma.integrationProvider.create({ data: { code: `SG-${suffix}`, name: 'SmartGift catalog source', status: 'ACTIVE' } })
    connection = await prisma.integrationConnection.create({
      data: { tenantId: tenant.id, businessId: business.id, providerId: provider.id, name: 'SmartGift catalog connection', status: 'ACTIVE' },
    })
    const scope = scopeFor()
    process.env.ZURI_KNOWLEDGE_ENABLED = '1'
    process.env.ZURI_KNOWLEDGE_BINDINGS = JSON.stringify([{ scope, policy: { allowEmbedding: true, allowPublication: true } }])
    process.env.MSP_PIPELINE_PRINCIPALS = JSON.stringify([{ role: 'source', credential: 'test-credential', scope }])
    process.env.ZURI_MSP_COMMAND = process.execPath
  })

  afterAll(async () => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    await prisma.$disconnect()
  })

  it('fans one projection out into five FILE sources that all share the one FileAsset', async () => {
    const asset = await createJsonAsset(productsText)
    const result = await admit(asset, productsText)

    expect(result).toMatchObject({
      format: SMARTGIFT_CATALOG_FORMAT,
      fileAssetId: asset.id,
      fileSha256: sha256(productsText),
      recordCount: 5,
      admittedCount: 5,
      unchangedCount: 0,
      deniedCount: 0,
      unchanged: false,
    })
    expect(result.items).toHaveLength(5)

    const sources = await prisma.knowledgeSource.findMany({
      where: { fileAssetId: asset.id },
      orderBy: { sourceKey: 'asc' },
    })
    expect(sources).toHaveLength(5)
    // The shared fileAssetId is what keeps the existing per-source ACL and
    // revocation checks correct for every derived record.
    expect(sources.every((source) => source.kind === 'FILE' && source.fileAssetId === asset.id)).toBe(true)
    expect(sources.map((source) => source.sourceKey)).toEqual([
      'smartgift-catalog:products.json#PM-BOTTLE-LED',
      'smartgift-catalog:products.json#PM-NB',
      'smartgift-catalog:products.json#PM-PB10K',
      'smartgift-catalog:products.json#PM-PEN',
      'smartgift-catalog:products.json#PM-TMB',
    ])

    const ingestions = await prisma.knowledgeIngestion.findMany({ where: { sourceId: { in: sources.map((source) => source.id) } } })
    expect(ingestions).toHaveLength(5)
    // ADR-075 D3 — the file-level registry hash is every record's version.
    expect(new Set(ingestions.map((row) => row.sourceVersion))).toEqual(new Set([sha256(productsText)]))
    expect(ingestions.every((row) => row.status === 'QUEUED' && row.executionRunId === null)).toBe(true)
    for (const row of ingestions) {
      expect(sha256(row.content)).toBe(row.contentHash)
      const meta = JSON.parse(row.sourceMetaJson)
      expect(meta.structured).toMatchObject({
        format: SMARTGIFT_CATALOG_FORMAT,
        provider: SMARTGIFT_CATALOG_PROVIDER,
        contentType: SMARTGIFT_CATALOG_CONTENT_TYPE,
        entityType: 'ProductMaster',
      })
      expect(meta).not.toHaveProperty('content')
    }
  })

  it('returns every record unchanged when the identical bytes are re-admitted', async () => {
    const asset = await prisma.fileAsset.findFirst({ where: { businessId: business.id, name: 'products.json' }, orderBy: { createdAt: 'asc' } })
    const repeated = await admit(asset, productsText, { idempotencyKey: 'a-different-request-key' })
    expect(repeated).toMatchObject({ recordCount: 5, admittedCount: 0, unchangedCount: 5, unchanged: true })
    expect(await prisma.knowledgeSource.count({ where: { fileAssetId: asset.id } })).toBe(5)
    expect(await prisma.knowledgeIngestion.count({ where: { source: { fileAssetId: asset.id } } })).toBe(5)
  })

  it('gives a changed record a new content hash and a new version, never a rewrite', async () => {
    // A correction is a new version of the same managed file, which is how file
    // management represents an edited FileAsset: same id, new bytes and hash.
    const asset = await prisma.fileAsset.findFirst({ where: { businessId: business.id, name: 'products.json' }, orderBy: { createdAt: 'asc' } })
    const rows = JSON.parse(productsText)
    rows.find((row) => row.externalId === 'PM-NB').srpPriceThbQty1 = 999
    const changedText = JSON.stringify(rows)
    const changed = await prisma.fileAsset.update({
      where: { id: asset.id },
      data: { sha256: sha256(changedText), size: Buffer.byteLength(changedText, 'utf8'), version: { increment: 1 } },
    })
    const result = await admit(changed, changedText)
    expect(result).toMatchObject({ recordCount: 5, admittedCount: 5, deniedCount: 0 })

    // Still five sources: the same keys took a second revision rather than
    // spawning parallel rows.
    expect(await prisma.knowledgeSource.count({ where: { fileAssetId: asset.id } })).toBe(5)
    const changedSource = await prisma.knowledgeSource.findFirst({ where: { sourceKey: 'smartgift-catalog:products.json#PM-NB', fileAssetId: asset.id } })
    expect(changedSource.desiredRevision).toBe(2)

    const versions = await prisma.knowledgeIngestion.findMany({ where: { sourceId: changedSource.id }, orderBy: { revision: 'asc' } })
    expect(versions).toHaveLength(2)
    expect(versions[0].contentHash).not.toBe(versions[1].contentHash)
    expect(versions.map((row) => row.sourceVersion)).toEqual([sha256(productsText), sha256(changedText)])
    expect(JSON.parse(versions[0].content).srpPriceThbQty1).toBe(750)
    expect(JSON.parse(versions[1].content).srpPriceThbQty1).toBe(999)

    // ADR-075 D3 keys the version to the whole file, so an untouched record
    // also takes a new version — with an identical content hash, which is what
    // Stage 6 dedupe reads as the same content in a new version.
    const untouched = await prisma.knowledgeSource.findFirst({ where: { sourceKey: 'smartgift-catalog:products.json#PM-BOTTLE-LED', fileAssetId: asset.id } })
    const untouchedVersions = await prisma.knowledgeIngestion.findMany({ where: { sourceId: untouched.id }, orderBy: { revision: 'asc' } })
    expect(untouchedVersions).toHaveLength(2)
    expect(untouchedVersions[0].contentHash).toBe(untouchedVersions[1].contentHash)
    expect(untouchedVersions[0].sourceVersion).not.toBe(untouchedVersions[1].sourceVersion)
  })

  it('refuses a second FileAsset that claims the same catalog file name', async () => {
    const twin = await createJsonAsset(productsText)
    // Two assets claiming one catalog file is an ambiguity the adapter must not
    // resolve silently: the derived source key already belongs to another asset.
    await expect(admit(twin, productsText)).rejects.toMatchObject({ status: 409, code: 'KNOWLEDGE_SOURCE_CONFLICT' })
  })

  it('leaves a bare .json upload at 415 when no structured format is named', async () => {
    const asset = await createJsonAsset(productsText)
    await expect(admit(asset, productsText, { format: null })).rejects.toMatchObject({
      status: 415,
      code: 'KNOWLEDGE_FILE_TYPE_UNSUPPORTED',
    })
  })

  it('refuses a caller-supplied sourceKey or version alongside a structured format', async () => {
    const asset = await createJsonAsset(productsText)
    await expect(admitKnowledge({
      businessId: business.id,
      idempotencyKey: `smartgift-${randomUUID().slice(0, 8)}`,
      source: { kind: 'FILE', fileAssetId: asset.id, format: SMARTGIFT_CATALOG_FORMAT, version: 'v1' },
    }, { viewer, fileContentResolver: contentResolverFor(productsText) })).rejects.toThrow(/version/)
  })

  it('never creates a source for a customer-shaped record while its siblings proceed', async () => {
    const rows = JSON.parse(productsText)
    const target = rows.find((row) => row.externalId === 'PM-PEN')
    target.provenance = { ...target.provenance, upstreamFile: 'data-pipeline/01_raw/05_crm_customer_data/export.json' }
    const deniedText = JSON.stringify(rows)
    const asset = await createJsonAsset(deniedText, { name: 'products-denied.json' })
    const result = await admit(asset, deniedText)

    expect(result).toMatchObject({ recordCount: 5, admittedCount: 4, deniedCount: 1 })
    expect(result.denied).toEqual([
      { index: expect.any(Number), externalId: 'PM-PEN', entityType: 'ProductMaster', field: 'record.provenance.upstreamFile', term: '05_crm_customer_data' },
    ])
    const sources = await prisma.knowledgeSource.findMany({ where: { fileAssetId: asset.id } })
    expect(sources).toHaveLength(4)
    expect(sources.map((source) => source.sourceKey)).not.toContain('smartgift-catalog:products-denied.json#PM-PEN')
  })

  describe('Stage 5 classify enforcement', () => {
    const now = () => new Date('2026-09-11T09:00:00.000Z')
    const transport = (name, request) => Promise.resolve({
      schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
      scope: request.scope,
      batchId: request.batch?.batchId,
      decisionId: null,
      status: 'PENDING',
    })

    function rawInput(record, over = {}) {
      const content = canonicalGenesisRag17Json(record)
      return {
        scope: { ...scopeFor(), workspaceId: '', agentId: '' },
        sourceId: `smartgift-catalog:probe#${record.externalId}`,
        documentId: `doc-${record.externalId}-${randomUUID().slice(0, 6)}`,
        version: sha256(content),
        content,
        connectionId: connection.id,
        provider: SMARTGIFT_CATALOG_PROVIDER,
        entityType: record.entityType,
        contentType: SMARTGIFT_CATALOG_CONTENT_TYPE,
        policy: { allowEmbedding: true, allowPublication: true },
        ...over,
      }
    }

    it('carries the structured provider, entity type and content type onto the raw lineage', async () => {
      const record = JSON.parse(productsText).find((row) => row.externalId === 'PM-TMB')
      const result = await ingestGenesisRag17Raw(rawInput(record), { db: prisma, viewer: operator, now, transport, credential: 'test-source' })

      const raw = await prisma.knowledgeRawArtifact.findUnique({ where: { id: result.source.rawArtifactId } })
      expect(raw.contentType).toBe(SMARTGIFT_CATALOG_CONTENT_TYPE)
      const rawRecord = await prisma.rawExternalRecord.findUnique({ where: { id: raw.rawExternalRecordId } })
      expect(rawRecord).toMatchObject({ provider: SMARTGIFT_CATALOG_PROVIDER, entityType: 'ProductMaster' })

      const evidence = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: result.run.executionRunId }, orderBy: { stageNumber: 'asc' } })
      expect(evidence.map((row) => row.stageNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
      expect(JSON.parse(evidence[4].detailsJson)).toMatchObject({ zeroPiiPolicy: 'smartgift-zero-pii-1' })
    })

    it('stops a denied record at Stage 5 with terminal evidence, no Stage 6 and no batch', async () => {
      const denied = {
        entityType: 'ProductMaster',
        externalId: 'PM-LEAK',
        code: 'PM-LEAK',
        nameTh: 'ของขวัญ',
        customerName: 'someone',
        priceTiersThb: [],
        provenance: { upstreamFile: 'data-pipeline/02_prepared/ProductMaster.json', upstreamRecordId: 'pm:PM-LEAK' },
      }
      const input = rawInput(denied)
      let thrown
      try {
        await ingestGenesisRag17Raw(input, { db: prisma, viewer: operator, now, transport, credential: 'test-source' })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toMatchObject({ status: 422, code: 'GENESISRAG17_ZERO_PII_DENIED' })

      const intent = await prisma.genesisRag17IngestionIntent.findFirst({ where: { sourceId: input.sourceId } })
      const evidence = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: intent.executionRunId }, orderBy: { stageNumber: 'asc' } })
      expect(evidence.map((row) => row.stageNumber)).toEqual([1, 2, 3, 4, 5])
      expect(evidence.at(-1)).toMatchObject({ stageNumber: 5, outcome: 'FAILED', errorCount: 1 })
      expect(JSON.parse(evidence.at(-1).detailsJson)).toMatchObject({ errorCode: 'GENESISRAG17_ZERO_PII_DENIED' })
      expect(evidence.some((row) => row.stageNumber >= 6)).toBe(false)
      expect(await prisma.genesisRag17Batch.count({ where: { executionRunId: intent.executionRunId } })).toBe(0)
      expect(await prisma.genesisRag17SourceMention.count({ where: { executionRunId: intent.executionRunId } })).toBe(0)
      expect(intent).toMatchObject({ status: 'FAILED', nextStageNumber: 5 })
    })
  })
})
