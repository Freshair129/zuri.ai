import prisma from '@/lib/db'
import { KNOWLEDGE_INGESTION_DEFINITION_ID } from '@/platform/integrations/core/pipeline-tracking-contract'

// @req FR-173 — one persistence adapter for durable admission and immutable corpus manifests.
// @spec ADR-072, SEC-001
// @tested tests/integration/knowledge-admission.integration.test.js, tests/integration/knowledge-corpus.test.js

function mutable(data, allowed) {
  if (Object.keys(data).some((key) => !allowed.includes(key))) throw new Error('Knowledge repository refuses immutable field mutation')
}

export function createKnowledgeRepository(db = prisma) {
  const repository = {
    // `options` ({ maxWait, timeout }) is passed to Prisma's interactive
    // transaction; without it Prisma closes the transaction after 5s.
    transaction(callback, options) {
      if (typeof db.$transaction !== 'function') return callback(repository)
      return options
        ? db.$transaction((tx) => callback(createKnowledgeRepository(tx)), options)
        : db.$transaction((tx) => callback(createKnowledgeRepository(tx)))
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
    getIngestions: (ids) => db.knowledgeIngestion.findMany({ where: { id: { in: ids } } }),
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
    // FR-173: a job stopped being resumed the moment its status left
    // QUEUED/RUNNING (listPending never claims it again), so the runtime-side
    // reconciliation sweep has to find any such orphan itself — whether that
    // status was written here (processJob) or by a caller outside the runtime
    // entirely (withdrawKnowledgeSource, publishInTransaction's
    // stale-revision/revoked-source branches). Two bounded queries, no
    // cursor: this one is the *candidate set* — every knowledge PipelineRun
    // still QUEUED/RUNNING, ids only. It is never itself the actionable set:
    // most of these ids belong to runs with no KnowledgeIngestion at all
    // (FR-071 replay runs, FR-109 reporter runs — KNOWLEDGE_INGESTION_DEFINITION_ID
    // is shared, the executionRunId is not) or to an ingestion that is
    // legitimately still QUEUED/RUNNING. `listOrphanedIngestionsForRuns`
    // resolves which of these ids are real orphans.
    listOpenKnowledgeRunIds({ limit = 500 } = {}) {
      return db.pipelineRun.findMany({
        where: { dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID, status: { in: ['QUEUED', 'RUNNING'] } },
        select: { executionRunId: true },
        take: limit,
      })
    },
    // Every row this returns is actionable by construction: it is already
    // scoped to open (QUEUED/RUNNING) runs, already filtered to
    // SUPERSEDED/WITHDRAWN, and already filtered to an expired-or-absent
    // lease. Nothing the sweep does after this can skip a returned row for a
    // reason baked into the query itself — a page can never be filled by rows
    // the sweep goes on to ignore. `executionRunIds` is chunked in slices of
    // 100 to stay under Prisma/SQL parameter limits; results are merged and
    // re-sorted (oldest `updatedAt` first) before the final `limit`, since a
    // per-chunk `take` could not enforce a single global ordering.
    async listOrphanedIngestionsForRuns({ executionRunIds, now = new Date(), limit = 20 } = {}) {
      if (!Array.isArray(executionRunIds) || executionRunIds.length === 0) return []
      const rows = []
      for (let start = 0; start < executionRunIds.length; start += 100) {
        const chunk = executionRunIds.slice(start, start + 100)
        rows.push(...await db.knowledgeIngestion.findMany({
          where: { executionRunId: { in: chunk }, status: { in: ['SUPERSEDED', 'WITHDRAWN'] }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] },
        }))
      }
      rows.sort((left, right) => left.updatedAt.getTime() - right.updatedAt.getTime())
      return rows.slice(0, limit)
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
    getParsedArtifact: (id) => db.knowledgeParsedArtifact.findUnique({ where: { id } }),
    getParsedArtifacts: (ids) => db.knowledgeParsedArtifact.findMany({ where: { id: { in: ids } } }),
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
