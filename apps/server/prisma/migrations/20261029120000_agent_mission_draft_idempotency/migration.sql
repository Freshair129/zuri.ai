-- A verified Agent turn may create only one immutable mission draft in its
-- tenant/Business scope. The producer requires all source-key columns non-null;
-- the schema keeps them nullable for tombstone/erasure and unresolved restores.
CREATE UNIQUE INDEX "AgentMissionDraft_scope_source_turn_execution_key"
  ON "AgentMissionDraft"("tenantId", "businessId", "sourceAgentRef", "sourceTurnId", "executionId");
