import { describe, expect, it, vi } from 'vitest'
import { createGenesisRag17LineageRepository } from '@/modules/knowledge/genesisrag17-lineage-repository'

// @req FR-109 — the immutable raw -> parsed -> chunk persistence boundary is
// scoped at the adapter, before any caller can read or create a lineage row.
// @spec ADR-050, ADR-063, NFR-018
// @tested tests/unit/genesisrag17-lineage-repository.test.js

const scope = {
  portfolioId: 'portfolio-1',
  tenantId: 'tenant-1',
  businessId: 'business-1',
  workspaceId: 'workspace-1',
  agentId: 'agent-1',
  visibility: 'private',
}

function model() {
  return {
    findFirst: vi.fn(async () => null),
    findMany: vi.fn(async () => []),
    create: vi.fn(async ({ data }) => data),
  }
}

function db() {
  return {
    knowledgeRawArtifact: model(),
    knowledgeParsedArtifact: model(),
    knowledgeChunk: model(),
  }
}

describe('GenesisRAG17 lineage repository', () => {
  it('binds all raw, parsed and chunk reads to the complete scope', async () => {
    const prisma = db()
    const repository = createGenesisRag17LineageRepository(prisma, scope)

    await repository.findRawByIdentity({ sourceId: 'source-1', version: '1', contentHash: 'a'.repeat(64), pipelineVersion: 'genesisrag17.v1' })
    await repository.findParsedByRawAndParser('raw-1', 'parser-1')
    await repository.findChunkByOrdinal('parsed-1', 0)

    expect(prisma.knowledgeRawArtifact.findFirst.mock.calls[0][0].where).toMatchObject(scope)
    expect(prisma.knowledgeParsedArtifact.findFirst.mock.calls[0][0].where).toMatchObject(scope)
    expect(prisma.knowledgeChunk.findFirst.mock.calls[0][0].where).toMatchObject(scope)
  })

  it('rejects writes outside scope and has no update or delete escape hatch', async () => {
    const repository = createGenesisRag17LineageRepository(db(), scope)
    expect(() => repository.createRaw({ ...scope, tenantId: 'tenant-elsewhere' })).toThrow(/tenantId scope/)
    expect(() => repository.createParsed({ ...scope, businessId: 'business-elsewhere' })).toThrow(/businessId scope/)
    expect(() => repository.createChunk({ ...scope, visibility: 'workspace' })).toThrow(/visibility scope/)
    expect(repository.update).toBeUndefined()
    expect(repository.delete).toBeUndefined()
  })
})
