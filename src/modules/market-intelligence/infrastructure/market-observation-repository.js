// Phase #76 persistence adapter boundary. The Prisma model itself is not added in
// this contract-first commit; this adapter is deliberately injected and fails
// clearly until `prisma.marketObservation` exists.
// @spec ADR-038

function assertPrismaModel(prisma) {
  if (!prisma?.marketObservation) {
    throw new Error('Prisma MarketObservation model is not available')
  }
}

function assertScope(scope) {
  if (!scope?.tenantId) throw new Error('MarketObservation repository tenantId is required')
  if (scope.businessId === undefined) {
    throw new Error('MarketObservation repository businessId must be explicit (string or null)')
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
    async findByLineageKey(lineageKey) {
      if (!lineageKey) throw new Error('lineageKey is required')

      return prisma.marketObservation.findFirst({
        where: {
          ...scopeWhere,
          lineageKey,
        },
      })
    },

    async insert(draft) {
      if (!draft || typeof draft !== 'object') {
        throw new Error('MarketObservation draft is required')
      }
      if (draft.tenantId !== scopeWhere.tenantId) {
        throw new Error('MarketObservation tenant scope mismatch')
      }
      if ((draft.businessId ?? null) !== scopeWhere.businessId) {
        throw new Error('MarketObservation business scope mismatch')
      }

      return prisma.marketObservation.create({
        data: draft,
      })
    },
  })
}
