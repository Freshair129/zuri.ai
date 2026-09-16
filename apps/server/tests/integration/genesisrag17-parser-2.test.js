import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { makeOperatorViewer } from '../factories/viewer'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { ingestGenesisRag17Raw, resolveGenesisRag17RawLineage } from '@/platform/integrations/core/genesisrag17-executor'
import {
  assertGenesisRag17BatchIntegrity,
  canonicalGenesisRag17Json,
  GENESIS_RAG17_SCHEMA_VERSION,
  hashGenesisRag17Text,
} from '@/modules/knowledge/genesisrag17-contract'
import {
  SMARTGIFT_CATALOG_CONTENT_TYPE,
  SMARTGIFT_CATALOG_PROVIDER,
} from '@/modules/knowledge/smartgift-catalog-adapter'

// @req FR-188 — a SMARTGIFT_CATALOG raw entry runs Stages 1–8 under
// genesisrag17-parser-2 and genesisrag17-structured-recognizer-1: the parsed
// artifact holds the rendered sections, the Stage 9 batch carries that parsed
// content so every chunk is an exact substring, the same raw reuses one parsed
// artifact, a malformed record fails Stage 2 with no chunks, and prose
// sources keep genesisrag17-parser-1.
// @spec ADR-075, ADR-073, docs/plans/GENESISRAG17-CONTRACT.md
// @tested tests/integration/genesisrag17-parser-2.test.js

const bundles = JSON.parse(readFileSync(new URL('../fixtures/genesisrag17/smartgift-catalog/bundles.json', import.meta.url), 'utf8'))
const products = JSON.parse(readFileSync(new URL('../fixtures/genesisrag17/smartgift-catalog/products.json', import.meta.url), 'utf8'))
const sha256 = (text) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')
const now = () => new Date('2026-09-11T10:00:00.000Z')

