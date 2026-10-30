-- TASK-ZAI-012 — Agent mission draft/evidence schema for the authenticated PM intake slice.
-- Source migration only. Never apply as part of this PR; database apply remains a separate operator gate.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
-- TASK-ZAI-012 — immutable mission provenance; no execution/release authority.
CREATE TABLE IF NOT EXISTS public."AgentMissionDraft" (
  "id" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL DEFAULT 'agent-mission-draft.v1',
  "sourceAgentRef" TEXT,
  "missionId" TEXT,
  "revision" INTEGER NOT NULL,
  "tenantId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "workstreamId" TEXT NOT NULL,
  "actorPersonId" TEXT,
  "sourceTurnId" TEXT,
  "executionId" TEXT,
  "sourceEventId" TEXT,
  "sourceTraceEventId" TEXT,
  "digest" TEXT,
  "snapshotJson" TEXT NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "revokedAt" TIMESTAMP(3),
  "erasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "AgentMissionDraft_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentMissionDraft_actorPersonId_fkey"
    FOREIGN KEY ("actorPersonId") REFERENCES public."Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "AgentMissionDraft_source_revision_key"
  ON "AgentMissionDraft"("sourceAgentRef", "missionId", "revision");
CREATE INDEX IF NOT EXISTS "AgentMissionDraft_tenantId_businessId_status_createdAt_idx"
  ON "AgentMissionDraft"("tenantId", "businessId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentMissionDraft_sourceTurnId_status_idx"
  ON "AgentMissionDraft"("sourceTurnId", "status");
CREATE INDEX IF NOT EXISTS "AgentMissionDraft_actorPersonId_status_idx"
  ON "AgentMissionDraft"("actorPersonId", "status");

CREATE TABLE IF NOT EXISTS public."AgentMissionEvidence" (
  "id" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL DEFAULT 'agent-mission-evidence.v1',
  "draftId" TEXT NOT NULL,
  "sourceAgentRef" TEXT,
  "missionId" TEXT,
  "tenantId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "workstreamId" TEXT NOT NULL,
  "workItemId" TEXT NOT NULL,
  "workItemVersion" INTEGER NOT NULL,
  "origin" TEXT NOT NULL,
  "actorId" TEXT,
  "submittedByPersonId" TEXT,
  "submittedAt" TIMESTAMP(3),
  "confirmationKind" TEXT NOT NULL DEFAULT 'LINE_JOB',
  "sourceTurnId" TEXT,
  "executionId" TEXT,
  "sourceEventId" TEXT,
  "sourceTraceEventId" TEXT,
  "sourceRevision" INTEGER NOT NULL DEFAULT 1,
  "sourceDigest" TEXT,
  "missionSnapshotJson" TEXT NOT NULL DEFAULT '{}',
  "missionSnapshotDigest" TEXT,
  "idempotencyKey" TEXT,
  "confirmationJobId" TEXT,
  "confirmationInboundMessageId" TEXT,
  "confirmationActorId" TEXT,
  "confirmationIdentityVersion" INTEGER,
  "channelIdentityId" TEXT,
  "channelIdentityLinkedAt" TIMESTAMP(3),
  "confirmationExecutionId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "revokedAt" TIMESTAMP(3),
  "revokedByPersonId" TEXT,
  "erasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "AgentMissionEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentMissionEvidence_draftId_fkey"
    FOREIGN KEY ("draftId") REFERENCES public."AgentMissionDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentMissionEvidence_submittedByPersonId_fkey"
    FOREIGN KEY ("submittedByPersonId") REFERENCES public."Person"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AgentMissionEvidence_workItemId_fkey"
    FOREIGN KEY ("workItemId") REFERENCES public."WorkItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AgentMissionEvidence_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES public."Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AgentMissionEvidence_confirmationActorId_fkey"
    FOREIGN KEY ("confirmationActorId") REFERENCES public."Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "AgentMissionEvidence_revokedByPersonId_fkey"
    FOREIGN KEY ("revokedByPersonId") REFERENCES public."Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentMissionEvidence_scope_turn_origin_key"
  ON "AgentMissionEvidence"("tenantId", "businessId", "sourceTurnId", "origin");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentMissionEvidence_scope_idempotency_key"
  ON "AgentMissionEvidence"("tenantId", "businessId", "idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentMissionEvidence_workItemId_key"
  ON "AgentMissionEvidence"("workItemId");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentMissionEvidence_draftId_key"
  ON "AgentMissionEvidence"("draftId");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentMissionEvidence_source_mission_key"
  ON "AgentMissionEvidence"("sourceAgentRef", "missionId");
CREATE INDEX IF NOT EXISTS "AgentMissionEvidence_tenantId_businessId_status_createdAt_idx"
  ON "AgentMissionEvidence"("tenantId", "businessId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentMissionEvidence_tenantId_businessId_projectId_workstreamId_status_idx"
  ON "AgentMissionEvidence"("tenantId", "businessId", "projectId", "workstreamId", "status");
CREATE INDEX IF NOT EXISTS "AgentMissionEvidence_actorId_status_idx"
  ON "AgentMissionEvidence"("actorId", "status");

-- A verified Agent turn may create only one immutable mission draft in its
-- tenant/Business scope. The producer requires all source-key columns non-null;
-- the schema keeps them nullable for tombstone/erasure and unresolved restores.
CREATE UNIQUE INDEX IF NOT EXISTS "AgentMissionDraft_scope_source_turn_execution_key"
  ON "AgentMissionDraft"("tenantId", "businessId", "sourceAgentRef", "sourceTurnId", "executionId");

ALTER TABLE public."AgentMissionDraft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AgentMissionDraft" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."AgentMissionEvidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AgentMissionEvidence" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'AgentMissionDraft' AND policyname = 'zuri_app_runtime_all') THEN
    EXECUTE 'CREATE POLICY zuri_app_runtime_all ON public."AgentMissionDraft" FOR ALL TO zuri_app_runtime USING (true) WITH CHECK (true)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'AgentMissionEvidence' AND policyname = 'zuri_app_runtime_all') THEN
    EXECUTE 'CREATE POLICY zuri_app_runtime_all ON public."AgentMissionEvidence" FOR ALL TO zuri_app_runtime USING (true) WITH CHECK (true)';
  END IF;
END $$;

REVOKE ALL ON TABLE public."AgentMissionDraft", public."AgentMissionEvidence" FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."AgentMissionDraft", public."AgentMissionEvidence" TO zuri_app_runtime;

COMMIT;
