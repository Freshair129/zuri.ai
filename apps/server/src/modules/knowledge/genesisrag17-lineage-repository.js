// @req FR-109 — Tier 1 raw, parsed and chunk lineage is persisted through a
// scope-bound repository so the local executor can be replaced by another
// storage adapter without changing its stage orchestration.
// @spec ADR-050, ADR-063, NFR-018, docs/plans/GENESISRAG17-CONTRACT.md
// @tested tests/unit/genesisrag17-lineage-repository.test.js, tests/integration/genesisrag17-tier1.test.js

const SCOPE_KEYS = Object.freeze(['portfolioId', 'tenantId', 'businessId', 'workspaceId', 'agentId', 'visibility'])

function assertScope(scope) {
  for (const key of SCOPE_KEYS) {
    if (typeof scope?.[key] !== 'string') throw new Error(`GenesisRAG17 lineage repository requires ${key}`)
  }
}

function assertModel(db, name) {
  if (!db?.[name] || typeof db[name].findFirst !== 'function' || typeof db[name].findMany !== 'function' || typeof db[name].create !== 'function') {
    throw new Error(`GenesisRAG17 lineage repository requires Prisma model ${name}`)
  }
}

function assertRowScope(row, scope) {
  for (const key of SCOPE_KEYS) {
    if (row?.[key] !== scope[key]) throw new Error(`GenesisRAG17 lineage row is outside ${key} scope`)
  }
}

function whereFor(scope, extra = {}) {
  return { ...extra, ...Object.fromEntries(SCOPE_KEYS.map((key) => [key, scope[key]])) }
}

/**
 * Persistence boundary for the immutable Tier 1 lineage and its resumable
 * intent ledger. Source artifacts and occurrences are append-only; the intent
 * exposes only its operational status fields for recovery.
 *
 * The adapter deliberately exposes only scoped find/create/list operations for
 * source artifacts and occurrences; correcting source content creates a new
 * version identity. Intent status updates are the one narrow recovery write.
 * Pipeline run, stage and MSP batch writes remain in their existing
 * orchestration repositories.
 */
