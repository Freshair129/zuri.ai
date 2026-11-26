import { describe, expect, it, vi } from 'vitest'
import { makeOperatorViewer } from '../factories/viewer'
import { createGenesisRag17SourceWorker, resumeGenesisRag17Worker } from '@/platform/integrations/core/genesisrag17-worker'
import { GENESIS_RAG17_SCHEMA_VERSION } from '@/modules/knowledge/genesisrag17-contract'
import { GENESIS_RAG17_RESPONSE_CONTRACT_FIELDS } from '@/modules/knowledge/genesisrag17-response-contract'

// @req FR-109 — a null MSP decision remains a durable pending outbox row until
// a later retry returns an actual decision identity.
// @spec ADR-073, ADR-121, docs/plans/GENESISRAG17-CONTRACT.md
// @tested tests/unit/genesisrag17-worker.test.js

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

function db(row) {
  return {
    knowledgeRawArtifact: model(),
    knowledgeParsedArtifact: model(),
    knowledgeChunk: model(),
    genesisRag17IngestionIntent: model(),
    genesisRag17SourceMention: model(),
    genesisRag17Batch: {
      findMany: vi.fn(async () => [row]),
      update: vi.fn(async ({ data }) => ({ ...row, ...data })),
    },
  }
}

function pendingBatch() {
  return {
    id: 'batch-row-1',
    batchId: 'batch-1',
    executionRunId: 'run-1',
    requestJson: JSON.stringify({
      schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
      batchId: 'batch-1',
      idempotencyKey: 'batch-key-1',
      scope,
    }),
  }
}

describe('GenesisRAG17 source worker submit retry', () => {
  it('keeps background retry alive through observer failures and resends the exact durable batch', async () => {
    vi.useFakeTimers()
    const row = pendingBatch()
    const prisma = db(row)
    const transport = vi.fn(async () => { throw new Error('private dependency error') })
    const onError = vi.fn().mockImplementationOnce(() => { throw new Error('observer') }).mockImplementation(() => Promise.reject(new Error('observer')))
    const worker = createGenesisRag17SourceWorker({ scope, runId: row.executionRunId, db: prisma, viewer: makeOperatorViewer(), transport, credential: 'source', random: () => 0, onError })
    try {
      expect(typeof worker.getStatus).toBe('function')
      worker.start()
      await vi.advanceTimersByTimeAsync(500)
      expect(transport).toHaveBeenCalledTimes(2)
      expect(transport.mock.calls[0]).toEqual(transport.mock.calls[1])
      expect(prisma.genesisRag17Batch.update).not.toHaveBeenCalled()
      expect(worker.getStatus()).toMatchObject({ consecutiveFailures: 2, retryBudgetExhausted: false })
      expect(JSON.stringify(onError.mock.calls)).not.toContain('private dependency error')
    } finally {
      await worker.stop()
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('keeps a null decision pending and retries the same outbox row', async () => {
    const row = pendingBatch()
    const prisma = db(row)
    const transport = vi.fn(async () => ({ schemaVersion: GENESIS_RAG17_SCHEMA_VERSION, scope, batchId: row.batchId, decisionId: null, status: 'PENDING' }))

    const result = await resumeGenesisRag17Worker({ scope, runId: row.executionRunId, db: prisma, viewer: makeOperatorViewer(), transport, credential: 'source' })

    expect(result.resumed).toEqual([row.batchId])
    expect(prisma.genesisRag17Batch.findMany).toHaveBeenCalledWith({
      where: { scopeJson: JSON.stringify(scope), executionRunId: row.executionRunId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    })
    expect(prisma.genesisRag17Batch.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: row.id },
      data: expect.objectContaining({ status: 'PENDING', decisionId: null }),
    }))
    const storedResponse = JSON.parse(prisma.genesisRag17Batch.update.mock.calls[0][0].data.responseJson)
    expect(Object.keys(storedResponse)).toEqual(GENESIS_RAG17_RESPONSE_CONTRACT_FIELDS)
    expect(storedResponse.decisionId).toBeNull()
  })

  it('stores only contract fields while keeping the reply decision in the column', async () => {
    const row = pendingBatch()
    const prisma = db(row)
    const transport = vi.fn(async () => ({
      schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
      scope,
      batchId: row.batchId,
      decisionId: 'worker-decision-1',
      status: 'ACKNOWLEDGED',
      entities: ['EXTRA_ENTITY_VALUE'],
      facts: ['EXTRA_FACT_VALUE'],
      heldRows: ['EXTRA_HELD_ROW_VALUE'],
      internal: 'EXTRA_INTERNAL_VALUE',
    }))

    await resumeGenesisRag17Worker({ scope, runId: row.executionRunId, db: prisma, viewer: makeOperatorViewer(), transport, credential: 'source' })

    const update = prisma.genesisRag17Batch.update.mock.calls[0][0].data
    expect(update).toMatchObject({ status: 'ACKNOWLEDGED', decisionId: 'worker-decision-1' })
    const storedResponse = JSON.parse(update.responseJson)
    expect(Object.keys(storedResponse)).toEqual(GENESIS_RAG17_RESPONSE_CONTRACT_FIELDS)
    expect(storedResponse).toEqual({
      schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
      scope,
      batchId: row.batchId,
      status: 'ACKNOWLEDGED',
      decisionId: 'worker-decision-1',
    })
    expect(update.responseJson).not.toContain('EXTRA_ENTITY_VALUE')
  })

  it('rejects an empty decision identity instead of acknowledging it', async () => {
    const row = pendingBatch()
    const prisma = db(row)
    const transport = vi.fn(async () => ({ schemaVersion: GENESIS_RAG17_SCHEMA_VERSION, scope, batchId: row.batchId, decisionId: '', status: 'PENDING' }))

    await expect(resumeGenesisRag17Worker({ scope, runId: row.executionRunId, db: prisma, viewer: makeOperatorViewer(), transport, credential: 'source' })).rejects.toThrow(/invalid batch acknowledgement/)
    expect(prisma.genesisRag17Batch.update).not.toHaveBeenCalled()
  })
})
