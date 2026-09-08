import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hashGenesisRag17Json, hashGenesisRag17Text, GENESIS_RAG17_SCHEMA_VERSION, stageIdForNumber } from '@/modules/knowledge/genesisrag17-contract'
import { KNOWLEDGE_INGESTION_CONTRACT_ID, KNOWLEDGE_INGESTION_DEFINITION_ID } from '@/platform/integrations/core/pipeline-tracking-contract'
import {
  publishVerifiedKnowledgeIngestion,
  queryKnowledgeCorpus,
  resolveKnowledgeCitation,
  withdrawKnowledgeSource,
  citationReference,
} from '@/modules/knowledge/knowledge-corpus-service'
import { createKnowledgeExecutionAuthority } from '@/modules/knowledge/knowledge-execution-authority'
import { makeViewer, ownsElsewhere } from '../factories/viewer'

// @req FR-172 — an authorized corpus is an immutable manifest of verified
// per-source snapshots, with current ACL and revocation checks at every read.
// @spec ADR-072, SEC-001, SEC-008
// @tested apps/server/tests/integration/knowledge-corpus.test.js

const scope = Object.freeze({
  portfolioId: 'portfolio-1',
  tenantId: 'tenant-1',
  businessId: 'business-1',
  workspaceId: 'workspace-1',
  agentId: 'knowledge-agent',
  visibility: 'private',
})

const owner = makeViewer({ visibleBusinessIds: [scope.businessId], ownedBusinessIds: [scope.businessId] })
const reader = makeViewer({ role: 'MEMBER', visibleBusinessIds: [scope.businessId], ownedBusinessIds: [] })
const deniedViewer = makeViewer({ role: 'MEMBER', visibleBusinessIds: ['business-elsewhere'], ownedBusinessIds: [] })
const attacker = ownsElsewhere({ owns: 'business-elsewhere', sees: scope.businessId })

function clone(value) {
  return value === undefined ? value : structuredClone(value)
}

function source(over = {}) {
  return {
    id: over.id || 'source-1',
    corpusId: 'corpus-1',
    sourceKey: over.sourceKey || over.id || 'source-1',
    kind: 'TEXT',
    title: over.title || over.id || 'Source',
    fileAssetId: over.fileAssetId ?? null,
    desiredRevision: over.desiredRevision ?? 1,
    activeIngestionId: over.activeIngestionId ?? null,
    version: over.version ?? 1,
    revokedAt: over.revokedAt ?? null,
    createdAt: new Date('2026-09-08T00:00:00.000Z'),
    updatedAt: new Date('2026-09-08T00:00:00.000Z'),
    deletedAt: over.deletedAt ?? null,
  }
}

function corpus(over = {}) {
  return {
    id: 'corpus-1',
    corpusKey: 'knowledge:business-1:project-1',
    portfolioId: scope.portfolioId,
    tenantId: scope.tenantId,
    businessId: scope.businessId,
    projectId: 'project-1',
    workspaceId: scope.workspaceId,
    scopeJson: JSON.stringify(scope),
    policyJson: '{}',
    status: 'ACTIVE',
    generation: 0,
    version: 1,
    createdAt: new Date('2026-09-08T00:00:00.000Z'),
    updatedAt: new Date('2026-09-08T00:00:00.000Z'),
    deletedAt: null,
    ...over,
  }
}

function runFor(ingestion, over = {}) {
  return {
    id: `pipeline-${ingestion.id}`,
    executionRunId: ingestion.executionRunId,
    dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
    executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
    tenantId: scope.tenantId,
    businessId: scope.businessId,
    status: 'SUCCEEDED',
    ...over,
  }
}

