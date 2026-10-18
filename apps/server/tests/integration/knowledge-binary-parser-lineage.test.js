// @req FR-288 — managed binary projection and immutable source locations.
// @spec SDD-114 — versioned binary source projection and bounded parsing.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { makeOperatorViewer } from '../factories/viewer'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { encodeKnowledgeBinary, hashKnowledgeBinaryBytes, KNOWLEDGE_BINARY_ENCODING, KNOWLEDGE_BINARY_PARSER_VERSION, rawKnowledgeBinaryContentType } from '@/modules/knowledge/knowledge-binary-parser'
import { genesisRag17BinaryParserIdentity } from '@/modules/knowledge/genesisrag17-source'
import { hashGenesisRag17Text } from '@/modules/knowledge/genesisrag17-contract'
import { ingestGenesisRag17Raw, resolveGenesisRag17RawLineage } from '@/platform/integrations/core/genesisrag17-executor'

const mediaTypes = [
  ['basic.pdf', 'application/pdf'],
  ['basic.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['basic.html', 'text/html'],
]

describe('binary knowledge parser lineage', () => {
  let scope
  let viewer
  let connectionId
  let transportCalls
  const now = () => new Date('2026-10-18T00:00:00.000Z')
  const transport = async (name, request) => {
    transportCalls.push({ name, request })
    return { schemaVersion: 'genesisrag17.v1', scope: request.scope, batchId: request.batch.batchId, decisionId: null, status: 'PENDING' }
  }

  beforeAll(async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10)
    const portfolio = await createPortfolio({ name: `Binary parser ${suffix}`, code: `BIN-PF-${suffix}` })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: `Binary parser ${suffix}`, code: `BIN-TN-${suffix}` })
    const business = await createBusiness({ tenantId: tenant.id, name: `Binary parser ${suffix}`, code: `BIN-BU-${suffix}` })
    const provider = await prisma.integrationProvider.create({ data: { code: `BIN-${suffix}`, name: 'Binary parser source', status: 'ACTIVE' } })
    const connection = await prisma.integrationConnection.create({ data: { tenantId: tenant.id, businessId: business.id, providerId: provider.id, name: `Binary parser ${suffix}`, status: 'ACTIVE' } })
    connectionId = connection.id
    scope = { portfolioId: portfolio.id, tenantId: tenant.id, businessId: business.id, workspaceId: '', agentId: '', visibility: 'private' }
    viewer = makeOperatorViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })
    transportCalls = []
  })

  it.each(mediaTypes)('persists exact raw bytes and resolves typed citations for %s after replay', async (file, mediaType) => {
    const bytes = readFileSync(new URL(`../fixtures/knowledge-binary/${file}`, import.meta.url))
    const contentHash = hashKnowledgeBinaryBytes(bytes)
    const parserVersion = genesisRag17BinaryParserIdentity({ mediaType })
    const input = {
      scope,
      sourceId: `managed-file:${file}:${randomUUID()}`,
      documentId: `binary-${randomUUID()}`,
      version: `sha256:${contentHash}`,
      content: encodeKnowledgeBinary(bytes, mediaType),
      contentHash,
      contentType: mediaType,
      binaryProfile: KNOWLEDGE_BINARY_PARSER_VERSION,
      binaryEncoding: KNOWLEDGE_BINARY_ENCODING,
      sourceType: 'FILE',
      sourceUri: `managed-file:${file}`,
      connectionId,
      policy: { allowEmbedding: true, allowPublication: true },
    }
    const options = { db: prisma, viewer, now, transport, credential: 'isolated-test-source', storagePort: null, storageBinding: null }
    const first = await ingestGenesisRag17Raw(input, options)
    expect(first.source.rawContentHash).toBe(contentHash)
    expect(first.source.contentHash).toBe(hashGenesisRag17Text(first.source.content))
    expect(first.source.content).not.toContain('data:')
    expect(transportCalls.at(-1).request.batch.source).toMatchObject({
      rawContentHash: contentHash,
      binaryProfile: KNOWLEDGE_BINARY_PARSER_VERSION,
      binaryEncoding: KNOWLEDGE_BINARY_ENCODING,
      mediaType,
      parserVersion,
      locatorMappingVersion: 'source-locator-map-1',
    })
    expect(transportCalls.at(-1).request.batch.chunks[0].sourceLocators.length).toBeGreaterThan(0)

    const raw = await prisma.knowledgeRawArtifact.findUnique({ where: { id: first.source.rawArtifactId } })
    const canonical = await prisma.rawExternalRecord.findUnique({ where: { id: raw.rawExternalRecordId } })
    const parsed = await prisma.knowledgeParsedArtifact.findUnique({ where: { id: first.source.parsedArtifactId } })
    const metadata = JSON.parse(parsed.metadataJson)
    expect(raw).toMatchObject({ contentHash, content: input.content, contentType: rawKnowledgeBinaryContentType(mediaType) })
    expect(JSON.parse(canonical.payloadJson)).toMatchObject({ contentHash, binaryProfile: KNOWLEDGE_BINARY_PARSER_VERSION, binaryEncoding: KNOWLEDGE_BINARY_ENCODING, rawByteLength: bytes.length })
    expect(metadata).toMatchObject({ rawSha256: contentHash, rawByteLength: bytes.length, parserVersion, sourceFormat: mediaType, mappingVersion: 'source-locator-map-1' })
    expect(hashGenesisRag17Text(parsed.content)).toBe(metadata.extractedTextSha256)

    const firstChunk = first.chunks[0]
    const reference = { scope, sourceId: input.sourceId, documentId: input.documentId, version: input.version, rawArtifactId: raw.id, parsedArtifactId: parsed.id, chunkId: firstChunk.chunkId }
    const citation = await resolveGenesisRag17RawLineage(reference, { db: prisma })
    expect(citation).toMatchObject({ contentHash, locatorMappingVersion: 'source-locator-map-1' })
    expect(citation.sourceLocators.length).toBeGreaterThan(0)
    expect(parsed.content.slice(citation.startOffset, citation.endOffset)).toBe(citation.text)

    const replay = await ingestGenesisRag17Raw(input, options)
    expect(replay.source.rawArtifactId).toBe(raw.id)
    expect(replay.source.parsedArtifactId).toBe(parsed.id)
    expect(await resolveGenesisRag17RawLineage(reference, { db: prisma })).toMatchObject({ chunkId: citation.chunkId, sourceLocators: citation.sourceLocators })
  })

  it('keeps raw bytes and stable Stage 2 failure evidence without creating a partial ParsedArtifact', async () => {
    const bytes = Buffer.from('%PDF-not-a-valid-document')
    const contentHash = hashKnowledgeBinaryBytes(bytes)
    const input = {
      scope,
      sourceId: `managed-file:malformed-pdf:${randomUUID()}`,
      documentId: `binary-${randomUUID()}`,
      version: `sha256:${contentHash}`,
      content: encodeKnowledgeBinary(bytes, 'application/pdf'),
      contentHash,
      contentType: 'application/pdf',
      binaryProfile: KNOWLEDGE_BINARY_PARSER_VERSION,
      binaryEncoding: KNOWLEDGE_BINARY_ENCODING,
      sourceType: 'FILE',
      connectionId,
      policy: { allowEmbedding: true, allowPublication: true },
    }
    await expect(ingestGenesisRag17Raw(input, { db: prisma, viewer, now, transport, credential: 'isolated-test-source', storagePort: null, storageBinding: null }))
      .rejects.toMatchObject({ code: 'MALFORMED_PDF', message: 'MALFORMED_PDF' })
    const raw = await prisma.knowledgeRawArtifact.findFirst({ where: { sourceId: input.sourceId, version: input.version } })
    expect(raw).toMatchObject({ contentHash, contentType: rawKnowledgeBinaryContentType('application/pdf') })
    expect(await prisma.knowledgeParsedArtifact.count({ where: { rawArtifactId: raw.id } })).toBe(0)
    const evidence = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: { in: (await prisma.pipelineRun.findMany({ where: { sourceRef: input.sourceId }, select: { executionRunId: true } })).map((run) => run.executionRunId) } }, orderBy: { stageNumber: 'asc' } })
    expect(evidence.map((row) => [row.stageNumber, row.outcome])).toEqual([[1, 'SUCCEEDED'], [2, 'FAILED']])
  })
})
