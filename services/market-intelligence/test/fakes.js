// Conformant in-memory providers for the M1 port contracts. They implement the
// semantics documented in src/ports/contracts.js so core tests exercise the real
// contract, not a looser one. They are test doubles, not provider proof.

export const TENANT_T = 'tenant-t'
export const TENANT_U = 'tenant-u'
export const BUSINESS_A = 'business-a'
export const BUSINESS_B = 'business-b'
export const BUSINESS_U = 'business-u'

export const BUSINESSES = {
  [BUSINESS_A]: { id: BUSINESS_A, tenantId: TENANT_T, name: 'A' },
  [BUSINESS_B]: { id: BUSINESS_B, tenantId: TENANT_T, name: 'B' },
  [BUSINESS_U]: { id: BUSINESS_U, tenantId: TENANT_U, name: 'U' },
}

/**
 * actor: { sees: [businessId], owns: [businessId], marketHidden: [businessId] }
 * The actor object stands in for an authoritative, server-resolved viewer. The
 * provider looks the Business up itself, so the tenant comes from the row.
 */
export function createScopeAuthority({ businesses = BUSINESSES } = {}) {
  const calls = []
  return {
    calls,
    async authorize({ actor, businessId, action }) {
      calls.push({ actor, businessId, action })
      const business = businesses[businessId]
      const sees = actor?.sees?.includes(businessId)
      const hidden = actor?.marketHidden?.includes(businessId)
      if (action === 'market.feed.read') {
        if (!sees) return { allowed: false, status: 403, message: 'Business access denied' }
        if (hidden || !business) return { allowed: false, status: 404, message: 'Business not found' }
      } else if (action === 'market.translation.run') {
        const owns = actor?.owns?.includes(businessId)
        if (!business || hidden || !owns) return { allowed: false, status: 404, message: 'Business not found' }
      } else {
        return { allowed: false, status: 404, message: 'Business not found' }
      }
      return { allowed: true, scope: { tenantId: business.tenantId, businessId: business.id, businessName: business.name } }
    },
  }
}

/** One table shared by every scope, like the real database. */
export function createObservationTable() {
  const rows = new Map()
  let sequence = 0
  function open(scope) {
    return {
      scope,
      async insertIfAbsent(draft) {
        if (draft.tenantId !== scope.tenantId || (draft.businessId ?? null) !== scope.businessId) {
          throw new Error('MarketObservation business scope mismatch')
        }
        const existing = rows.get(draft.lineageKey)
        if (existing) {
          if (existing.tenantId !== scope.tenantId || existing.businessId !== scope.businessId) {
            throw new Error('MarketObservation lineage identity resolved outside repository scope')
          }
          return { status: 'UNCHANGED', observation: existing }
        }
        sequence += 1
        const observation = { id: `obs-${sequence}`, createdAt: new Date(sequence), ...draft }
        rows.set(draft.lineageKey, observation)
        return { status: 'CREATED', observation }
      },
      async listRecent({ limit }) {
        return [...rows.values()]
          .filter((row) => row.tenantId === scope.tenantId && row.businessId === scope.businessId)
          .sort((a, b) => b.observedAt - a.observedAt || b.createdAt - a.createdAt)
          .slice(0, Math.min(limit, 200))
      },
      async findTranslatedRawRecordIds(ids) {
        return [...rows.values()]
          .filter((row) => row.tenantId === scope.tenantId && row.businessId === scope.businessId && ids.includes(row.rawRecordId))
          .map((row) => row.rawRecordId)
      },
    }
  }
  return { rows, open: async (scope) => open(scope) }
}

export function rawRecord(overrides = {}) {
  const id = overrides.id ?? 'raw-1'
  return {
    id,
    tenantId: TENANT_T,
    businessId: BUSINESS_A,
    connectionId: 'conn-a',
    provider: 'MARKET_TEST',
    lane: 'MARKET_INTELLIGENCE',
    entityType: 'listing',
    externalId: `ext-${id}`,
    sourceType: 'PULL',
    sourceUri: `https://example.invalid/${id}`,
    schemaVersion: 'market.test.v1',
    payloadJson: JSON.stringify({ title: `Item ${id}`, price: 100 }),
    payloadHash: 'a'.repeat(64),
    receivedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  }
}

export function createRawEvidence(records = []) {
  const calls = []
  return {
    calls,
    async listMarketCandidates(query) {
      calls.push(query)
      return records
        .filter((row) => row.tenantId === query.tenantId && row.businessId === query.businessId)
        .slice(0, query.scanLimit)
    },
  }
}

export function createAudit({ fail = false } = {}) {
  const events = []
  return {
    events,
    async record(event) {
      if (fail) throw new Error('audit unavailable')
      events.push(event)
    },
  }
}
