// @req FR-081 — raw records are read and written only through a repository bound
// to one tenant/connection scope; a row outside that scope is refused rather than
// filtered after the fact.
// @req FR-109 — AC-109.3: `findByArtifactId` resolves a knowledge-ingestion run's
// `artifact_id` back to the raw record FR-081 already stored, inside the same
// tenant/connection scope every other read here enforces.
// @spec SEC-001 — cross-tenant/business guard applied at the persistence boundary.
// @spec docs/domains/integration/features/FR-081-raw-external-ingestion.md
// @tested tests/integration/platform/integration-persistence.test.js
// @tested tests/unit/platform/raw-record-repository-read.test.js

function assertScope(scope) {
  if (!scope?.tenantId || !scope?.connectionId) {
    throw new Error('raw record repository requires tenantId and connectionId scope')
  }
}

function scopeWhere(scope) {
  return {
    tenantId: scope.tenantId,
    connectionId: scope.connectionId,
    ...(scope.businessId !== undefined ? { businessId: scope.businessId } : {}),
    ...(scope.ingestionRunId ? { ingestionRunId: scope.ingestionRunId } : {}),
    ...(scope.provider ? { provider: scope.provider } : {}),
  }
}

function assertRowScope(row, scope) {
  if (row.tenantId !== scope.tenantId || row.connectionId !== scope.connectionId) {
    throw new Error('raw record is outside repository tenant or connection scope')
  }
  if (scope.businessId !== undefined && (row.businessId ?? null) !== scope.businessId) {
    throw new Error('raw record is outside repository business scope')
  }
  if (scope.ingestionRunId && row.ingestionRunId !== scope.ingestionRunId) {
    throw new Error('raw record is outside repository ingestion run scope')
  }
  if (scope.provider && row.provider !== scope.provider) {
    throw new Error('raw record is outside repository provider scope')
  }
}

export function createPrismaRawRecordRepository(db, scope) {
  assertScope(scope)

  return {
    findById(rawRecordId) {
      if (!rawRecordId) throw new Error('rawRecordId is required')
      return db.rawExternalRecord.findFirst({
        where: {
          id: rawRecordId,
          ...scopeWhere(scope),
        },
      })
    },

    findByIdempotencyKey(idempotencyKey) {
      return db.rawExternalRecord.findFirst({
        where: {
          idempotencyKey,
          ...scopeWhere(scope),
        },
      })
    },

    findByArtifactId(artifactId) {
      if (!artifactId) throw new Error('artifactId is required')
      return db.rawExternalRecord.findFirst({
        where: {
          artifactId,
          ...scopeWhere(scope),
        },
      })
    },

    async insert(row) {
      assertRowScope(row, scope)

      if (row.businessId) {
        const business = await db.business.findUnique({ where: { id: row.businessId } })
        if (!business || business.tenantId !== scope.tenantId) {
          throw new Error('raw record business is outside tenant scope')
        }
      }

      if (row.ingestionRunId) {
        const run = await db.ingestionRun.findUnique({ where: { id: row.ingestionRunId } })
        if (
          !run ||
          run.tenantId !== scope.tenantId ||
          run.connectionId !== scope.connectionId ||
          (scope.businessId !== undefined && (run.businessId ?? null) !== scope.businessId)
        ) {
          throw new Error('raw record ingestion run is outside repository scope')
        }
      }

      return db.rawExternalRecord.create({ data: row })
    },
  }
}
