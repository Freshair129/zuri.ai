// @req FR-230 — durable memory admission fence survives a lost lock connection.
// @spec SEC-031, ADR-091 — pending maintenance blocks MSP access, not CRM ingress.
// @tested tests/integration/msp-retention-fence.test.js, tests/unit/msp-retention.test.js
export function createMspRetentionGate(db, { excludeRunId = '' } = {}) {
  return async ({ tenantId }) => {
    if (typeof tenantId !== 'string' || !tenantId) throw new Error('MSP_RETENTION_GATE_SCOPE_REQUIRED')
    let outstanding
    try {
      outstanding = await db.$queryRaw`
        SELECT s."id" FROM "AuditEvent" s
        WHERE s."tenantId" = ${tenantId} AND s."entityType" = 'MSP_RETENTION'
          AND s."entityId" <> ${excludeRunId}
          AND s."action" = 'MSP_RETENTION_STARTED'
          AND NOT EXISTS (
            SELECT 1 FROM "AuditEvent" e
            WHERE e."tenantId" = s."tenantId" AND e."entityId" = s."entityId"
              AND e."entityType" = 'MSP_RETENTION'
              AND e."action" IN ('MSP_RETENTION_COMPLETE', 'MSP_RETENTION_DRY_RUN',
                'MSP_RETENTION_DEFERRED', 'MSP_RETENTION_PARTIAL', 'MSP_RETENTION_UNKNOWN',
                'MSP_RETENTION_FAILED', 'MSP_RETENTION_RECONCILED')
          ) LIMIT 1`
    } catch { throw new Error('MSP_RETENTION_GATE_UNAVAILABLE') }
    if (!Array.isArray(outstanding)) throw new Error('MSP_RETENTION_GATE_UNAVAILABLE')
    if (outstanding.length) throw new Error('MSP_RETENTION_IN_PROGRESS')
  }
}
