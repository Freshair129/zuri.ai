// Phase #76 persistence adapter boundary. The Prisma model itself is not added in
// this contract-first commit; this adapter is deliberately injected and fails
// clearly until `prisma.marketObservation` exists.
// @spec ADR-038

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

export function createMarketObservationRepository(prisma, scope) {
  assertPrismaModel(prisma)
  assertScope(scope)

  const scopeWhere = {
    tenantId: scope.tenantId,
    businessId: scope.businessId ?? null,
  }

  return Object.freeze({
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