function receiptFor(ingestion, over = {}) {
  const decisionHash = 'a'.repeat(64)
  const receiptHash = 'b'.repeat(64)
  const receipt = {
    schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
    scope,
    runId: ingestion.executionRunId,
    decisionId: `decision-${ingestion.id}`,
    decisionHash,
    snapshotId: ingestion.snapshotId,
    generation: ingestion.snapshotGeneration,
    receiptHash,
    publishedAt: '2026-09-08T01:00:00.000Z',
    pointerHash: 'c'.repeat(64),
    modelRevision: '614241f622f53c4eeff9890bdc4f31cfecc418b3',
    transactionFrontier: `frontier-${ingestion.id}`,
    readback: { ok: true },
    ...over,
  }
  return {
    id: `receipt-${ingestion.id}`,
    runId: runFor(ingestion).id,
    executionRunId: ingestion.executionRunId,
    scopeJson: JSON.stringify(scope),
    decisionId: receipt.decisionId,
    decisionHash: receipt.decisionHash,
    snapshotId: receipt.snapshotId,
    generation: receipt.generation,
    receiptHash: receipt.receiptHash,
    receiptJson: JSON.stringify(receipt),
    readbackJson: JSON.stringify(receipt.readback),
    ...receipt,
  }
}

function intentFor(ingestion, sourceRow) {
  return {
    id: `intent-${ingestion.id}`,
    runId: runFor(ingestion).id,
    executionRunId: ingestion.executionRunId,
    scopeJson: JSON.stringify(scope),
    sourceId: sourceRow.id,
    documentId: sourceRow.id,
    rawArtifactId: ingestion.rawArtifactId,
    version: ingestion.sourceVersion,
    contentHash: ingestion.contentHash,
    portfolioId: scope.portfolioId,
    tenantId: scope.tenantId,
    businessId: scope.businessId,
    workspaceId: scope.workspaceId,
    agentId: scope.agentId,
    visibility: scope.visibility,
  }
}

function batchFor(ingestion, sourceRow, receipt = receiptFor(ingestion)) {
  const stage9 = {
    runId: ingestion.executionRunId,
    pipelineStageId: stageIdForNumber(9),
    executionStepId: `stage9-step-${ingestion.id}`,
    attemptId: `stage9-attempt-${ingestion.id}`,
    stageNumber: 9,
  }
  const request = {
    schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
    runId: ingestion.executionRunId,
    scope,
    stages: [stage9],
    source: {
      sourceId: sourceRow.id,
      rawArtifactId: ingestion.rawArtifactId,
      parsedArtifactId: ingestion.parsedArtifactId,
      documentId: sourceRow.id,
      version: ingestion.sourceVersion,
      contentHash: ingestion.contentHash,
    },
  }
  return {
    id: `batch-${ingestion.id}`,
    runId: runFor(ingestion).id,
    executionRunId: ingestion.executionRunId,
    stage9StepId: stage9.executionStepId,
    stage9AttemptId: stage9.attemptId,
    scopeJson: JSON.stringify(scope),
    requestJson: JSON.stringify(request),
    decisionId: receipt.decisionId,
  }
}

function addPublicationEvidence(repo, ingestion, sourceRow) {
  const receipt = receiptFor(ingestion)
  repo.runs.set(ingestion.executionRunId, runFor(ingestion))
  repo.receipts.set(ingestion.executionRunId, receipt)
  repo.intents.set(ingestion.executionRunId, intentFor(ingestion, sourceRow))
  repo.batches.set(ingestion.executionRunId, batchFor(ingestion, sourceRow, receipt))
}

function ingestionFor(sourceRow, over = {}) {
  const id = over.id || `ingestion-${sourceRow.id}`
  return {
    id,
    corpusId: sourceRow.corpusId,
    sourceId: sourceRow.id,
    revision: over.revision ?? sourceRow.desiredRevision,
    sourceVersion: over.sourceVersion || `v${over.revision ?? sourceRow.desiredRevision}`,
    contentHash: over.contentHash || hashGenesisRag17Text(over.content || `content-${id}`),
    content: over.content || `content-${id}`,
    sourceMetaJson: '{}',
    idempotencyKey: `idempotency-${id}`,
    requestHash: hashGenesisRag17Json({ id }),
    submittedById: owner.principal.id,
    status: over.status || 'QUEUED',
    executionRunId: over.executionRunId || `execution-${id}`,
    rawArtifactId: over.rawArtifactId || `raw-${id}`,
    parsedArtifactId: over.parsedArtifactId || `parsed-${id}`,
    snapshotId: over.snapshotId || `snapshot-${id}`,
    snapshotGeneration: over.snapshotGeneration || `native-generation-${id}`,
    receiptHash: over.receiptHash || 'b'.repeat(64),
    claimToken: null,
    leaseExpiresAt: null,
    attempts: 1,
    failureCode: null,
    version: over.version ?? 1,
    createdAt: new Date('2026-09-08T00:00:00.000Z'),
    updatedAt: new Date('2026-09-08T00:00:00.000Z'),
    ...over,
  }
}

