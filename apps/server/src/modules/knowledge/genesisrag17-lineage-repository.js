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
 * Persistence boundary for the immutable Tier 1 lineage.
 *
 * The adapter deliberately exposes only scoped find/create/list operations;
 * updates and deletes are absent because correcting source content creates a
 * new version identity. Pipeline run, stage and MSP batch writes remain in
 * their existing orchestration repositories.
 */
export function createGenesisRag17LineageRepository(db, scope) {
  assertScope(scope)
  assertModel(db, 'knowledgeRawArtifact')
  assertModel(db, 'knowledgeParsedArtifact')
  assertModel(db, 'knowledgeChunk')

  const raw = db.knowledgeRawArtifact
  const parsed = db.knowledgeParsedArtifact
  const chunk = db.knowledgeChunk

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
  })
}

export { SCOPE_KEYS }