describe('GenesisRAG17 parser-2 Tier 1 execution (FR-188)', () => {
  let portfolio
  let tenant
  let business
  let connection
  let viewer
  let calls

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8)
    portfolio = await createPortfolio({ name: `P2 portfolio ${suffix}`, code: `P2-PF-${suffix}` })
    tenant = await createTenant({ portfolioId: portfolio.id, name: `P2 tenant ${suffix}`, code: `P2-TN-${suffix}` })
    business = await createBusiness({ tenantId: tenant.id, name: `P2 business ${suffix}`, code: `P2-BU-${suffix}` })
    const provider = await prisma.integrationProvider.create({ data: { code: `P2-${suffix}`, name: 'SmartGift catalog source', status: 'ACTIVE' } })
    connection = await prisma.integrationConnection.create({
      data: { tenantId: tenant.id, businessId: business.id, providerId: provider.id, name: 'SmartGift catalog connection', status: 'ACTIVE' },
    })
    viewer = makeOperatorViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })
    calls = []
  })

  const scope = () => ({ portfolioId: portfolio.id, tenantId: tenant.id, businessId: business.id, workspaceId: '', agentId: '', visibility: 'private' })

  function transport(name, request) {
    calls.push({ name, request })
    return Promise.resolve({ schemaVersion: GENESIS_RAG17_SCHEMA_VERSION, scope: request.scope, batchId: request.batch.batchId, decisionId: null, status: 'PENDING' })
  }

  function structuredInput(record, over = {}) {
    const content = typeof record === 'string' ? record : canonicalGenesisRag17Json(record)
    const code = typeof record === 'string' ? 'raw' : record.externalId
    return {
      scope: scope(),
      sourceId: `smartgift-catalog:p2#${code}`,
      documentId: `doc-p2-${code}`,
      version: sha256(content),
      content,
      connectionId: connection.id,
      provider: SMARTGIFT_CATALOG_PROVIDER,
      entityType: 'BundleOffer',
      contentType: SMARTGIFT_CATALOG_CONTENT_TYPE,
      policy: { allowEmbedding: true, allowPublication: true },
      ...over,
    }
  }

  it('runs Stages 1–8 under parser-2 and hands Stage 9 the rendered parsed content', async () => {
    const record = bundles.find((row) => row.code === 'PKG-XMAS-2026-SIGNATURE-CLEVEL')
    const input = structuredInput(record)
    const result = await ingestGenesisRag17Raw(input, { db: prisma, viewer, now, transport, credential: 'test-source' })

    const raw = await prisma.knowledgeRawArtifact.findUnique({ where: { id: result.source.rawArtifactId } })
    const parsed = await prisma.knowledgeParsedArtifact.findUnique({ where: { id: result.source.parsedArtifactId } })
    expect(raw.content).toBe(input.content)
    expect(parsed.parserVersion).toBe('genesisrag17-parser-2')
    expect(parsed.content).not.toBe(raw.content)
    expect(parsed.content.split('\n\n')).toEqual([
      expect.stringMatching(/^BundleOffer PKG-XMAS-2026-SIGNATURE-CLEVEL\n/),
      '{"object":"PM-NB","predicate":"HAS_COMPONENT","subject":"PKG-XMAS-2026-SIGNATURE-CLEVEL"}',
      '{"object":"PM-PB10K","predicate":"HAS_COMPONENT","subject":"PKG-XMAS-2026-SIGNATURE-CLEVEL"}',
      '{"object":"PM-PEN","predicate":"HAS_COMPONENT","subject":"PKG-XMAS-2026-SIGNATURE-CLEVEL"}',
    ])

    const submitted = calls.at(-1)
    expect(submitted.name).toBe('msp_pipeline_submit')
    const batch = submitted.request.batch
    expect(batch.source).toMatchObject({ rawArtifactId: raw.id, parsedArtifactId: parsed.id, content: parsed.content, contentHash: hashGenesisRag17Text(parsed.content) })
    expect(() => assertGenesisRag17BatchIntegrity(batch)).not.toThrow()
    expect(batch.chunks).toHaveLength(4)
    for (const chunk of batch.chunks) expect(batch.source.content.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.text)
    expect(batch.mentions.map((mention) => [mention.chunkId === batch.chunks[0].chunkId ? 'descriptive' : 'claim', mention.semanticType, mention.resolutionKey])).toEqual([
      ['descriptive', 'PACKAGE', 'PKG-XMAS-2026-SIGNATURE-CLEVEL'],
      ['claim', 'Product', 'PM-NB'],
      ['claim', 'PACKAGE', 'PKG-XMAS-2026-SIGNATURE-CLEVEL'],
      ['claim', 'Product', 'PM-PB10K'],
      ['claim', 'PACKAGE', 'PKG-XMAS-2026-SIGNATURE-CLEVEL'],
      ['claim', 'Product', 'PM-PEN'],
      ['claim', 'PACKAGE', 'PKG-XMAS-2026-SIGNATURE-CLEVEL'],
    ])

    const evidence = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: result.run.executionRunId }, orderBy: { stageNumber: 'asc' } })
    expect(evidence.map((row) => [row.stageNumber, row.outcome])).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((stage) => [stage, 'SUCCEEDED']))
    expect(JSON.parse(evidence[1].detailsJson)).toMatchObject({ parserVersion: 'genesisrag17-parser-2' })
    expect(JSON.parse(evidence[4].detailsJson)).toMatchObject({ zeroPiiPolicy: 'smartgift-zero-pii-1' })
    expect(JSON.parse(evidence[7].detailsJson)).toMatchObject({ recognizerVersion: 'genesisrag17-structured-recognizer-1', recognizerProvenance: 'genesisrag17-source:structured', mentionCount: 7 })

    const rows = await prisma.genesisRag17SourceMention.findMany({ where: { executionRunId: result.run.executionRunId } })
    expect(rows).toHaveLength(7)
    expect(new Set(rows.map((row) => row.recognizerVersion))).toEqual(new Set(['genesisrag17-structured-recognizer-1']))
    const intent = await prisma.genesisRag17IngestionIntent.findUnique({ where: { executionRunId: result.run.executionRunId } })
    expect(JSON.parse(intent.derivationJson)).toEqual({ parserVersion: 'genesisrag17-parser-2', chunkerVersion: null, maxTokens: null, recognizerVersion: 'genesisrag17-structured-recognizer-1', recognizerProvenance: 'genesisrag17-source:structured' })

    const cited = await resolveGenesisRag17RawLineage({
      scope: scope(),
      sourceId: input.sourceId,
      documentId: input.documentId,
      version: input.version,
      rawArtifactId: raw.id,
      parsedArtifactId: parsed.id,
      chunkId: batch.chunks[2].chunkId,
    }, { db: prisma })
    expect(cited).toMatchObject({ contentHash: raw.contentHash, text: batch.chunks[2].text })

    const again = await ingestGenesisRag17Raw(input, { db: prisma, viewer, now, transport, credential: 'test-source' })
    expect(again.source.parsedArtifactId).toBe(parsed.id)
    expect(await prisma.knowledgeParsedArtifact.count({ where: { rawArtifactId: raw.id } })).toBe(1)
  })

  it('refuses a caller-chosen parser-1 identity or token budget for a SmartGift source', async () => {
    const record = products.find((row) => row.code === 'PM-PEN')
    await expect(ingestGenesisRag17Raw(structuredInput(record, { parserVersion: 'genesisrag17-parser-1', entityType: 'ProductMaster' }), { db: prisma, viewer, now, transport, credential: 'test-source' }))
      .rejects.toMatchObject({ status: 400, code: 'GENESISRAG17_PARSER_CONFIG_UNSUPPORTED' })
    await expect(ingestGenesisRag17Raw(structuredInput(record, { maxTokens: 4, entityType: 'ProductMaster' }), { db: prisma, viewer, now, transport, credential: 'test-source' }))
      .rejects.toMatchObject({ status: 400, code: 'GENESISRAG17_PARSER_CONFIG_UNSUPPORTED' })
  })

  it('fails a malformed record at Stage 2 with terminal evidence and no chunks', async () => {
    const { nameTh, ...malformed } = products.find((row) => row.code === 'PM-NB')
    expect(nameTh).toBeTruthy()
    const input = structuredInput(malformed, { entityType: 'ProductMaster' })
    let thrown
    try {
      await ingestGenesisRag17Raw(input, { db: prisma, viewer, now, transport, credential: 'test-source' })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ status: 422, code: 'GENESISRAG17_STRUCTURED_RECORD_INVALID' })
    const intent = await prisma.genesisRag17IngestionIntent.findFirst({ where: { sourceId: input.sourceId } })
    const evidence = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: intent.executionRunId }, orderBy: { stageNumber: 'asc' } })
    expect(evidence.map((row) => [row.stageNumber, row.outcome])).toEqual([[1, 'SUCCEEDED'], [2, 'FAILED']])
    expect(await prisma.knowledgeParsedArtifact.count({ where: { documentId: input.documentId } })).toBe(0)
    expect(await prisma.knowledgeChunk.count({ where: { documentId: input.documentId } })).toBe(0)
    expect(await prisma.genesisRag17Batch.count({ where: { executionRunId: intent.executionRunId } })).toBe(0)
  })

  it('keeps prose sources on parser-1 and rule_v1 through the same executor', async () => {
    const content = '# Purchase\n\nAlice purchased Atlas.'
    const result = await ingestGenesisRag17Raw({
      scope: scope(),
      sourceId: 'synthetic://p2/prose',
      documentId: 'doc-p2-prose',
      version: '1',
      content,
      connectionId: connection.id,
      provider: 'KNOWLEDGE_ADMISSION',
      policy: { allowEmbedding: true, allowPublication: true },
    }, { db: prisma, viewer, now, transport, credential: 'test-source' })
    const parsed = await prisma.knowledgeParsedArtifact.findUnique({ where: { id: result.source.parsedArtifactId } })
    expect(parsed).toMatchObject({ parserVersion: 'genesisrag17-parser-1', content })
    expect(result.source).toMatchObject({ content, contentHash: hashGenesisRag17Text(content) })
    const rows = await prisma.genesisRag17SourceMention.findMany({ where: { executionRunId: result.run.executionRunId } })
    expect(rows.length).toBeGreaterThan(0)
    expect(new Set(rows.map((row) => row.recognizerVersion))).toEqual(new Set(['rule_v1']))
  })
})
