import { z } from 'zod'

import { ownsBusiness, seesBusiness } from '@/modules/identity/viewer-authority'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { translateRawRecordToMarketObservation } from './translate-raw-record'

// Phase #76 application seam. Persistence is injected so the domain/application
// semantics are proven before binding to Prisma. Integration raw evidence remains
// read-only input; only Market-owned observation state is written here.
// @req FR-092, NFR-018
// @spec BR-019, SDD-049, SEC-017, ADR-038
// @tested tests/unit/market-intelligence/market-observation-service.test.js,
//   tests/unit/market-intelligence/market-observation-feed.test.js,
//   tests/integration/market-intelligence-observation-feed.test.js,
//   tests/unit/market-intelligence/market-translation-run.test.js,
//   tests/unit/market-intelligence/market-translations-route.test.js,
//   tests/integration/market-intelligence-translation-run.test.js,
//   tests/integration/domain-visibility-server.test.js
//
// The read side (`getMarketObservationFeed`) is what makes `/market` a surface over
// real state instead of a picture of one. It keeps this file's original property: the
// database and the persistence adapter are still *injected*, never imported here, so
// the composition root is the route handler and this module stays testable with a
// two-line fake. What it adds is the one thing a reader must not be able to skip —
// the viewer check (BR-001/SEC-001): a Business the viewer cannot see is refused
// before any query runs, and the tenant the repository is scoped to is read from the
// Business row rather than from anything the caller sent.

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

// --- Read side: the authorized MarketObservation feed ------------------------

export const MARKET_OBSERVATION_FEED_VERSION = '1.0'
export const MARKET_OBSERVATION_FEED_LIMIT = 50
export const MARKET_OBSERVATION_FEED_MAX_LIMIT = 200

const trimmedId = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() || undefined : value),
  z.string().min(1),
)

const optionalLimit = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  z.coerce.number().int().positive()
    .transform((value) => Math.min(value, MARKET_OBSERVATION_FEED_MAX_LIMIT))
    .optional(),
)

export const zMarketObservationFeedQuery = z.object({
  businessId: trimmedId,
  limit: optionalLimit,
}).strict()

export function parseMarketObservationFeedQuery(query = {}) {
  const parsed = zMarketObservationFeedQuery.parse(query)
  return { businessId: parsed.businessId, limit: parsed.limit ?? MARKET_OBSERVATION_FEED_LIMIT }
}

function denied(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function parseCandidate(candidateJson) {
  // The write path validated this string, so a failure here means the row was written
  // by something else. The feed degrades to "no candidate detail" for that one row
  // rather than failing the whole page.
  try {
    const candidate = JSON.parse(candidateJson)
    return candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : null
  } catch {
    return null
  }
}

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null)
const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/**
 * Normalize the provider-shaped candidate into the few fields a surface can render.
 *
 * The candidate is *external* payload — an extractor's reading of someone else's
 * listing — so nothing here assumes a field exists or carries the type its name
 * suggests. A missing title stays `null` and the surface says so; it never becomes an
 * invented string, which is the whole point of this read path.
 */
function presentCandidate(candidate) {
  if (!candidate) return { title: null, price: null, currency: null, seller: null, condition: null }
  return {
    title: text(candidate.title) ?? text(candidate.name) ?? text(candidate.productTitle),
    price: finite(candidate.unitPrice) ?? finite(candidate.price) ?? finite(candidate.rawPrice),
    currency: text(candidate.currency),
    seller: text(candidate.sellerName) ?? text(candidate.seller),
    condition: text(candidate.condition),
  }
}

function toFeedRow(observation) {
  const candidate = parseCandidate(observation.candidateJson)
  return {
    id: observation.id,
    provider: observation.provider,
    observationType: observation.observationType,
    sourceEntityType: observation.sourceEntityType,
    externalId: observation.externalId,
    sourceUri: observation.sourceUri ?? null,
    translationSchemaVersion: observation.translationSchemaVersion,
    resolutionStatus: observation.resolutionStatus,
    resolutionConfidence: observation.resolutionConfidence ?? null,
    canonicalProductRef: observation.canonicalProductRef ?? null,
    canonicalCategoryRef: observation.canonicalCategoryRef ?? null,
    observedAt: new Date(observation.observedAt).toISOString(),
    translatedAt: new Date(observation.translatedAt).toISOString(),
    ...presentCandidate(candidate),
    candidate,
  }
}

