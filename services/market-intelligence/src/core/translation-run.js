import { z } from 'zod'

import {
  MARKET_ACTIONS,
  assertAuditPort,
  assertObservationStore,
  assertObservationStoreFactory,
  assertRawEvidenceReadPort,
  assertScopeAuthorityPort,
  authorizeScope,
} from '../ports/contracts.js'
import { optionalLimit, trimmedId } from './observation-feed.js'
import {
  deriveMarketObservationLineageKey,
  translateRawRecordToMarketObservation,
} from './translate-raw-record.js'

// The owner-initiated translation run over one Business's already-ingested
// MARKET_INTELLIGENCE backlog, ported from apps/server's
// runMarketTranslationForBusiness. The same default and maximum batch sizes, the same
// bounded candidate scan, the same per-record partial-failure semantics and the same
// one-audit-event-per-run rule are kept. It stays a trigger, not a scheduler or an
// acquisition path.
//
// One deliberate tightening: every raw candidate is re-checked against the authorized
// scope before it reaches the translator. The legacy code trusted the query's `where`
// clause; a RawEvidenceReadPort across a process boundary is a place a confused-deputy
// bug could hand back another Business's evidence, so a mismatching row is refused per
// record (RAW_EVIDENCE_SCOPE_MISMATCH) instead of being translated.
// @req FR-092, NFR-018
// @spec BR-001, BR-019, SEC-001, SEC-017, SDD-049, ADR-038
// @tested services/market-intelligence/test/translation-run.test.js

export const MARKET_TRANSLATION_RUN_DEFAULT_LIMIT = 20
export const MARKET_TRANSLATION_RUN_MAX_LIMIT = 100
const MARKET_TRANSLATION_SCAN_MULTIPLIER = 5
const MARKET_INTELLIGENCE_LANE = 'MARKET_INTELLIGENCE'

export const zMarketTranslationRunInput = z.object({
  businessId: trimmedId,
  limit: optionalLimit(Number.MAX_SAFE_INTEGER),
}).strict()

export function parseMarketTranslationRunInput(body = {}) {
  const parsed = zMarketTranslationRunInput.parse(body)
  return {
    businessId: parsed.businessId,
    limit: Math.min(parsed.limit ?? MARKET_TRANSLATION_RUN_DEFAULT_LIMIT, MARKET_TRANSLATION_RUN_MAX_LIMIT),
  }
}

function scopeMismatch(rawRecord, scope) {
  if (rawRecord?.tenantId !== scope.tenantId) return true
  if ((rawRecord?.businessId ?? null) !== scope.businessId) return true
  return rawRecord?.lane !== undefined && rawRecord.lane !== MARKET_INTELLIGENCE_LANE
}

/**
 * @returns {Promise<{translated: number, unchanged: number, failed: {rawRecordId: string, reason: string}[]}>}
 */
export async function runMarketTranslationForBusiness(
  { actor, businessId, limit = MARKET_TRANSLATION_RUN_DEFAULT_LIMIT } = {},
  {
    scopeAuthority,
    rawEvidence,
    openObservationStore,
    audit,
    extractCandidate,
    knowledgeResolver,
    translationSchemaVersion,
    now,
  } = {},
) {
  assertScopeAuthorityPort(scopeAuthority)
  assertRawEvidenceReadPort(rawEvidence)
  assertObservationStoreFactory(openObservationStore)
  assertAuditPort(audit)
  if (typeof extractCandidate !== 'function') {
    throw new TypeError('market extractCandidate port is required')
  }

  const scope = await authorizeScope(scopeAuthority, {
    actor,
    businessId,
    action: MARKET_ACTIONS.TRANSLATION_RUN,
  })
  const store = assertObservationStore(
    await openObservationStore({ tenantId: scope.tenantId, businessId: scope.businessId }),
    ['insertIfAbsent', 'findExistingLineageKeys'],
  )

  const scanLimit = Math.min(
    limit * MARKET_TRANSLATION_SCAN_MULTIPLIER,
    MARKET_TRANSLATION_RUN_MAX_LIMIT * MARKET_TRANSLATION_SCAN_MULTIPLIER,
  )
  const candidates = await rawEvidence.listMarketCandidates({
    tenantId: scope.tenantId,
    businessId: scope.businessId,
    scanLimit,
  })
  if (!Array.isArray(candidates)) throw new Error('RawEvidenceReadPort must return an array')

  // Handoff finding 2: skip a candidate only when its lineage key for THIS
  // translationSchemaVersion already exists. The legacy filter matched rawRecordId,
  // which silently skipped re-translation after a version bump. A candidate whose key
  // cannot be derived (bad payload, extractor refusal) stays eligible so the loop
  // reports it as a per-record failure, exactly as before.
  const keyed = await Promise.all(candidates.map(async (row) => {
    try {
      return { row, key: await deriveMarketObservationLineageKey(row, { extractCandidate, translationSchemaVersion }) }
    } catch {
      return { row, key: null }
    }
  }))
  const keys = keyed.map((entry) => entry.key).filter(Boolean)
  const existing = new Set(keys.length ? await store.findExistingLineageKeys(keys) : [])
  const eligible = keyed.filter((entry) => !entry.key || !existing.has(entry.key)).map((entry) => entry.row).slice(0, limit)

  let translated = 0
  let unchanged = 0
  const failed = []

  for (const rawRecord of eligible) {
    if (scopeMismatch(rawRecord, scope)) {
      failed.push({ rawRecordId: rawRecord?.id ?? null, reason: 'RAW_EVIDENCE_SCOPE_MISMATCH' })
      continue
    }
    try {
      const draft = await translateRawRecordToMarketObservation(rawRecord, {
        extractCandidate,
        knowledgeResolver,
        translationSchemaVersion,
        now,
      })
      const result = await store.insertIfAbsent(draft)
      if (!result || !['CREATED', 'UNCHANGED'].includes(result.status) || !result.observation) {
        throw new Error('MarketObservation repository returned an invalid insertIfAbsent result')
      }
      if (result.status === 'CREATED') translated += 1
      else unchanged += 1
    } catch (error) {
      failed.push({ rawRecordId: rawRecord.id, reason: error?.message || 'Unknown error' })
    }
  }

  // Counts only; raw payloads and candidates never reach the audit log.
  await audit.record({
    entityType: 'MARKET_OBSERVATION',
    entityId: scope.businessId,
    action: 'MARKET_TRANSLATION_RUN',
    payload: {
      businessId: scope.businessId,
      candidates: candidates.length,
      eligible: eligible.length,
      translated,
      unchanged,
      failed: failed.length,
    },
  })

  return { translated, unchanged, failed }
}
