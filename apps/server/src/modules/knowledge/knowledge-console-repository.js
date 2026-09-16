import prisma from '@/lib/db'

// @req FR-253 — bounded console reads of the existing Tier 1 records.
// @spec ADR-072, ADR-085, SEC-001
// @tested tests/integration/fr253-knowledge-console.test.js
export const consoleVersionSelect = {
  id: true, sourceId: true, corpusId: true, revision: true, sourceVersion: true,
  contentHash: true, status: true, executionRunId: true, rawArtifactId: true,
  parsedArtifactId: true, snapshotId: true, snapshotGeneration: true,
  createdAt: true, updatedAt: true,
}

export function consolePageWhere(after) {
  return after ? { OR: [
    { createdAt: { lt: new Date(after.createdAt) } },
    { createdAt: new Date(after.createdAt), id: { lt: after.id } },
  ] } : {}
}

const page = (where, after, take) => ({
  where: { AND: [where, consolePageWhere(after)] },
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take,
})

export function createKnowledgeConsoleRepository(db = prisma) {
  const corpusWhere = ({ businessId, projectId }) => ({
    businessId, deletedAt: null, status: 'ACTIVE',
    ...(projectId ? { projectId } : {}),
  })
  return {
    sources(input, after, take) {
      return db.knowledgeSource.findMany({
        ...page({ corpus: corpusWhere(input), deletedAt: null, revokedAt: null,
          ...(input.q ? { title: { contains: input.q } } : {}) }, after, take),
        include: { corpus: true, ingestions: { orderBy: { revision: 'desc' }, take: 1, select: consoleVersionSelect } },
      })
    },
    source: (id) => db.knowledgeSource.findUnique({ where: { id }, include: { corpus: true, ingestions: { orderBy: { revision: 'desc' }, take: 1, select: consoleVersionSelect } } }),
    versions: (sourceId, after, take) => db.knowledgeIngestion.findMany({ ...page({ sourceId }, after, take), select: consoleVersionSelect }),
    corpora: (input, after, take) => db.knowledgeCorpus.findMany(page(corpusWhere(input), after, take)),
    corpus: (id) => db.knowledgeCorpus.findUnique({ where: { id } }),
    generations: (corpusId, after, take) => db.knowledgeCorpusGeneration.findMany(page({ corpusId }, after, take)),
    admissionForRun: (executionRunId) => db.knowledgeIngestion.findUnique({ where: { executionRunId }, select: consoleVersionSelect }),
    artifact: (kind, id) => kind === 'raw'
      ? db.knowledgeRawArtifact.findUnique({ where: { id } })
      : db.knowledgeParsedArtifact.findUnique({ where: { id } }),
  }
}
