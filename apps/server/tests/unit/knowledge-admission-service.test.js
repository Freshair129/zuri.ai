// @req FR-173 — immutable Text/Markdown admission, idempotency and safe status
// are proved at the shared service boundary before HTTP/MCP dispatch.
// @spec ADR-072, ZAI:KNOWLEDGE-ADMISSION-CONTRACT, SEC-001, SEC-008
// @tested tests/unit/knowledge-admission-service.test.js
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../factories/viewer'
import { hashKnowledgeBinaryBytes, KNOWLEDGE_BINARY_ENCODING, KNOWLEDGE_BINARY_MAX_BYTES, KNOWLEDGE_BINARY_PARSER_VERSION } from '@/modules/knowledge/knowledge-binary-parser'
import { hashGenesisRag17Json, hashGenesisRag17Text } from '@/modules/knowledge/genesisrag17-contract'
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

  it('replays a prior canonical legacy request hash without binary descriptor fields', async () => {
    const input = {
      businessId: 'b-1',
      idempotencyKey: 'legacy-hash-replay',
      source: { kind: 'TEXT', sourceKey: 'policy', version: 'v1', title: 'Legacy policy', content: 'legacy content' },
    }
    await admitKnowledge(input, options(repository))

    const legacyRequestHash = hashGenesisRag17Json({
      businessId: 'b-1',
      projectId: null,
      source: {
        kind: 'TEXT',
        sourceKey: 'policy',
        sourceVersion: 'v1',
        title: 'Legacy policy',
        fileAssetId: null,
        contentHash: hashGenesisRag17Text('legacy content'),
      },
      scope,
      policy,
    })
    repository.state.ingestions[0].requestHash = legacyRequestHash

    const replayed = await admitKnowledge(input, options(repository))

    expect(repository.state.ingestions[0].requestHash).toBe(legacyRequestHash)
    expect(replayed).toMatchObject({ id: 'admission-1', unchanged: true })
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

  it('admits an authorized managed Markdown FileAsset as immutable FILE content', async () => {
    const content = '# Managed policy\n\nKeep the source bytes.'
    const contentHash = createHash('sha256').update(content, 'utf8').digest('hex')
    const fileAsset = {
      id: 'file-1', businessId: 'b-1', projectId: null, name: 'policy.md',
      mime: 'text/markdown', size: Buffer.byteLength(content, 'utf8'), status: 'ACTIVE',
      storageKind: 'MANAGED_BLOB', version: 3, sha256: contentHash,
    }
    repository = fakeRepository({ fileAsset })
    const authorization = vi.fn(async () => ({ authorized: true, asset: fileAsset }))
    const fileContentResolver = vi.fn(async () => ({ content: Buffer.from(content, 'utf8') }))

    const result = await admitKnowledge({
      businessId: 'b-1',
      idempotencyKey: 'file-request',
      source: { kind: 'FILE', fileAssetId: 'file-1' },
    }, options(repository, { authorization, fileContentResolver }))

    expect(result).toMatchObject({
      status: 'QUEUED', unchanged: false, contentHash, sourceVersion: contentHash,
      source: { kind: 'FILE', fileAssetId: 'file-1', sourceKey: 'file-1', title: 'policy.md' },
    })
    expect(repository.state.ingestions[0]).toMatchObject({
      content, contentHash, sourceVersion: contentHash, status: 'QUEUED',
    })
    const metadata = JSON.parse(repository.state.ingestions[0].sourceMetaJson)
    expect(metadata).toMatchObject({
      kind: 'FILE', fileAssetId: 'file-1', fileAssetVersion: 3,
      mime: 'text/markdown', size: Buffer.byteLength(content, 'utf8'), storageKind: 'MANAGED_BLOB',
    })
    expect(metadata).not.toHaveProperty('content')
    expect(fileContentResolver).toHaveBeenCalledWith('file-1', expect.objectContaining({ visibleBusinessIds: ['b-1'] }))
  })

  it('admits binary FileAssets only after matching raw-byte hash, size and detected media', async () => {
    const bytes = Buffer.from('<!doctype html><html><body><p>Static policy</p></body></html>', 'utf8')
    const contentHash = hashKnowledgeBinaryBytes(bytes)
    const fileAsset = {
      id: 'file-html-1', businessId: 'b-1', projectId: null, name: 'policy.html', mime: 'text/html',
      size: bytes.length, status: 'ACTIVE', storageKind: 'MANAGED_BLOB', version: 2, sha256: contentHash,
    }
    repository = fakeRepository({ fileAsset })
    const authorization = vi.fn(async () => ({ authorized: true, asset: fileAsset }))
    const fileContentResolver = vi.fn(async () => ({ content: bytes }))
    await admitKnowledge({
      businessId: 'b-1', idempotencyKey: 'binary-file-request', source: { kind: 'FILE', fileAssetId: fileAsset.id },
    }, options(repository, { authorization, fileContentResolver }))

    const queued = repository.state.ingestions[0]
    const metadata = JSON.parse(queued.sourceMetaJson)
    expect(queued.content).toBe(`data:text/html;base64,${bytes.toString('base64')}`)
    expect(queued.contentHash).toBe(contentHash)
    expect(queued.contentHash).not.toBe(hashKnowledgeBinaryBytes(Buffer.from(queued.content, 'utf8')))
    expect(metadata).toMatchObject({
      binaryProfile: KNOWLEDGE_BINARY_PARSER_VERSION,
      binaryEncoding: KNOWLEDGE_BINARY_ENCODING,
      binaryMediaType: 'text/html',
      serialization: 'data-uri-base64',
      rawByteLength: bytes.length,
      size: bytes.length,
    })

    repository = fakeRepository({ fileAsset: { ...fileAsset, name: 'policy.pdf', mime: 'application/pdf' } })
    await expect(admitKnowledge({
      businessId: 'b-1', idempotencyKey: 'binary-file-mismatch', source: { kind: 'FILE', fileAssetId: fileAsset.id },
    }, options(repository, { authorization: vi.fn(async () => ({ authorized: true, asset: { ...fileAsset, name: 'policy.pdf', mime: 'application/pdf' } })), fileContentResolver })))
      .rejects.toMatchObject({ status: 415, code: 'KNOWLEDGE_FILE_MEDIA_MISMATCH' })
    expect(repository.state.ingestions).toHaveLength(0)

    const oversized = { ...fileAsset, name: 'too-large.pdf', mime: 'application/pdf', size: KNOWLEDGE_BINARY_MAX_BYTES + 1 }
    repository = fakeRepository({ fileAsset: oversized })
    const boundedResolver = vi.fn(async () => ({ content: Buffer.from('%PDF-1.7') }))
    await expect(admitKnowledge({
      businessId: 'b-1', idempotencyKey: 'binary-file-too-large', source: { kind: 'FILE', fileAssetId: oversized.id },
    }, options(repository, { authorization: vi.fn(async () => ({ authorized: true, asset: oversized })), fileContentResolver: boundedResolver })))
      .rejects.toMatchObject({ status: 413, code: 'KNOWLEDGE_CONTENT_TOO_LARGE' })
    expect(boundedResolver).not.toHaveBeenCalled()

    const mismatchedMime = { ...fileAsset, name: 'looks-like-pdf.pdf', mime: 'text/plain' }
    repository = fakeRepository({ fileAsset: mismatchedMime })
    const mismatchedResolver = vi.fn(async () => ({ content: Buffer.from('%PDF-1.7') }))
    await expect(admitKnowledge({
      businessId: 'b-1', idempotencyKey: 'binary-file-mime-mismatch', source: { kind: 'FILE', fileAssetId: mismatchedMime.id },
    }, options(repository, { authorization: vi.fn(async () => ({ authorized: true, asset: mismatchedMime })), fileContentResolver: mismatchedResolver })))
      .rejects.toMatchObject({ status: 415, code: 'KNOWLEDGE_FILE_TYPE_UNSUPPORTED' })
    expect(mismatchedResolver).not.toHaveBeenCalled()
  })

  // @req FR-238, ADR-090 D7 — a LINE_STUDIO_DESCRIPTION source records its own
  // `structured.provider` descriptor, distinct from the `KNOWLEDGE_ADMISSION`
  // fallback plain TEXT/FILE sources fall through to (which now runs the
  // FR-173 document Zero-PII gate, ADR-072 Amendment 2026-09-24). Without its
  // own descriptor, this source would take that same fallback and be swept
  // into a gate ADR-090 D7 deliberately keeps it out of.
  it('records LINE_STUDIO_DESCRIPTION under its own provider descriptor, never the KNOWLEDGE_ADMISSION fallback', async () => {
    await admitKnowledge({
      businessId: 'b-1',
      idempotencyKey: 'studio-request-1',
      source: { kind: 'LINE_STUDIO_DESCRIPTION', sourceKey: 'line-studio-description:bot-profile:acct-1', version: 'v1', content: 'สวัสดีค่ะ ติดต่อที่ 081-234-5678' },
    }, options(repository))

    const metadata = JSON.parse(repository.state.ingestions[0].sourceMetaJson)
    expect(metadata.structured).toEqual({ provider: 'LINE_STUDIO_DESCRIPTION', entityType: 'KNOWLEDGE_DOCUMENT', contentType: 'text/plain' })
    expect(metadata.structured.provider).not.toBe('KNOWLEDGE_ADMISSION')
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