function chunkFor(ingestion, over = {}) {
  const text = over.text || ingestion.content
  return {
    id: over.id || `chunk-${ingestion.id}`,
    parsedArtifactId: ingestion.parsedArtifactId,
    documentId: ingestion.sourceId,
    ordinal: 0,
    text,
    contentHash: hashGenesisRag17Text(text),
    startOffset: 0,
    endOffset: text.length,
    ...over,
  }
}

class MemoryKnowledgeRepository {
  constructor(state = {}) {
    this.corpora = new Map([...state.corpora || []].map(([id, row]) => [id, clone(row)]))
    this.sources = new Map([...state.sources || []].map(([id, row]) => [id, clone(row)]))
    this.ingestions = new Map([...state.ingestions || []].map(([id, row]) => [id, clone(row)]))
    this.generations = new Map([...state.generations || []].map(([key, row]) => [key, clone(row)]))
    this.runs = new Map([...state.runs || []].map(([id, row]) => [id, clone(row)]))
    this.receipts = new Map([...state.receipts || []].map(([id, row]) => [id, clone(row)]))
    this.intents = new Map([...state.intents || []].map(([id, row]) => [id, clone(row)]))
    this.batches = new Map([...state.batches || []].map(([id, row]) => [id, clone(row)]))
    this.chunks = new Map([...state.chunks || []].map(([id, row]) => [id, clone(row)]))
    this.auditEvents = state.auditEvents ? [...state.auditEvents].map(clone) : []
  }

  state() {
    return {
      corpora: [...this.corpora], sources: [...this.sources], ingestions: [...this.ingestions],
      generations: [...this.generations], runs: [...this.runs], receipts: [...this.receipts],
      intents: [...this.intents], batches: [...this.batches], chunks: [...this.chunks], auditEvents: this.auditEvents,
    }
  }

  async transaction(callback) {
    const tx = new MemoryKnowledgeRepository(this.state())
    const result = await callback(tx)
    Object.assign(this, tx)
    return result
  }

  getCorpus(id) { return Promise.resolve(clone(this.corpora.get(id) || null)) }
  findCorpusByScope({ businessId, projectId = null }) {
    return Promise.resolve(clone([...this.corpora.values()].find((row) => row.businessId === businessId && (row.projectId || null) === (projectId || null)) || null))
  }
  getSource(id) { return Promise.resolve(clone(this.sources.get(id) || null)) }
  listSources(corpusId) { return Promise.resolve(clone([...this.sources.values()].filter((row) => row.corpusId === corpusId).sort((a, b) => a.id.localeCompare(b.id)))) }
  getIngestion(id) { return Promise.resolve(clone(this.ingestions.get(id) || null)) }
  getGeneration(corpusId, number) { return Promise.resolve(clone(this.generations.get(`${corpusId}:${number}`) || null)) }
  async resolveLineage({ sourceId, documentId, version, rawArtifactId, parsedArtifactId, chunkId }) {
    const chunk = this.chunks.get(chunkId)
    const ingestion = [...this.ingestions.values()].find((row) => row.sourceId === sourceId && row.rawArtifactId === rawArtifactId && row.parsedArtifactId === parsedArtifactId && row.sourceVersion === version)
    if (!chunk || !ingestion) return null
    if (ingestion.content.slice(chunk.startOffset, chunk.endOffset) !== chunk.text) return null
    return clone({ sourceId, documentId, version, rawArtifactId, parsedArtifactId, contentHash: ingestion.contentHash, chunkId: chunk.id, text: chunk.text, startOffset: chunk.startOffset, endOffset: chunk.endOffset })
  }
  getPipelineRun(executionRunId) { return Promise.resolve(clone([...this.runs.values()].find((row) => row.executionRunId === executionRunId) || null)) }
  getIntentForRun(executionRunId) { return Promise.resolve(clone([...this.intents.values()].find((row) => row.executionRunId === executionRunId) || null)) }
  getBatchForRun(executionRunId) { return Promise.resolve(clone([...this.batches.values()].find((row) => row.executionRunId === executionRunId) || null)) }
  async verifyPublication(executionRunId) {
    const row = [...this.receipts.values()].find((candidate) => candidate.executionRunId === executionRunId)
    return row ? clone(JSON.parse(row.receiptJson)) : null
  }

