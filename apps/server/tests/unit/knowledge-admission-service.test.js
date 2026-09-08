// @req FR-173 — immutable Text/Markdown admission, idempotency and safe status
// are proved at the shared service boundary before HTTP/MCP dispatch.
// @spec ADR-072, ZAI:KNOWLEDGE-ADMISSION-CONTRACT, SEC-001, SEC-008
// @tested tests/unit/knowledge-admission-service.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../factories/viewer'
import {
  admitKnowledge,
  listKnowledgeIngestions,
  readKnowledgeIngestion,
} from '@/modules/knowledge/knowledge-admission-service'

const viewer = makeViewer({ role: 'OWNER', visibleBusinessIds: ['b-1'], ownedBusinessIds: ['b-1'] })
const scope = {
  portfolioId: 'portfolio-1',
  tenantId: 'tenant-1',
  businessId: 'b-1',
  workspaceId: 'workspace-1',
  agentId: 'agent-1',
  visibility: 'private',
}
const policy = { allowEmbedding: true, allowPublication: true }

function fakeRepository({ fileAsset } = {}) {
  const state = { corpus: null, sources: [], ingestions: [], runs: [], audits: [] }
  const repository = {
    state,
    transaction: async (callback) => callback(repository),
    findCorpusByKey: async (key) => state.corpus?.corpusKey === key ? state.corpus : null,
    getCorpus: async (id) => state.corpus?.id === id ? state.corpus : null,
    createCorpus: async (data) => {
      state.corpus = { id: 'corpus-1', ...data }
      return state.corpus
    },
    findSource: async (corpusId, sourceKey) => state.sources.find((source) => source.corpusId === corpusId && source.sourceKey === sourceKey) || null,
    getSource: async (id) => state.sources.find((source) => source.id === id) || null,
    createSource: async (data) => {
      const source = { id: `source-${state.sources.length + 1}`, ...data }
      state.sources.push(source)
      return source
    },
    updateSource: async (id, expectedVersion, data) => {
      const source = state.sources.find((item) => item.id === id)
      if (!source || source.version !== expectedVersion) return null
      Object.assign(source, data, { version: source.version + 1 })
      return source
    },
    findIngestionByKey: async (idempotencyKey) => state.ingestions.find((row) => row.idempotencyKey === idempotencyKey) || null,
    findIngestionVersion: async (sourceId, sourceVersion) => state.ingestions.find((row) => row.sourceId === sourceId && row.sourceVersion === sourceVersion) || null,
    getIngestion: async (id) => state.ingestions.find((row) => row.id === id) || null,
    createIngestion: async (data) => {
      const ingestion = { id: `admission-${state.ingestions.length + 1}`, ...data }
      state.ingestions.push(ingestion)
      return ingestion
    },
    listIngestions: async ({ corpusId, limit }) => state.ingestions.filter((row) => row.corpusId === corpusId).slice(0, limit),
    getPipelineRun: async (executionRunId) => state.runs.find((run) => run.executionRunId === executionRunId) || null,
    audit: async (event) => { state.audits.push(event); return event },
    getFileAsset: async (id) => fileAsset?.id === id ? fileAsset : null,
  }
  return repository
}

function options(repository, extra = {}) {
  return {
    db: { fileAsset: { findUnique: async ({ where }) => repository.getFileAsset(where.id) } },
    viewer,
    repository,
    authorization: vi.fn(async () => ({ authorized: true })),
    runtimeResolver: vi.fn(async () => ({ scope, policy })),
    now: new Date('2026-09-08T10:00:00.000Z'),
    ...extra,
  }
}

