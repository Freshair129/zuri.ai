import prisma from '@/lib/db'

// @req FR-173 — one persistence adapter for durable admission and immutable corpus manifests.
// @spec ADR-072, SEC-001
// @tested tests/integration/knowledge-admission.integration.test.js, tests/integration/knowledge-corpus.test.js

function mutable(data, allowed) {
  if (Object.keys(data).some((key) => !allowed.includes(key))) throw new Error('Knowledge repository refuses immutable field mutation')
}

export function createKnowledgeRepository(db = prisma) {
  const repository = {
    transaction(callback) {
      return typeof db.$transaction === 'function'
        ? db.$transaction((tx) => callback(createKnowledgeRepository(tx)))
        : callback(repository)
    },
    getCorpus: (id) => db.knowledgeCorpus.findUnique({ where: { id } }),
    findCorpusByKey: (corpusKey) => db.knowledgeCorpus.findUnique({ where: { corpusKey } }),
    findCorpusByScope: ({ businessId, projectId = null }) => db.knowledgeCorpus.findFirst({ where: { businessId, projectId, deletedAt: null }, orderBy: { createdAt: 'asc' } }),
    createCorpus: (data) => db.knowledgeCorpus.create({ data }),
    async updateCorpus(id, expectedVersion, data) {
      mutable(data, ['generation', 'status', 'deletedAt'])
      const result = await db.knowledgeCorpus.updateMany({ where: { id, version: expectedVersion }, data: { ...data, version: { increment: 1 } } })
      return result.count === 1 ? repository.getCorpus(id) : null
    },
    getSource: (id) => db.knowledgeSource.findUnique({ where: { id } }),
    findSource: (corpusId, sourceKey) => db.knowledgeSource.findUnique({ where: { corpusId_sourceKey: { corpusId, sourceKey } } }),
    listSources: (corpusId) => db.knowledgeSource.findMany({ where: { corpusId }, orderBy: { id: 'asc' } }),
    createSource: (data) => db.knowledgeSource.create({ data }),
    async updateSource(id, expectedVersion, data) {
      mutable(data, ['desiredRevision', 'activeIngestionId', 'title', 'revokedAt', 'deletedAt'])
      const result = await db.knowledgeSource.updateMany({ where: { id, version: expectedVersion }, data: { ...data, version: { increment: 1 } } })
      return result.count === 1 ? repository.getSource(id) : null
    },
    getIngestion: (id) => db.knowledgeIngestion.findUnique({ where: { id } }),
    findIngestionByKey: (idempotencyKey) => db.knowledgeIngestion.findUnique({ where: { idempotencyKey } }),
    findIngestionVersion: (sourceId, sourceVersion) => db.knowledgeIngestion.findUnique({ where: { sourceId_sourceVersion: { sourceId, sourceVersion } } }),
    createIngestion: (data) => db.knowledgeIngestion.create({ data }),
    async updateIngestion(id, data, { claimToken, expectedVersion } = {}) {
      mutable(data, ['status', 'executionRunId', 'rawArtifactId', 'parsedArtifactId', 'snapshotId', 'snapshotGeneration', 'receiptHash', 'claimToken', 'leaseExpiresAt', 'failureCode'])
      const where = { id, ...(claimToken !== undefined ? { claimToken } : {}), ...(expectedVersion !== undefined ? { version: expectedVersion } : {}) }
      const result = await db.knowledgeIngestion.updateMany({ where, data: { ...data, version: { increment: 1 } } })
      return result.count === 1 ? repository.getIngestion(id) : null
    },
    listIngestions({ corpusId, statuses, limit = 100 } = {}) {
      return db.knowledgeIngestion.findMany({ where: { ...(corpusId ? { corpusId } : {}), ...(statuses ? { status: { in: statuses } } : {}) }, orderBy: { createdAt: 'desc' }, take: limit })
    },
    listPending({ now = new Date(), limit = 20 } = {}) {
      return db.knowledgeIngestion.findMany({ where: { status: { in: ['QUEUED', 'RUNNING'] }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] }, orderBy: { createdAt: 'asc' }, take: limit })
    },
    async claimIngestion(id, { claimToken, now = new Date(), leaseMs = 120000 } = {}) {
      const result = await db.knowledgeIngestion.updateMany({
        where: { id, status: { in: ['QUEUED', 'RUNNING'] }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] },
        data: { claimToken, leaseExpiresAt: new Date(now.getTime() + leaseMs), status: 'RUNNING', attempts: { increment: 1 }, version: { increment: 1 } },
      })
      return result.count === 1 ? repository.getIngestion(id) : null
    },
    getGeneration: (corpusId, number) => db.knowledgeCorpusGeneration.findUnique({ where: { corpusId_number: { corpusId, number } } }),
    createGeneration: (data) => db.knowledgeCorpusGeneration.create({ data }),
    getPipelineRun: (executionRunId) => db.pipelineRun.findUnique({ where: { executionRunId } }),
    getBatchForRun: (executionRunId) => db.genesisRag17Batch.findFirst({ where: { executionRunId } }),
    getPublicationForRun: (executionRunId) => db.genesisRag17PublicationReceipt.findFirst({ where: { executionRunId }, orderBy: { createdAt: 'desc' } }),
    async verifyPublication(executionRunId, scope) {
      const { assertGenesisRag17Publication } = await import('@/platform/integrations/core/genesisrag17-publication')
      return assertGenesisRag17Publication({ schemaVersion: 'genesisrag17.v1', executionRunId, scope }, { db })
    },
    getIntentForRun: (executionRunId) => db.genesisRag17IngestionIntent.findUnique({ where: { executionRunId } }),
    listStageEvidence: (executionRunId) => db.genesisRag17StageEvidence.findMany({ where: { executionRunId }, orderBy: { stageNumber: 'asc' } }),
    getFileAsset: (id) => db.fileAsset.findUnique({ where: { id } }),
    async resolveLineage(reference) {
      const { resolveGenesisRag17RawLineage } = await import('@/platform/integrations/core/genesisrag17-executor')
      return resolveGenesisRag17RawLineage(reference, { db })
    },
    async audit({ entityId, action, actorId, payload, entityType = 'KNOWLEDGE_CORPUS' }) {
      const { recordAudit } = await import('@/modules/project-manager/application/audit')
      return recordAudit(db, { entityType, entityId, action, actorId, payload })
    },
  }
  return Object.freeze(repository)
}
