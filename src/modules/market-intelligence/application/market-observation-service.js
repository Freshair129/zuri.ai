import { translateRawRecordToMarketObservation } from './translate-raw-record'

// Phase #76 application seam. Persistence is injected so the domain/application
// semantics are proven before binding to Prisma. Integration raw evidence remains
// read-only input; only Market-owned observation state is written here.
// @req FR-092, NFR-018
// @spec BR-019, SDD-049, SEC-017, ADR-038

function requireRepository(repository) {
  if (!repository || typeof repository.insertIfAbsent !== 'function') {
    throw new Error('MarketObservation repository with atomic insertIfAbsent is required')
  }
}

function requireRawRepository(rawRepository) {
  if (!rawRepository || typeof rawRepository.findById !== 'function') {
    throw new Error('scoped Integration raw-record repository with findById is required')
  }
}

export async function persistMarketObservationDraft(draft, { repository } = {}) {
  requireRepository(repository)

  if (!draft?.lineageKey) {
    throw new Error('MarketObservation draft lineageKey is required')
  }

  // The repository owns the atomicity boundary. A read-before-create sequence in
  // application code is not sufficient: two workers can both observe "missing"
  // and race the insert. The persistence adapter must serialize that identity via
  // a unique constraint/upsert or an equivalent atomic create-if-absent primitive.
  const result = await repository.insertIfAbsent(draft)
  if (!result || !['CREATED', 'UNCHANGED'].includes(result.status) || !result.observation) {
    throw new Error('MarketObservation repository returned an invalid insertIfAbsent result')
  }

  return result
}

export async function translateAndPersistRawMarketRecord(
  rawRecord,
  {
    repository,
    extractCandidate,
    knowledgeResolver,
    translationSchemaVersion,
    now,
  } = {},
) {
  const draft = await translateRawRecordToMarketObservation(rawRecord, {
    extractCandidate,
    knowledgeResolver,
    translationSchemaVersion,
    now,
  })

  return persistMarketObservationDraft(draft, { repository })
}

/**
 * Preferred cross-domain entry point for Phase #76.
 *
 * Callers provide only a raw-record id plus already-scoped repositories. The raw
 * evidence is loaded through Integration's scope-bound repository; an arbitrary
 * client-supplied raw envelope never becomes translation authority.
 */
export async function loadTranslateAndPersistRawMarketRecord(
  rawRecordId,
  {
    rawRepository,
    repository,
    extractCandidate,
    knowledgeResolver,
    translationSchemaVersion,
    now,
  } = {},
) {
  if (!rawRecordId) throw new Error('rawRecordId is required')
  requireRawRepository(rawRepository)

  const rawRecord = await rawRepository.findById(rawRecordId)
  if (!rawRecord) {
    return {
      status: 'NOT_FOUND',
      observation: null,
    }
  }

  return translateAndPersistRawMarketRecord(rawRecord, {
    repository,
    extractCandidate,
    knowledgeResolver,
    translationSchemaVersion,
    now,
  })
}