describe('knowledge admission service', () => {
  let repository

  beforeEach(() => {
    repository = fakeRepository()
  })

  it('queues immutable text, records safe metadata and separates native execution identity', async () => {
    const result = await admitKnowledge({
      businessId: 'b-1',
      idempotencyKey: 'request-1',
      source: { kind: 'TEXT', sourceKey: 'policy', version: 'v1', title: 'Policy', content: '# Hello' },
    }, options(repository))

    expect(result).toMatchObject({
      id: 'admission-1',
      admissionId: 'admission-1',
      executionRunId: null,
      status: 'QUEUED',
      revision: 1,
      unchanged: false,
      source: { kind: 'TEXT', sourceKey: 'policy', title: 'Policy' },
    })
    expect(result).not.toHaveProperty('content')
    expect(repository.state.ingestions[0]).toMatchObject({ content: '# Hello', sourceVersion: 'v1', status: 'QUEUED' })
    expect(JSON.parse(repository.state.ingestions[0].sourceMetaJson)).not.toHaveProperty('content')
    expect(repository.state.audits[0]).toMatchObject({ action: 'KNOWLEDGE_ADMISSION_QUEUED', entityId: 'admission-1' })
  })

  it('returns the same job for the same key and rejects changed input or version reuse', async () => {
    const first = { businessId: 'b-1', idempotencyKey: 'request-1', source: { kind: 'TEXT', sourceKey: 'policy', version: 'v1', content: 'one' } }
    const firstResult = await admitKnowledge(first, options(repository))
    const repeated = await admitKnowledge(first, options(repository))
    expect(repeated).toMatchObject({ id: firstResult.id, unchanged: true })

    await expect(admitKnowledge({ ...first, source: { ...first.source, content: 'changed' } }, options(repository))).rejects.toMatchObject({
      status: 409,
      code: 'KNOWLEDGE_IDEMPOTENCY_CONFLICT',
    })
    await expect(admitKnowledge({ ...first, idempotencyKey: 'request-2' }, options(repository))).rejects.toMatchObject({
      status: 409,
      code: 'KNOWLEDGE_SOURCE_VERSION_CONFLICT',
    })
  })

  it('rejects whitespace-only text and preserves a UTF-8 BOM as immutable content', async () => {
    await expect(admitKnowledge({
      businessId: 'b-1',
      idempotencyKey: 'blank-request',
      source: { kind: 'TEXT', sourceKey: 'blank', version: 'v1', content: ' \n\t' },
    }, options(repository))).rejects.toMatchObject({ status: 422, code: 'KNOWLEDGE_CONTENT_EMPTY' })

    const content = '\uFEFF# Title'
    await admitKnowledge({
      businessId: 'b-1',
      idempotencyKey: 'bom-request',
      source: { kind: 'TEXT', sourceKey: 'bom', version: 'v1', content },
    }, options(repository))
    expect(repository.state.ingestions.at(-1).content).toBe(content)
    expect(Buffer.byteLength(repository.state.ingestions.at(-1).content, 'utf8')).toBe(Buffer.byteLength(content, 'utf8'))
  })

  it('advances one source revision for a correction while preserving the prior job', async () => {
    await admitKnowledge({ businessId: 'b-1', idempotencyKey: 'request-1', source: { kind: 'TEXT', sourceKey: 'policy', version: 'v1', content: 'one' } }, options(repository))
    const corrected = await admitKnowledge({ businessId: 'b-1', idempotencyKey: 'request-2', source: { kind: 'TEXT', sourceKey: 'policy', version: 'v2', content: 'two' } }, options(repository))

    expect(corrected).toMatchObject({ id: 'admission-2', revision: 2, source: { desiredRevision: 2 } })
    expect(repository.state.ingestions).toHaveLength(2)
    expect(repository.state.ingestions.map((row) => row.content)).toEqual(['one', 'two'])
  })

  it('checks knowledge authorization before reading managed file content', async () => {
    const fileAsset = { id: 'file-1', businessId: 'b-1', projectId: null, name: 'secret.md', mime: 'text/markdown', size: 6, status: 'ACTIVE', storageKind: 'MANAGED_BLOB', version: 1, sha256: null }
    repository = fakeRepository({ fileAsset })
    const authorization = vi.fn(async () => { throw Object.assign(new Error('Knowledge access denied'), { status: 403, code: 'KNOWLEDGE_ACCESS_DENIED' }) })
    const fileContentResolver = vi.fn(async () => ({ content: Buffer.from('secret') }))

    await expect(admitKnowledge({ businessId: 'b-1', idempotencyKey: 'file-request', source: { kind: 'FILE', fileAssetId: 'file-1' } }, options(repository, { authorization, fileContentResolver }))).rejects.toMatchObject({ status: 403 })
    expect(fileContentResolver).not.toHaveBeenCalled()
  })

  it('lists and reads status without exposing queued content or lease internals', async () => {
    await admitKnowledge({ businessId: 'b-1', idempotencyKey: 'request-1', source: { kind: 'TEXT', sourceKey: 'policy', version: 'v1', content: 'one' } }, options(repository))
    repository.state.ingestions[0].executionRunId = 'native-1'
    repository.state.ingestions[0].claimToken = 'secret-lease'
    repository.state.runs.push({ executionRunId: 'native-1', status: 'RUNNING', currentStageId: 'stage-9', updatedAt: new Date('2026-09-08T10:01:00.000Z') })
    const authorization = vi.fn(async () => ({ authorized: true }))
    const listed = await listKnowledgeIngestions({ businessId: 'b-1' }, options(repository, { authorization }))
    const read = await readKnowledgeIngestion('admission-1', options(repository, { authorization }))

    expect(listed.items[0]).not.toHaveProperty('content')
    expect(listed.items[0]).not.toHaveProperty('claimToken')
    expect(read).toMatchObject({ id: 'admission-1', executionRunId: 'native-1', execution: { status: 'RUNNING', currentStageId: 'stage-9' } })
    expect(read).not.toHaveProperty('claimToken')
    expect(authorization).toHaveBeenCalledWith(expect.objectContaining({ operation: 'read', businessId: 'b-1' }), expect.anything())
  })
})
