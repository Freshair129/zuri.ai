// The write boundary for Market-owned observation state, and the only place that
// creates one. A scoped draft in, a {status, observation} verdict out; this adapter
// writes `MarketObservation` and nothing else — Integration's raw evidence is never
// touched from here. The atomicity claim is real and rests on the `lineageKey`
// column being `@unique` in both schemas: a create-if-absent expressed as
// read-then-create would let two workers both observe "missing" and race, so the
// unique constraint is the serialization point and a P2002 collision is resolved to
// the row the winner wrote (CREATED for the first, UNCHANGED on replay). Scope fails
// closed at both ends — the draft must match the tenant/Business the repository was
// constructed with, businessId must be an explicit string or explicit null rather
// than an omitted argument, and even the row loaded after a collision is re-checked,
// because a lineage key that resolves outside this scope is an identity leak, not a
// replay.
// @req FR-092, NFR-018
// @spec SDD-049, SEC-017, ADR-038
// @tested tests/unit/market-intelligence/market-observation-repository.test.js
//
// The read side added for the `/market` surface obeys the same scope rule and is
// deliberately narrow: `listRecent` is a newest-first page of the rows this repository
// was constructed to own, nothing more. It re-checks every row it is about to return
// rather than trusting the `where` clause alone — the same reason the write path
// re-checks the row it loads after a unique collision.

function assertPrismaModel(prisma) {
  if (!prisma?.marketObservation) {
    throw new Error('Prisma MarketObservation model is not available')
  }
  if (
    typeof prisma.marketObservation.create !== 'function' ||
    typeof prisma.marketObservation.findUnique !== 'function'
  ) {
    throw new Error('Prisma MarketObservation model must support create/findUnique')
  }
}

function assertScope(scope) {
  if (!scope?.tenantId) throw new Error('MarketObservation repository tenantId is required')
  if (scope.businessId === undefined) {
    throw new Error('MarketObservation repository businessId must be explicit (string or null)')
  }
}

function assertDraftScope(draft, scopeWhere) {
  if (!draft || typeof draft !== 'object') {
    throw new Error('MarketObservation draft is required')
  }
  if (draft.tenantId !== scopeWhere.tenantId) {
    throw new Error('MarketObservation tenant scope mismatch')
  }
  if ((draft.businessId ?? null) !== scopeWhere.businessId) {
    throw new Error('MarketObservation business scope mismatch')
  }
  if (!draft.lineageKey) {
    throw new Error('MarketObservation lineageKey is required')
  }
}

function isUniqueConflict(error) {
  return error?.code === 'P2002'
}

function assertObservationScope(observation, scopeWhere) {
  if (
    !observation ||
    observation.tenantId !== scopeWhere.tenantId ||
    (observation.businessId ?? null) !== scopeWhere.businessId
  ) {
    throw new Error('MarketObservation lineage identity resolved outside repository scope')
  }
}

export const MARKET_OBSERVATION_PAGE_LIMIT = 200

function normalizeLimit(limit) {
  const value = Number(limit)
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('MarketObservation listRecent limit must be a positive integer')
  }
  return Math.min(value, MARKET_OBSERVATION_PAGE_LIMIT)
}

export function createMarketObservationRepository(prisma, scope) {
  assertPrismaModel(prisma)
  assertScope(scope)

  const scopeWhere = {
    tenantId: scope.tenantId,
    businessId: scope.businessId ?? null,
  }

  return Object.freeze({
    /**
     * Newest observations first, inside this repository's scope only.
     *
     * `observedAt` is the ordering the surface means — when the market was seen, not
     * when the row happened to be written — with `createdAt` breaking ties so a page
     * is stable across two requests. The `take` is bounded here as well as at the
     * query boundary: a caller that forgets to cap cannot ask this adapter for the
     * whole table.
     */
    async listRecent({ limit = MARKET_OBSERVATION_PAGE_LIMIT } = {}) {
      if (typeof prisma.marketObservation.findMany !== 'function') {
        throw new Error('Prisma MarketObservation model must support findMany')
      }

      const rows = await prisma.marketObservation.findMany({
        where: { ...scopeWhere },
        orderBy: [{ observedAt: 'desc' }, { createdAt: 'desc' }],
        take: normalizeLimit(limit),
      })

      for (const row of rows) assertObservationScope(row, scopeWhere)
      return rows
    },

    async insertIfAbsent(draft) {
      assertDraftScope(draft, scopeWhere)

      try {
        const observation = await prisma.marketObservation.create({ data: draft })
        assertObservationScope(observation, scopeWhere)
        return { status: 'CREATED', observation }
      } catch (error) {
        if (!isUniqueConflict(error)) throw error

        // The unique lineage constraint is the concurrency boundary. If another
        // worker won the create race, load that one row and return UNCHANGED.
        const observation = await prisma.marketObservation.findUnique({
          where: { lineageKey: draft.lineageKey },
        })
        assertObservationScope(observation, scopeWhere)
        return { status: 'UNCHANGED', observation }
      }
    },
  })
}
