// Phase #76 persistence adapter boundary. The Prisma model itself is not added in
// this contract-first commit; this adapter is deliberately injected and fails
// clearly until `prisma.marketObservation` exists.
// @spec ADR-038

function assertPrismaModel(prisma) {
  if (!prisma?.marketObservation) {
    throw new Error('Prisma MarketObservation model is not available')
  }
  if (typeof prisma.marketObservation.upsert !== 'function') {
    throw new Error('Prisma MarketObservation model must support atomic upsert')
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

      // `lineageKey` is a deterministic globally unique identity derived from the
      // internal raw-record id + payload hash + translation schema + observation
      // type. Prisma's unique constraint serializes concurrent replays here.
      // We intentionally perform no update on replay.
      const observation = await prisma.marketObservation.upsert({
        where: { lineageKey: draft.lineageKey },
        update: {},
        create: draft,
      })

      // A cryptographic collision or incorrectly shared lineage key must not become
      // a cross-scope read. Even after the atomic upsert, verify the returned row is
      // inside the repository's trusted scope.
      if (
        observation.tenantId !== scopeWhere.tenantId ||
        (observation.businessId ?? null) !== scopeWhere.businessId
      ) {
        throw new Error('MarketObservation lineage identity resolved outside repository scope')
      }

      const created = observation.createdAt && observation.updatedAt
        ? new Date(observation.createdAt).getTime() === new Date(observation.updatedAt).getTime()
        : false

      return {
        // A future Prisma-backed adapter may use a transaction/create-on-conflict
        // implementation to report this perfectly. Until the model lands, the port
        // contract treats an upserted row with equal timestamps as newly created.
        status: created ? 'CREATED' : 'UNCHANGED',
        observation,
      }
    },
  })
}