export function createGenesisRag17LineageRepository(db, scope) {
  assertScope(scope)
  assertModel(db, 'knowledgeRawArtifact')
  assertModel(db, 'knowledgeParsedArtifact')
  assertModel(db, 'knowledgeChunk')

  const raw = db.knowledgeRawArtifact
  const parsed = db.knowledgeParsedArtifact
  const chunk = db.knowledgeChunk
  const intent = db.genesisRag17IngestionIntent
  const mention = db.genesisRag17SourceMention
  const requireIntent = () => {
    assertModel(db, 'genesisRag17IngestionIntent')
    return intent
  }
  const requireMention = () => {
    assertModel(db, 'genesisRag17SourceMention')
    return mention
  }

  return Object.freeze({
    findRawById(id) {
      if (!id) throw new Error('GenesisRAG17 raw artifact id is required')
      return raw.findFirst({ where: whereFor(scope, { id }) })
    },

    findRawByIdentity({ sourceId, version, contentHash, pipelineVersion }) {
      return raw.findFirst({ where: whereFor(scope, { sourceId, version, contentHash, pipelineVersion }) })
    },

    listRawBySource(sourceId) {
      if (!sourceId) throw new Error('GenesisRAG17 raw sourceId is required')
      return raw.findMany({ where: whereFor(scope, { sourceId }), orderBy: { createdAt: 'asc' } })
    },

    createRaw(data) {
      assertRowScope(data, scope)
      return raw.create({ data })
    },

    findParsedById(id) {
      if (!id) throw new Error('GenesisRAG17 parsed artifact id is required')
      return parsed.findFirst({ where: whereFor(scope, { id }) })
    },

    findParsedByRawAndParser(rawArtifactId, parserVersion) {
      if (!rawArtifactId || !parserVersion) throw new Error('GenesisRAG17 parsed artifact parent and parser version are required')
      return parsed.findFirst({ where: whereFor(scope, { rawArtifactId, parserVersion }) })
    },

    createParsed(data) {
      assertRowScope(data, scope)
      return parsed.create({ data })
    },

    findChunkById(id) {
      if (!id) throw new Error('GenesisRAG17 chunk id is required')
      return chunk.findFirst({ where: whereFor(scope, { id }) })
    },

    findChunkByOrdinal(parsedArtifactId, ordinal) {
      if (!parsedArtifactId || !Number.isInteger(ordinal)) throw new Error('GenesisRAG17 chunk parent and ordinal are required')
      return chunk.findFirst({ where: whereFor(scope, { parsedArtifactId, ordinal }) })
    },

    listChunks(parsedArtifactId) {
      if (!parsedArtifactId) throw new Error('GenesisRAG17 chunk parent is required')
      return chunk.findMany({ where: whereFor(scope, { parsedArtifactId }), orderBy: { ordinal: 'asc' } })
    },

    createChunk(data) {
      assertRowScope(data, scope)
      return chunk.create({ data })
    },

    findIntentByKey(intentKey) {
      if (!intentKey) throw new Error('GenesisRAG17 ingestion intent key is required')
      return requireIntent().findFirst({ where: whereFor(scope, { intentKey }) })
    },

    findIntentById(id) {
      if (!id) throw new Error('GenesisRAG17 ingestion intent id is required')
      return requireIntent().findFirst({ where: whereFor(scope, { id }) })
    },

    findIntentByExecutionRunId(executionRunId) {
      if (!executionRunId) throw new Error('GenesisRAG17 ingestion intent executionRunId is required')
      return requireIntent().findFirst({ where: whereFor(scope, { executionRunId }) })
    },

    listResumableIntents() {
      return requireIntent().findMany({ where: whereFor(scope, { status: { in: ['PENDING', 'RUNNING'] } }), orderBy: { createdAt: 'asc' } })
    },

    listFailedIntents() {
      return requireIntent().findMany({ where: whereFor(scope, { status: 'FAILED' }), orderBy: { createdAt: 'asc' } })
    },

    createIntent(data) {
      assertRowScope(data, scope)
      return requireIntent().create({ data })
    },

    async updateIntent(id, data) {
      if (!id) throw new Error('GenesisRAG17 ingestion intent id is required')
      const mutableKeys = new Set(['status', 'nextStageNumber', 'lastErrorJson'])
      const attemptedKeys = Object.keys(data || {})
      const immutableKeys = attemptedKeys.filter((key) => !mutableKeys.has(key))
      if (immutableKeys.length) throw new Error(`GenesisRAG17 ingestion intent fields are immutable: ${immutableKeys.join(', ')}`)
      if (data?.status !== undefined && typeof data.status !== 'string') throw new Error('GenesisRAG17 ingestion intent status must be a string')
      if (data?.nextStageNumber !== undefined && (!Number.isSafeInteger(data.nextStageNumber) || data.nextStageNumber < 1)) throw new Error('GenesisRAG17 ingestion intent nextStageNumber must be a positive integer')
      const existing = await requireIntent().findFirst({ where: whereFor(scope, { id }) })
      if (!existing) throw new Error('GenesisRAG17 ingestion intent is outside the requested scope or missing')
      assertRowScope(existing, scope)
      return requireIntent().update({ where: { id: existing.id }, data })
    },

    listMentions({ executionRunId, attemptId, parsedArtifactId } = {}) {
      if (!executionRunId || !attemptId || !parsedArtifactId) throw new Error('GenesisRAG17 mention run, attempt and parsed artifact are required')
      return requireMention().findMany({ where: whereFor(scope, { executionRunId, attemptId, parsedArtifactId }), orderBy: [{ startOffset: 'asc' }, { endOffset: 'asc' }, { sourceMentionId: 'asc' }] })
    },

    findMention({ executionRunId, attemptId, sourceMentionId } = {}) {
      if (!executionRunId || !attemptId || !sourceMentionId) throw new Error('GenesisRAG17 mention run, attempt and sourceMentionId are required')
      return requireMention().findFirst({ where: whereFor(scope, { executionRunId, attemptId, sourceMentionId }) })
    },

    createMention(data) {
      assertRowScope(data, scope)
      return requireMention().create({ data })
    },
  })
}

export { SCOPE_KEYS }