  async createGeneration(data) {
    const row = { id: data.id || `generation-${data.corpusId}-${data.number}`, createdAt: new Date(), ...clone(data) }
    this.generations.set(`${row.corpusId}:${row.number}`, row)
    return clone(row)
  }

  async updateCorpus(id, expectedVersion, data) {
    const row = this.corpora.get(id)
    if (!row || row.version !== expectedVersion) return null
    Object.assign(row, clone(data), { version: row.version + 1 })
    return clone(row)
  }

  async updateSource(id, expectedVersion, data) {
    const row = this.sources.get(id)
    if (!row || row.version !== expectedVersion) return null
    Object.assign(row, clone(data), { version: row.version + 1 })
    return clone(row)
  }

  async updateIngestion(id, data, { expectedVersion } = {}) {
    const row = this.ingestions.get(id)
    if (!row || (expectedVersion !== undefined && row.version !== expectedVersion)) return null
    Object.assign(row, clone(data), { version: row.version + 1 })
    return clone(row)
  }

  async audit(event) { this.auditEvents.push(clone(event)); return event }
}

function makeDb({ business = {}, project = {}, fileAssets = [] } = {}) {
  const files = new Map(fileAssets.map((row) => [row.id, row]))
  return {
    business: {
      findUnique: vi.fn(async ({ where: { id } }) => id === scope.businessId
        ? { id, tenantId: scope.tenantId, status: 'ACTIVE', tenant: { portfolioId: scope.portfolioId }, ...business }
        : null),
    },
    project: {
      findUnique: vi.fn(async ({ where: { id } }) => id === 'project-1'
        ? { id, businessId: scope.businessId, workspaceId: scope.workspaceId, deletedAt: null, workspace: { id: scope.workspaceId, tenantId: scope.tenantId, businessId: scope.businessId, scopeType: 'BUSINESS' }, business: { id: scope.businessId, tenantId: scope.tenantId }, ...project }
        : null),
    },
    fileAsset: { findUnique: vi.fn(async ({ where: { id } }) => clone(files.get(id) || null)) },
  }
}

function seed({ count = 1, fileAsset = null } = {}) {
  const rows = []
  for (let index = 1; index <= count; index += 1) rows.push(source({ id: `source-${index}` }))
  const firstIngestion = ingestionFor(rows[0], { id: 'ingestion-1', content: 'alpha document', snapshotId: 'snapshot-1', snapshotGeneration: 'native-1', rawArtifactId: 'raw-1', parsedArtifactId: 'parsed-1', receiptHash: 'b'.repeat(64) })
  const repo = new MemoryKnowledgeRepository({
    corpora: [['corpus-1', corpus()]],
    sources: rows.map((row) => [row.id, row]),
    ingestions: [['ingestion-1', firstIngestion]],
    chunks: [
      ['chunk-1', chunkFor(firstIngestion, { id: 'chunk-1', text: 'alpha' })],
      [`chunk-${firstIngestion.id}`, chunkFor(firstIngestion, { id: `chunk-${firstIngestion.id}`, text: 'alpha' })],
    ],
  })
  addPublicationEvidence(repo, firstIngestion, rows[0])
  const db = makeDb({ fileAssets: fileAsset ? [fileAsset] : [] })
  return { repo, db, sources: rows, firstIngestion }
}

async function publish(repo, db, ingestion, extra = {}) {
  return publishVerifiedKnowledgeIngestion(ingestion.id, { repository: repo, db, viewer: owner, ...extra })
}

