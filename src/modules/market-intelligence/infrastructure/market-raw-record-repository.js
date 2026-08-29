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
