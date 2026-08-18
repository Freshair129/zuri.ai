-- FR-079 / ADR-031 §D2 — database invariant for the automatic Phase 1 selector.
-- Apply after 0001_init.sql. The predicate deliberately matches only the
-- binding-scoped production selection contract; drafts and secondary rows remain
-- available for staged rotation.
CREATE UNIQUE INDEX IF NOT EXISTS "IntegrationConnection_phase1_active_primary_key"
  ON "IntegrationConnection" ("tenantId", "businessId", "purpose")
  WHERE "businessId" IS NOT NULL
    AND "purpose" = 'PHASE1_LINE_LLM'
    AND "status" = 'ACTIVE'
    AND "role" = 'PRIMARY';
