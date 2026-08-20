import { createPrismaRawRecordRepository } from '@/platform/integrations/core/raw-record-repository'

// Phase #76 security adapter: Integration supports legitimate tenant/connection-
// scoped repositories when Business is omitted. Market translation is stricter:
// Business scope must be an explicit string or explicit null so a caller cannot
// accidentally turn a missing Business argument into a broader read.
// @spec ADR-038

export function createMarketRawRecordRepository(db, scope) {
  if (!scope?.tenantId) throw new Error('Market raw repository tenantId is required')
  if (!scope?.connectionId) throw new Error('Market raw repository connectionId is required')
  if (scope.businessId === undefined) {
    throw new Error('Market raw repository businessId must be explicit (string or null)')
  }

  return createPrismaRawRecordRepository(db, scope)
}