/**
 * The `/market` read contract: this viewer's translated market observations for one
 * Business, newest observation first.
 *
 * `businessId` is required rather than inferred. The question a reader must answer is
 * whether THIS viewer, working in THIS Business, may read — and a scope taken from the
 * rows being read is not a check (SEC-001). `seesBusiness` is the predicate, not
 * `ownsBusiness`: reading market evidence is not a write.
 *
 * The scope is exactly the repository's scope — this Tenant and this Business.
 * Tenant-shared observations (`businessId: null`) are deliberately not folded in:
 * unlike the CRM inbox, whose BR-001 rule makes conversations tenant-shared by design,
 * a MarketObservation inherits the Business of the Integration connection that produced
 * it, so widening the read would show a Business rows it does not own.
 *
 * @param {object} query   viewer + businessId + limit
 * @param {object} deps    db and repository factory, injected — this module imports neither
 */
export async function getMarketObservationFeed(
  { viewer, businessId, limit = MARKET_OBSERVATION_FEED_LIMIT } = {},
  { db, createRepository } = {},
) {
  if (!db?.business?.findUnique) throw new Error('a Prisma client with a Business model is required')
  if (typeof createRepository !== 'function') {
    throw new Error('a MarketObservation repository factory is required')
  }

  if (!seesBusiness(viewer, businessId)) throw denied(403, 'Business access denied')

  // @req FR-061 — Market Intelligence is a grantable domain, so seeing the Business is
  // not by itself permission to read its market evidence. Refused as 404 'Business not
  // found', identical to the unknown-Business branch three lines below, so the status
  // code cannot be read as confirmation that the Business exists (FR-072(a)).
  assertDomainVisible(viewer, businessId, 'market')

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { id: true, tenantId: true, name: true },
  })
  if (!business) throw denied(404, 'Business not found')

  const repository = createRepository(db, { tenantId: business.tenantId, businessId: business.id })
  if (typeof repository?.listRecent !== 'function') {
    throw new Error('MarketObservation repository must support listRecent')
  }

  const observations = (await repository.listRecent({ limit })).map(toFeedRow)

  const byResolutionStatus = {}
  const providers = new Set()
  for (const row of observations) {
    providers.add(row.provider)
    byResolutionStatus[row.resolutionStatus] = (byResolutionStatus[row.resolutionStatus] || 0) + 1
  }

  return {
    version: MARKET_OBSERVATION_FEED_VERSION,
    scope: { businessId: business.id, businessName: business.name, tenantId: business.tenantId },
    counts: {
      observations: observations.length,
      providers: providers.size,
      byResolutionStatus,
    },
    limit,
    truncated: observations.length === limit,
    observations,
  }
}

// --- Production translation trigger (`POST /api/market/translations`) -------

// Nothing before this point in the module's history ever *ran*
// `loadTranslateAndPersistRawMarketRecord`/`translateAndPersistRawMarketRecord` outside
// a test: the translation seam existed, but no route, job or worker called it, so a raw
// record ingested through FR-081 stayed untranslated forever unless a human ran code by
// hand. This is that trigger — an explicit, owner-initiated run over one Business's
// already-ingested `MARKET_INTELLIGENCE` backlog. It stays a *trigger*, not a scheduler
// or a new acquisition path: it reads raw evidence Integration already stored, and it
// still writes only through the same `translateAndPersistRawMarketRecord` this file has
// had since #76.

export const MARKET_TRANSLATION_RUN_DEFAULT_LIMIT = 20
export const MARKET_TRANSLATION_RUN_MAX_LIMIT = 100
// How much wider than the requested `limit` the candidate scan looks before filtering
// out already-translated raw records. Some of the scanned candidates will already have
// an observation (from an earlier run); the multiplier keeps this run's actual
// translation count close to what the caller asked for instead of silently returning
// fewer whenever the front of the backlog is already translated.
const MARKET_TRANSLATION_SCAN_MULTIPLIER = 5

export const zMarketTranslationRunInput = z.object({
  businessId: trimmedId,
  limit: optionalLimit,
}).strict()

export function parseMarketTranslationRunInput(body = {}) {
  const parsed = zMarketTranslationRunInput.parse(body)
  return {
    businessId: parsed.businessId,
    limit: Math.min(parsed.limit ?? MARKET_TRANSLATION_RUN_DEFAULT_LIMIT, MARKET_TRANSLATION_RUN_MAX_LIMIT),
  }
}

