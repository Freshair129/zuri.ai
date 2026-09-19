import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { makeOperatorViewer, makeViewer } from '../factories/viewer'
import { ingestGenesisRag17Raw } from '@/platform/integrations/core/genesisrag17-executor'
import { hashGenesisRag17Json, hashGenesisRag17Text } from '@/modules/knowledge/genesisrag17-contract'
import { citationReference } from '@/modules/knowledge/knowledge-corpus-service'
import { readConsoleCitationArtifact } from '@/modules/knowledge/knowledge-console-service'
import { createKnowledgeConsoleRepository } from '@/modules/knowledge/knowledge-console-repository'

// @req FR-254 — citation artifacts remain bound to retained immutable bytes and
// current access after all slow reads; FileAsset changes cannot replace history.
// @spec ADR-072, SEC-001, SEC-008
// @tested tests/integration/fr254-citation-artifact.test.js
// Fixture evidence only: Tier 1 stages run locally with a pending transport seam;
// the corpus generation is arranged directly to exercise reads. This is NOT
// native publication or the required admission-to-citation browser acceptance.

const unique = (prefix) => `${prefix}-${randomUUID()}`
const historicalText = '# Retained policy\n\nHistorical source: สวัสดี 🧡\n\n<script>alert("source text")</script>'

async function fixture(content = historicalText) {
  const portfolioId = unique('portfolio')
  const tenantId = unique('tenant')
  const businessId = unique('business')
  await prisma.portfolio.create({ data: { id: portfolioId, code: unique('PF'), name: 'Citation fixture portfolio' } })
  await prisma.tenant.create({ data: { id: tenantId, portfolioId, code: unique('TEN'), name: 'Citation fixture tenant' } })
  await prisma.business.create({ data: { id: businessId, tenantId, code: unique('BUS'), name: 'Citation fixture business' } })
  const provider = await prisma.integrationProvider.create({ data: { code: unique('PROVIDER'), name: 'Citation fixture provider' } })
  const connection = await prisma.integrationConnection.create({ data: { providerId: provider.id, tenantId, businessId, name: 'Citation fixture connection' } })
  const scope = { portfolioId, tenantId, businessId, workspaceId: '', agentId: '', visibility: 'private' }
  const corpus = await prisma.knowledgeCorpus.create({ data: {
    id: unique('corpus'), corpusKey: unique('corpus-key'), portfolioId, tenantId, businessId,
    scopeJson: JSON.stringify(scope), policyJson: '{"allowEmbedding":true,"allowPublication":true}', generation: 1,
  } })
  const file = await prisma.fileAsset.create({ data: {
    id: unique('file'), code: unique('FILE'), tenantId, businessId, storageKind: 'LOCAL',
    relativePath: 'retained-policy.txt', name: 'Retained policy.txt', mime: 'text/plain',
    size: Buffer.byteLength(content, 'utf8'), sha256: hashGenesisRag17Text(content),
  } })
  const source = await prisma.knowledgeSource.create({ data: {
    id: unique('source'), corpusId: corpus.id, sourceKey: unique('source-key'), kind: 'FILE',
    fileAssetId: file.id, title: 'Retained policy', desiredRevision: 1,
  } })
  const executeVersion = (version, text) => ingestGenesisRag17Raw({
    scope, sourceId: source.id, documentId: source.id, version, content: text,
    connectionId: connection.id, policy: { allowEmbedding: true, allowPublication: true }, maxTokens: 30000,
  }, {
    db: prisma, viewer: makeOperatorViewer({ visibleBusinessIds: [], ownedBusinessIds: [] }), credential: 'fixture-only',
    transport: async (_name, request) => ({ schemaVersion: 'genesisrag17.v1', scope: request.scope, batchId: request.batch.batchId, decisionId: null, status: 'PENDING' }),
  })
  const retained = await executeVersion('v1', content)
  const ingestion = await prisma.knowledgeIngestion.create({ data: {
    id: unique('ingestion'), corpusId: corpus.id, sourceId: source.id, revision: 1,
    sourceVersion: 'v1', contentHash: hashGenesisRag17Text(content), content,
    idempotencyKey: unique('admission-key'), requestHash: hashGenesisRag17Text(content), status: 'PUBLISHED',
    executionRunId: retained.run.executionRunId, rawArtifactId: retained.source.rawArtifactId,
    parsedArtifactId: retained.source.parsedArtifactId, snapshotId: unique('fixture-snapshot'),
    snapshotGeneration: 'fixture-native-generation-1', receiptHash: 'd'.repeat(64),
  } })
  await prisma.knowledgeSource.update({ where: { id: source.id }, data: { activeIngestionId: ingestion.id } })
  const manifest = {
    schemaVersion: 'knowledge-corpus.v1', corpusId: corpus.id, generation: 1,
    entries: [{
      sourceId: source.id, ingestionId: ingestion.id, sourceVersion: 'v1', revision: 1,
      executionRunId: ingestion.executionRunId, snapshotId: ingestion.snapshotId,
      generation: ingestion.snapshotGeneration, scope, receiptHash: ingestion.receiptHash,
      rawArtifactId: ingestion.rawArtifactId, parsedArtifactId: ingestion.parsedArtifactId,
      contentHash: ingestion.contentHash, fileAssetId: file.id, title: source.title,
    }],
  }
  await prisma.knowledgeCorpusGeneration.create({ data: {
    corpusId: corpus.id, number: 1, manifestJson: JSON.stringify(manifest), manifestHash: hashGenesisRag17Json(manifest),
  } })
  const chunk = await prisma.knowledgeChunk.findFirst({ where: { parsedArtifactId: ingestion.parsedArtifactId }, orderBy: { ordinal: 'asc' } })
  const citationId = citationReference({ corpusId: corpus.id, corpusGeneration: 1, sourceId: source.id, ingestionId: ingestion.id, chunkId: chunk.id })
  const viewer = makeViewer({ visibleBusinessIds: [businessId], ownedBusinessIds: [businessId], visibleDomains: ['knowledge', 'projects'] })
  return { source, file, ingestion, content, chunk, citationId, executeVersion, options: { db: prisma, viewer, env: { ZURI_KNOWLEDGE_ENABLED: '0' } } }
}

