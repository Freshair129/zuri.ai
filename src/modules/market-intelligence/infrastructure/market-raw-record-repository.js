import { createPrismaRawRecordRepository } from '@/platform/integrations/core/raw-record-repository'

// Market's read-only door onto Integration-owned raw evidence. A trusted scope in, a
// scope-bound Integration read port out; this file writes nothing and owns nothing —
// `RawExternalRecord` stays Integration's model and its immutable provenance
// authority, so Market derives observations from it and never rewrites or re-owns it.
// The one thing this adapter adds is a narrower scope contract than Integration's
// own. Integration legitimately supports tenant/connection-scoped repositories with
// Business omitted; Market translation is stricter and requires Business to be an
// explicit string or an explicit null, because the difference between "this record
// belongs to no Business" and "the caller forgot to pass one" is the difference
// between a correct read and a silently broader one. Failing on `undefined` keeps
// that mistake from being spelled as a wider query.
// @req FR-092
// @spec BR-019, SDD-049, SEC-017, ADR-038
// @tested tests/unit/market-intelligence/market-raw-record-repository.test.js

export function createMarketRawRecordRepository(db, scope) {
  if (!scope?.tenantId) throw new Error('Market raw repository tenantId is required')
  if (!scope?.connectionId) throw new Error('Market raw repository connectionId is required')
  if (scope.businessId === undefined) {
    throw new Error('Market raw repository businessId must be explicit (string or null)')
  }

  return createPrismaRawRecordRepository(db, scope)
}

// The `MARKET_INTELLIGENCE` acquisition lane — see `DATA_LANES` in
// `@/platform/integrations/core/contracts` for the full registered set.
const MARKET_INTELLIGENCE_LANE = 'MARKET_INTELLIGENCE'

// One caller-tunable scan window, not an unbounded table read. The production
// translation trigger (FR-092) asks for a page of *candidates* and then narrows it
// against already-translated ids; both steps stay bounded so a Business with a large
// raw backlog cannot turn one click into an unbounded query.
export const MARKET_RAW_RECORD_CANDIDATE_SCAN_LIMIT = 500

/**
 * List `RawExternalRecord` rows in the `MARKET_INTELLIGENCE` lane for one Business,
 * across every Integration connection that Business has — oldest received first, so a
 * backlog drains in order.
 *
 * Deliberately *not* `createMarketRawRecordRepository`: that factory is scoped to one
 * connection because its callers (`loadTranslateAndPersistRawMarketRecord`) already
 * know which connection produced the record they want. The FR-092 translation trigger
 * does not — it is asked to translate a Business's backlog regardless of which
 * connection produced it — so this reads directly by tenant + Business instead of
 * requiring a connection id the caller does not have. It is still read-only and still
 * Integration's table: nothing here writes or reinterprets a raw row.
 *
 * This list is a *candidate* set, not a decision — the caller still narrows it against
 * `MarketObservation` (see `findTranslatedRawRecordIds`) before treating anything as
 * eligible for translation.
 */
export async function listMarketLaneRawRecordCandidates(db, { tenantId, businessId, scanLimit } = {}) {
  if (!tenantId) throw new Error('Market raw candidate read tenantId is required')
  if (!businessId) throw new Error('Market raw candidate read businessId is required')
  if (!db?.rawExternalRecord?.findMany) {
    throw new Error('Prisma RawExternalRecord model is required')
  }

  const requested = Number(scanLimit)
  const take = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), MARKET_RAW_RECORD_CANDIDATE_SCAN_LIMIT)
    : MARKET_RAW_RECORD_CANDIDATE_SCAN_LIMIT

  return db.rawExternalRecord.findMany({
    where: { tenantId, businessId, lane: MARKET_INTELLIGENCE_LANE },
    orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
    take,
  })
}