/**
 * Translate one Business's untranslated `MARKET_INTELLIGENCE` raw backlog.
 *
 * A translation run is a write — it persists `MarketObservation` rows — so this is
 * gated on `ownsBusiness`, not `seesBusiness` (BR-001/SEC-001), and an existing-but-
 * unowned Business is refused with the identical 404 a nonexistent one gets: a caller
 * cannot use the response to learn the Business exists (FR-072 disclosure discipline —
 * see tests/integration/fr072-refusal-disclosure.test.js).
 *
 * `extractCandidate` is required exactly as it is in `translateAndPersistRawMarketRecord`
 * — this function does not invent a default. `knowledgeResolver` stays optional and, per
 * the translator's own contract, an absent one is a truthful UNRESOLVED for every row
 * this run creates, never a thrown error and never a fabricated canonical identity
 * (fail-closed by construction; see `translate-raw-record.js` and its tests).
 *
 * @param {object} args    viewer + businessId + limit
 * @param {object} deps    db, repository factories and translation ports, injected —
 *   this module imports neither Prisma nor a concrete extractor/resolver, so the
 *   composition root (the route handler) stays the only place that decides which
 *   production ports are wired in.
 * @returns {Promise<{translated: number, unchanged: number, failed: {rawRecordId: string, reason: string}[]}>}
 */
export async function runMarketTranslationForBusiness(
  { viewer, businessId, limit = MARKET_TRANSLATION_RUN_DEFAULT_LIMIT } = {},
  {
    db,
    createRepository,
    listCandidates,
    extractCandidate,
    knowledgeResolver,
    translationSchemaVersion,
    now,
  } = {},
) {
  if (!db?.business?.findUnique) throw new Error('a Prisma client with a Business model is required')
  if (typeof createRepository !== 'function') {
    throw new Error('a MarketObservation repository factory is required')
  }
  if (typeof listCandidates !== 'function') {
    throw new Error('a raw-record candidate reader is required')
  }
  if (typeof extractCandidate !== 'function') {
    throw new Error('market extractCandidate port is required')
  }

  // Loaded before the ownership check so an existing-but-unowned Business and a
  // fabricated id answer with the exact same message — the same order
  // `assertBusinessWritable` (project-manager/application/project-authorization.js)
  // uses for the same reason.
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { id: true, tenantId: true },
  })
  if (!business) throw denied(404, 'Business not found')
  // FR-061/062 — the market domain gate runs before the ownership gate, so a
  // Membership never granted Market Intelligence learns nothing from the
  // ownership refusal; both are 404-shaped ('Business not found').
  assertDomainVisible(viewer, businessId, 'market')
  if (!ownsBusiness(viewer, businessId)) throw denied(404, 'Business not found')

  const repository = createRepository(db, { tenantId: business.tenantId, businessId: business.id })
  if (typeof repository?.findTranslatedRawRecordIds !== 'function') {
    throw new Error('MarketObservation repository must support findTranslatedRawRecordIds')
  }

  const scanLimit = Math.min(limit * MARKET_TRANSLATION_SCAN_MULTIPLIER, MARKET_TRANSLATION_RUN_MAX_LIMIT * MARKET_TRANSLATION_SCAN_MULTIPLIER)
  const candidates = await listCandidates(db, {
    tenantId: business.tenantId,
    businessId: business.id,
    scanLimit,
  })

  const translatedIds = new Set(
    candidates.length ? await repository.findTranslatedRawRecordIds(candidates.map((row) => row.id)) : [],
  )
  const eligible = candidates.filter((row) => !translatedIds.has(row.id)).slice(0, limit)

  let translated = 0
  let unchanged = 0
  const failed = []

  for (const rawRecord of eligible) {
    try {
      const result = await translateAndPersistRawMarketRecord(rawRecord, {
        repository,
        extractCandidate,
        knowledgeResolver,
        translationSchemaVersion,
        now,
      })
      if (result.status === 'CREATED') translated += 1
      else unchanged += 1
    } catch (error) {
      failed.push({ rawRecordId: rawRecord.id, reason: error?.message || 'Unknown error' })
    }
  }

  // One audit event per run, never per row — the counts are the record; raw candidate
  // payloads are never written to the audit log (SEC-003 minimal-disclosure spirit).
  await recordAudit(db, {
    entityType: 'MarketObservation',
    entityId: business.id,
    action: 'MARKET_TRANSLATION_RUN',
    payload: {
      businessId: business.id,
      candidates: candidates.length,
      eligible: eligible.length,
      translated,
      unchanged,
      failed: failed.length,
    },
  })

  return { translated, unchanged, failed }
}