describe('FR-254 citation artifact reads against retained Tier 1 Prisma lineage', () => {
  it('opens the exact old raw, parsed and chunk bytes after a newer file/source version exists', async () => {
    const f = await fixture()
    const newer = 'A newer mutable file must never replace the historical citation.'
    const next = await f.executeVersion('v2', newer)
    await prisma.fileAsset.update({ where: { id: f.file.id }, data: { version: 2, name: 'Current policy.txt', relativePath: 'current-policy.txt', sha256: hashGenesisRag17Text(newer), size: newer.length } })
    await prisma.knowledgeSource.update({ where: { id: f.source.id }, data: { desiredRevision: 2, title: 'Current title' } })
    for (const kind of ['raw', 'parsed', 'chunk']) {
      const result = await readConsoleCitationArtifact(f.citationId, { kind }, f.options)
      const expected = kind === 'chunk' ? f.chunk.text : f.content
      expect(result).toMatchObject({ kind, content: expected, contentHash: hashGenesisRag17Text(expected), truncated: false,
        rawArtifactId: f.ingestion.rawArtifactId, parsedArtifactId: f.ingestion.parsedArtifactId, chunkId: f.chunk.id })
      expect(result.rawArtifactId).not.toBe(next.source.rawArtifactId)
      expect(result.content).not.toContain(newer)
    }
  })

  it.each(['raw', 'parsed'])('rejects tampered retained %s bytes instead of displaying them', async (kind) => {
    const f = await fixture()
    const delegate = kind === 'raw' ? prisma.knowledgeRawArtifact : prisma.knowledgeParsedArtifact
    await delegate.update({ where: { id: kind === 'raw' ? f.ingestion.rawArtifactId : f.ingestion.parsedArtifactId }, data: { content: 'TAMPERED BYTES' } })
    await expect(readConsoleCitationArtifact(f.citationId, { kind }, f.options)).rejects.toMatchObject({ status: 409 })
  })

  it('reports missing historical lineage instead of falling back to a newer FileAsset', async () => {
    const f = await fixture()
    await f.executeVersion('v2', 'Newer available bytes')
    await prisma.$transaction([
      prisma.knowledgeChunk.deleteMany({ where: { parsedArtifactId: f.ingestion.parsedArtifactId } }),
      prisma.knowledgeParsedArtifact.delete({ where: { id: f.ingestion.parsedArtifactId } }),
      prisma.knowledgeRawArtifact.delete({ where: { id: f.ingestion.rawArtifactId } }),
    ])
    await expect(readConsoleCitationArtifact(f.citationId, { kind: 'raw' }, f.options)).rejects.toMatchObject({ status: 404 })
  })

  it.each(['source-revoked', 'file-deleted', 'knowledge-domain-denied'])('withholds artifact content when %s', async (reason) => {
    const f = await fixture()
    if (reason === 'source-revoked') await prisma.knowledgeSource.update({ where: { id: f.source.id }, data: { revokedAt: new Date() } })
    if (reason === 'file-deleted') await prisma.fileAsset.update({ where: { id: f.file.id }, data: { deletedAt: new Date() } })
    if (reason === 'knowledge-domain-denied') f.options.viewer = makeViewer({ visibleBusinessIds: f.options.viewer.visibleBusinessIds, visibleDomains: ['projects'] })
    await expect(readConsoleCitationArtifact(f.citationId, { kind: 'raw' }, f.options)).rejects.toMatchObject({ status: 404 })
  })

  it('rechecks current grants after the separate slow artifact read', async () => {
    const f = await fixture()
    const repository = createKnowledgeConsoleRepository(prisma)
    let currentViewer = f.options.viewer
    let markLoaded, releaseRead
    const loaded = new Promise((resolve) => { markLoaded = resolve })
    const paused = new Promise((resolve) => { releaseRead = resolve })
    const outcome = readConsoleCitationArtifact(f.citationId, { kind: 'raw' }, {
      ...f.options, resolveCurrentViewer: async () => currentViewer,
      repository: { ...repository, artifact: async (...args) => {
        const artifact = await repository.artifact(...args)
        markLoaded()
        await paused
        return artifact
      } },
    }).then((value) => ({ value }), (error) => ({ error: { status: error.status, message: error.message } }))
    expect(await Promise.race([loaded.then(() => true), outcome.then(() => false)])).toBe(true)
    currentViewer = makeViewer({ visibleBusinessIds: [], visibleDomains: [] })
    releaseRead()
    const result = await outcome
    expect(result).toMatchObject({ error: { status: 404 } })
    expect(result).not.toHaveProperty('value')
    expect(JSON.stringify(result)).not.toContain(f.content)
  })

  it('marks a bounded preview while a download preserves the complete UTF-8 content', async () => {
    const content = `${'retained text '.repeat(5500)}\nสวัสดี 🧡`
    const f = await fixture(content)
    const preview = await readConsoleCitationArtifact(f.citationId, { kind: 'raw' }, f.options)
    const download = await readConsoleCitationArtifact(f.citationId, { kind: 'raw', download: true }, f.options)
    expect(preview.truncated).toBe(true)
    expect(preview.content.length).toBeLessThan(content.length)
    expect(content.startsWith(preview.content)).toBe(true)
    expect(download.truncated).toBe(false)
    expect(Buffer.from(download.content, 'utf8')).toEqual(Buffer.from(content, 'utf8'))
    expect(download.bytes).toBe(Buffer.byteLength(content, 'utf8'))
    expect(preview.bytes).toBe(download.bytes)
    expect(preview.contentHash).toBe(hashGenesisRag17Text(content))
    expect(download.contentHash).toBe(preview.contentHash)
  })
})
