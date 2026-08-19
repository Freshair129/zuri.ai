import { translateRawRecordToMarketObservation } from './translate-raw-record'

// Phase #76 application seam. Persistence is injected so the domain/application
// semantics are proven before binding to Prisma. Integration raw evidence remains
// read-only input; only Market-owned observation state is written here.
// @spec ADR-038

function requireRepository(repository) {
  if (
    !repository ||
    typeof repository.findByLineageKey !== 'function' ||
    typeof repository.insert !== 'function'
  ) {
    throw new Error('MarketObservation repository with findByLineageKey/insert is required')
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

  const existing = await repository.findByLineageKey(draft.lineageKey)
  if (existing) {
    return {
      status: 'UNCHANGED',
      observation: existing,
    }
  }

  const observation = await repository.insert(draft)
  return {
    status: 'CREATED',
    observation,
  }
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
