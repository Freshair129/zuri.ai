import { describe, it, expect, vi } from 'vitest'
import { createEdgePublishedCorpusContext, assertEdgePublishedCorpusContextCurrent } from '@/modules/knowledge/edge-published-corpus-context'

// @req FR-189 — only authorized current catalog snapshots reach the Edge product capability.
// @spec ADR-075, ADR-090, SEC-001, SEC-008
const now = Date.parse('2026-09-17T00:00:00Z')
const scope = { portfolioId: 'p', tenantId: 't', businessId: 'b', workspaceId: '', agentId: '', visibility: 'private' }
const entry = { sourceId: 's', ingestionId: 'i', snapshotId: 'snap', generation: 'g', receiptHash: 'a'.repeat(64), rawArtifactId: 'raw', parsedArtifactId: 'parsed' }
function fixture() {
  const manifest = { scope, corpusId: 'corpus', corpusGeneration: 1, manifestHash: 'b'.repeat(64), entries: [entry] }
  const ingestion = { id: 'i', sourceId: 's', corpusId: 'corpus', parsedArtifactId: 'parsed', sourceMetaJson: JSON.stringify({ structured: { format: 'SMARTGIFT_CATALOG_V1', provider: 'SMARTGIFT_CATALOG' } }) }
  const parsed = { id: 'parsed', rawArtifactId: 'raw', parserVersion: 'genesisrag17-parser-2' }
  const repository = { getIngestions: vi.fn(async () => [ingestion]), getParsedArtifacts: vi.fn(async () => [parsed]) }
  const options = { repository, readManifest: vi.fn(async () => manifest), now: () => now }
  return { manifest, ingestion, parsed, repository, options }
}
const input = { tenantId: 't', businessId: 'b', expiresAt: new Date(now + 40000).toISOString() }

describe('Edge published catalog context', () => {
  it('exports only refs from live authorized manifest and batch-loads metadata', async () => {
    const { options, repository } = fixture()
    const result = await createEdgePublishedCorpusContext(input, options)
    expect(result).toMatchObject({ schemaVersion: 'edge-published-corpus.v1', corpusId: 'corpus', entries: [{ sourceId: 's', snapshotId: 'snap' }] })
    expect(result.entries[0]).not.toHaveProperty('ingestionId')
    expect(repository.getIngestions).toHaveBeenCalledOnce()
    expect(repository.getParsedArtifacts).toHaveBeenCalledOnce()
    expect(options.readManifest.mock.calls[0][0]).toEqual({ businessId: 'b' })
    expect(options.readManifest.mock.calls[0][1].viewer.visibleBusinessIds).toEqual(['b'])
  })
  it('never exports non-catalog/internal sources even when Business-scoped', async () => {
    const { options, ingestion } = fixture()
    ingestion.sourceMetaJson = JSON.stringify({ kind: 'TEXT' })
    expect((await createEdgePublishedCorpusContext(input, options)).entries).toEqual([])
  })
  it('rejects wrong tenant, stale context, invalid parser lineage and oversized source sets', async () => {
    const { options, parsed, manifest } = fixture()
    await expect(createEdgePublishedCorpusContext({ ...input, tenantId: 'other' }, options)).rejects.toMatchObject({ code: 'EDGE_CORPUS_CONTEXT_INVALID' })
    await expect(createEdgePublishedCorpusContext({ ...input, expiresAt: new Date(now).toISOString() }, options)).rejects.toThrow()
    parsed.rawArtifactId = 'other'
    await expect(createEdgePublishedCorpusContext(input, options)).rejects.toThrow()
    manifest.entries = Array(2049).fill(entry)
    await expect(createEdgePublishedCorpusContext(input, options)).rejects.toThrow()
  })
  it('denials propagate and absent corpus is explicitly null', async () => {
    const { options } = fixture()
    options.readManifest.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'KNOWLEDGE_FILE_ASSET_NOT_FOUND' }))
    await expect(createEdgePublishedCorpusContext(input, options)).rejects.toThrow('denied')
    options.readManifest.mockRejectedValueOnce(Object.assign(new Error('absent'), { code: 'KNOWLEDGE_CORPUS_NOT_FOUND' }))
    expect(await createEdgePublishedCorpusContext(input, options)).toBeNull()
  })
  it('rechecks persisted identity and rejects withdrawal or publication during inference', async () => {
    const { options, manifest } = fixture()
    const saved = { tenantId: 't', businessId: 'b', corpusId: manifest.corpusId, corpusGeneration: manifest.corpusGeneration, manifestHash: manifest.manifestHash }
    await expect(assertEdgePublishedCorpusContextCurrent(saved, options)).resolves.toBe(true)
    manifest.corpusGeneration += 1
    manifest.manifestHash = 'c'.repeat(64)
    await expect(assertEdgePublishedCorpusContextCurrent(saved, options)).rejects.toThrow('EDGE_CORPUS_CONTEXT_INVALID')
  })
})