describe('knowledge corpus publication, query and citation boundary', () => {
  let repo, db, sources, firstIngestion

  beforeEach(() => {
    ({ repo, db, sources, firstIngestion } = seed())
  })

  it('rejects a project corpus whose Project has no owning Business', async () => {
    const sharedDb = makeDb({ project: { businessId: null, workspace: { scopeType: 'PORTFOLIO', businessId: null } } })
    await expect(queryKnowledgeCorpus({ businessId: scope.businessId, projectId: 'project-1', query: 'alpha' }, { repository: repo, db: sharedDb, viewer: reader, querySnapshot: vi.fn() }))
      .rejects.toMatchObject({ status: 403, code: 'KNOWLEDGE_PROJECT_BUSINESS_REQUIRED' })
  })

  it('rejects a corpus whose stored workspace identity differs from its native scope', async () => {
    repo.corpora.get('corpus-1').workspaceId = 'workspace-elsewhere'
    await expect(queryKnowledgeCorpus({ businessId: scope.businessId, projectId: 'project-1', query: 'alpha' }, { repository: repo, db, viewer: reader, querySnapshot: vi.fn() }))
      .rejects.toMatchObject({ status: 409, code: 'KNOWLEDGE_SCOPE_INVALID' })
  })

  it('publishes only a succeeded run with an exact receipt and retains the full manifest entry', async () => {
    const result = await publish(repo, db, firstIngestion)
    expect(result.status).toBe('PUBLISHED')
    expect(result.manifest.entries).toHaveLength(1)
    expect(result.manifest.entries[0]).toMatchObject({
      sourceId: 'source-1', ingestionId: 'ingestion-1', snapshotId: 'snapshot-1',
      generation: 'native-1', rawArtifactId: 'raw-1', parsedArtifactId: 'parsed-1',
      receiptHash: 'b'.repeat(64), contentHash: firstIngestion.contentHash,
    })
    expect(result.manifestHash).toMatch(/^[a-f0-9]{64}$/)
    expect(repo.auditEvents).toHaveLength(1)
  })

  it('requires exact intent and Stage 9 batch lineage before publication', async () => {
    repo.intents.get(firstIngestion.executionRunId).documentId = 'source-1-alias'
    await expect(publish(repo, db, firstIngestion)).rejects.toMatchObject({ status: 409, code: 'KNOWLEDGE_PUBLICATION_PREREQUISITE' })

    repo.intents.get(firstIngestion.executionRunId).documentId = 'source-1'
    repo.batches.delete(firstIngestion.executionRunId)
    await expect(publish(repo, db, firstIngestion)).rejects.toMatchObject({ status: 409, code: 'KNOWLEDGE_PUBLICATION_PREREQUISITE' })
  })

  it('does not treat an ingestion lease as publication authority', async () => {
    firstIngestion.status = 'RUNNING'
    firstIngestion.claimToken = 'lease-1'
    await expect(publishVerifiedKnowledgeIngestion(firstIngestion.id, { repository: repo, db, claimToken: 'lease-1' }))
      .rejects.toThrow(/viewer is required/)
  })

  it('accepts the root-owned capability only for its exact scope and execution run', async () => {
    const authority = createKnowledgeExecutionAuthority(scope, 'execute', firstIngestion.executionRunId)
    const result = await publishVerifiedKnowledgeIngestion(firstIngestion.id, { repository: repo, db, authority })
    expect(result.status).toBe('PUBLISHED')
  })

  it('merges a correction without dropping another source and makes stale completion superseded', async () => {
    await publish(repo, db, firstIngestion)
    const second = sources[1] = source({ id: 'source-2' })
    repo.sources.set(second.id, second)
    const secondIngestion = ingestionFor(second, { id: 'ingestion-2', content: 'beta', snapshotId: 'snapshot-2', snapshotGeneration: 'native-2', rawArtifactId: 'raw-2', parsedArtifactId: 'parsed-2' })
    repo.ingestions.set(secondIngestion.id, secondIngestion)
    addPublicationEvidence(repo, secondIngestion, second)
    repo.chunks.set('chunk-2', chunkFor(secondIngestion, { id: 'chunk-2', text: 'beta' }))
    repo.chunks.set(`chunk-${secondIngestion.id}`, chunkFor(secondIngestion, { id: `chunk-${secondIngestion.id}`, text: 'beta' }))
    await publish(repo, db, secondIngestion)

    const first = repo.sources.get('source-1')
    first.desiredRevision = 2
    const correction = ingestionFor(first, { id: 'ingestion-1-v2', revision: 2, sourceVersion: 'v2', content: 'alpha corrected', snapshotId: 'snapshot-1-v2', snapshotGeneration: 'native-1-v2', rawArtifactId: 'raw-1-v2', parsedArtifactId: 'parsed-1-v2' })
    repo.ingestions.set(correction.id, correction)
    addPublicationEvidence(repo, correction, first)
    repo.chunks.set('chunk-1-v2', chunkFor(correction, { id: 'chunk-1-v2', text: 'alpha corrected' }))
    repo.chunks.set(`chunk-${correction.id}`, chunkFor(correction, { id: `chunk-${correction.id}`, text: 'alpha corrected' }))
    const corrected = await publish(repo, db, correction)
    expect(corrected.manifest.entries.map((entry) => entry.sourceId)).toEqual(['source-1', 'source-2'])
    expect(corrected.manifest.entries.find((entry) => entry.sourceId === 'source-2').ingestionId).toBe('ingestion-2')
    expect(corrected.manifest.entries.find((entry) => entry.sourceId === 'source-1').ingestionId).toBe('ingestion-1-v2')

    const stale = ingestionFor(first, { id: 'ingestion-1-stale', revision: 1, sourceVersion: 'v1-stale', content: 'old', snapshotId: 'snapshot-stale', snapshotGeneration: 'native-stale', rawArtifactId: 'raw-stale', parsedArtifactId: 'parsed-stale' })
    repo.ingestions.set(stale.id, stale)
    const staleResult = await publish(repo, db, stale)
    expect(staleResult.status).toBe('SUPERSEDED')
    expect(repo.corpora.get('corpus-1').generation).toBe(corrected.corpus.generation)
  })

  it('refuses ordinary publication prerequisites when the run is not successfully evidenced', async () => {
    const failed = repo.runs.get(firstIngestion.executionRunId)
    failed.status = 'FAILED'
    await expect(publish(repo, db, firstIngestion)).rejects.toMatchObject({ status: 409, code: 'KNOWLEDGE_PUBLICATION_PREREQUISITE' })
  })

  it('uses RRF k=60 across explicit snapshots and rejects foreign snapshot or lineage hits', async () => {
    await publish(repo, db, firstIngestion)
    const second = source({ id: 'source-2' })
    repo.sources.set(second.id, second)
    const secondIngestion = ingestionFor(second, { id: 'ingestion-2', content: 'beta', snapshotId: 'snapshot-2', snapshotGeneration: 'native-2', rawArtifactId: 'raw-2', parsedArtifactId: 'parsed-2' })
    repo.ingestions.set(secondIngestion.id, secondIngestion)
    addPublicationEvidence(repo, secondIngestion, second)
    repo.chunks.set('chunk-2', chunkFor(secondIngestion, { id: 'chunk-2', text: 'beta' }))
    repo.chunks.set(`chunk-${secondIngestion.id}`, chunkFor(secondIngestion, { id: `chunk-${secondIngestion.id}`, text: 'beta' }))
    await publish(repo, db, secondIngestion)
    const calls = []
    const querySnapshot = vi.fn(async ({ snapshotId, scope: requestedScope }) => {
      calls.push({ snapshotId, scope: requestedScope })
      const ingestion = snapshotId === 'snapshot-1' ? firstIngestion : secondIngestion
      const chunk = repo.chunks.get(`chunk-${ingestion.id}`)
      return {
        schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
        scope,
        snapshotId,
        generation: ingestion.snapshotGeneration,
        results: [{ id: `hit-${snapshotId}`, score: 0.4, text: chunk.text, citation: {
          sourceId: ingestion.sourceId, rawArtifactId: ingestion.rawArtifactId, parsedArtifactId: ingestion.parsedArtifactId,
          chunkId: `chunk-${ingestion.id}`, contentHash: chunk.contentHash,
        } }],
      }
    })
    const result = await queryKnowledgeCorpus({ businessId: scope.businessId, projectId: 'project-1', query: 'content', topK: 5 }, { repository: repo, db, viewer: reader, querySnapshot })
    expect(result.ranking).toBe('rrf-k60')
    expect(result.results).toHaveLength(2)
    expect(result.results[0].rankFusionScore).toBeCloseTo(1 / 61)
    expect(result.results.find((row) => row.sourceId === 'source-1').contentHash).toBe(firstIngestion.contentHash)
    expect(result.results.find((row) => row.sourceId === 'source-1').contentHash).not.toBe(repo.chunks.get('chunk-ingestion-1').contentHash)
    expect(calls).toHaveLength(2)
    expect(calls.every((call) => JSON.stringify(call.scope) === JSON.stringify(scope))).toBe(true)

    const foreign = vi.fn(async ({ snapshotId }) => ({
      schemaVersion: GENESIS_RAG17_SCHEMA_VERSION, scope, snapshotId: 'foreign', generation: 'native-1', results: [],
    }))
    await expect(queryKnowledgeCorpus({ businessId: scope.businessId, projectId: 'project-1', query: 'content' }, { repository: repo, db, viewer: reader, querySnapshot: foreign }))
      .rejects.toMatchObject({ status: 502, code: 'KNOWLEDGE_SNAPSHOT_MISMATCH' })
  })

  it('fails a delayed query after the current source is revoked', async () => {
    await publish(repo, db, firstIngestion)
    const querySnapshot = vi.fn(async () => {
      repo.sources.get('source-1').revokedAt = new Date()
      return {
        schemaVersion: GENESIS_RAG17_SCHEMA_VERSION, scope, snapshotId: 'snapshot-1', generation: 'native-1', results: [],
      }
    })
    await expect(queryKnowledgeCorpus({ businessId: scope.businessId, projectId: 'project-1', query: 'alpha' }, { repository: repo, db, viewer: reader, querySnapshot }))
      .rejects.toMatchObject({ status: 404, code: 'KNOWLEDGE_SOURCE_REVOKED' })
  })

  it('refreshes the viewer before returning a delayed query', async () => {
    await publish(repo, db, firstIngestion)
    let currentViewer = reader
    const querySnapshot = vi.fn(async () => {
      currentViewer = deniedViewer
      return { schemaVersion: GENESIS_RAG17_SCHEMA_VERSION, scope, snapshotId: 'snapshot-1', generation: 'native-1', results: [] }
    })
    await expect(queryKnowledgeCorpus({ businessId: scope.businessId, projectId: 'project-1', query: 'alpha' }, { repository: repo, db, viewer: reader, querySnapshot, resolveCurrentViewer: () => currentViewer }))
      .rejects.toMatchObject({ status: 404, code: 'KNOWLEDGE_BUSINESS_NOT_FOUND' })
  })

  it('resolves a historical citation after correction while current access remains valid', async () => {
    const firstPublished = await publish(repo, db, firstIngestion)
    const citationId = citationReference({ corpusId: 'corpus-1', corpusGeneration: firstPublished.corpus.generation, sourceId: 'source-1', ingestionId: firstIngestion.id, chunkId: 'chunk-1' })
    const correction = ingestionFor(repo.sources.get('source-1'), { id: 'ingestion-1-v2', revision: 2, sourceVersion: 'v2', content: 'alpha corrected', snapshotId: 'snapshot-1-v2', snapshotGeneration: 'native-1-v2', rawArtifactId: 'raw-1-v2', parsedArtifactId: 'parsed-1-v2' })
    repo.sources.get('source-1').desiredRevision = 2
    repo.ingestions.set(correction.id, correction)
    addPublicationEvidence(repo, correction, repo.sources.get('source-1'))
    repo.chunks.set('chunk-1-v2', chunkFor(correction, { id: 'chunk-1-v2', text: 'alpha corrected' }))
    repo.chunks.set(`chunk-${correction.id}`, chunkFor(correction, { id: `chunk-${correction.id}`, text: 'alpha corrected' }))
    await publish(repo, db, correction)
    expect(citationId).toBeTruthy()
    const resolved = await resolveKnowledgeCitation(citationId, { repository: repo, db, viewer: reader })
    expect(resolved.text).toBe('alpha')
    expect(resolved.ingestionId).toBe(firstIngestion.id)
    expect(resolved.contentHash).toBe(firstIngestion.contentHash)
  })

  it('denies a Business citation after the FileAsset project is deleted', async () => {
    const file = { id: 'file-1', businessId: scope.businessId, tenantId: scope.tenantId, projectId: 'project-1', status: 'ACTIVE', deletedAt: null }
    const seeded = seed({ fileAsset: file })
    seeded.repo.corpora.get('corpus-1').projectId = null
    seeded.repo.sources.get('source-1').fileAssetId = file.id
    const published = await publish(seeded.repo, seeded.db, seeded.firstIngestion)
    const citationId = citationReference({ corpusId: 'corpus-1', corpusGeneration: published.corpus.generation, sourceId: 'source-1', ingestionId: seeded.firstIngestion.id, chunkId: 'chunk-1' })
    seeded.db.project.findUnique.mockResolvedValue(null)
    await expect(resolveKnowledgeCitation(citationId, { repository: seeded.repo, db: seeded.db, viewer: reader }))
      .rejects.toMatchObject({ status: 404, code: 'KNOWLEDGE_PROJECT_NOT_FOUND' })
  })

  it('refreshes the viewer before returning a delayed historical citation', async () => {
    const published = await publish(repo, db, firstIngestion)
    const citationId = citationReference({ corpusId: 'corpus-1', corpusGeneration: published.corpus.generation, sourceId: 'source-1', ingestionId: firstIngestion.id, chunkId: 'chunk-1' })
    let currentViewer = reader
    const resolveLineage = repo.resolveLineage.bind(repo)
    repo.resolveLineage = async (...args) => {
      currentViewer = deniedViewer
      return resolveLineage(...args)
    }
    await expect(resolveKnowledgeCitation(citationId, { repository: repo, db, viewer: reader, resolveCurrentViewer: () => currentViewer }))
      .rejects.toMatchObject({ status: 404, code: 'KNOWLEDGE_BUSINESS_NOT_FOUND' })
  })

  it('withdraws source membership with CAS and blocks the withdrawn citation', async () => {
    const published = await publish(repo, db, firstIngestion)
    const querySnapshot = vi.fn(async () => ({ schemaVersion: GENESIS_RAG17_SCHEMA_VERSION, scope, snapshotId: 'snapshot-1', generation: 'native-1', results: [{ id: 'hit', score: 1, text: 'alpha', citation: { sourceId: 'source-1', rawArtifactId: 'raw-1', parsedArtifactId: 'parsed-1', chunkId: 'chunk-1', contentHash: repo.chunks.get('chunk-1').contentHash } }] }))
    const queried = await queryKnowledgeCorpus({ businessId: scope.businessId, projectId: 'project-1', query: 'alpha' }, { repository: repo, db, viewer: reader, querySnapshot })
    const withdrawn = await withdrawKnowledgeSource('source-1', { expectedVersion: repo.sources.get('source-1').version }, { repository: repo, db, viewer: owner })
    expect(withdrawn.status).toBe('WITHDRAWN')
    expect(withdrawn.manifest.entries).toHaveLength(0)
    await expect(resolveKnowledgeCitation(queried.results[0].citationId, { repository: repo, db, viewer: reader }))
      .rejects.toMatchObject({ status: 404, code: 'KNOWLEDGE_SOURCE_REVOKED' })
    await expect(withdrawKnowledgeSource('source-1', { expectedVersion: 1 }, { repository: repo, db, viewer: owner }))
      .rejects.toMatchObject({ status: 409, code: 'KNOWLEDGE_SOURCE_VERSION_CONFLICT' })
    expect(published.manifest.entries).toHaveLength(1)
  })
})
