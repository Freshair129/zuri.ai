-- TASK-ZAI-012 — preserve immutable mission provenance separately from WorkItem state.
-- Identity erasure tombstones the row and clears its person/turn/source digests.
CREATE TABLE "AgentMissionDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "revokedAt" DATETIME,
    "erasedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "AgentMissionDraft_actorPersonId_fkey"
      FOREIGN KEY ("actorPersonId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AgentMissionDraft_source_revision_key"
  ON "AgentMissionDraft"("sourceAgentRef", "missionId", "revision");
CREATE INDEX "AgentMissionDraft_tenantId_businessId_status_createdAt_idx"
  ON "AgentMissionDraft"("tenantId", "businessId", "status", "createdAt");
CREATE INDEX "AgentMissionDraft_sourceTurnId_status_idx"
  ON "AgentMissionDraft"("sourceTurnId", "status");
CREATE INDEX "AgentMissionDraft_actorPersonId_status_idx"
  ON "AgentMissionDraft"("actorPersonId", "status");
CREATE TABLE "AgentMissionEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "submittedAt" DATETIME,
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
    "channelIdentityLinkedAt" DATETIME,
    "confirmationExecutionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" DATETIME,
    "revokedByPersonId" TEXT,
    "erasedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "AgentMissionEvidence_draftId_fkey"
      FOREIGN KEY ("draftId") REFERENCES "AgentMissionDraft" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentMissionEvidence_submittedByPersonId_fkey"
      FOREIGN KEY ("submittedByPersonId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AgentMissionEvidence_workItemId_fkey"
      FOREIGN KEY ("workItemId") REFERENCES "WorkItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentMissionEvidence_actorId_fkey"
      FOREIGN KEY ("actorId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AgentMissionEvidence_confirmationActorId_fkey"
      FOREIGN KEY ("confirmationActorId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AgentMissionEvidence_revokedByPersonId_fkey"
      FOREIGN KEY ("revokedByPersonId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AgentMissionEvidence_scope_turn_origin_key"
  ON "AgentMissionEvidence"("tenantId", "businessId", "sourceTurnId", "origin");
CREATE UNIQUE INDEX "AgentMissionEvidence_scope_idempotency_key"
  ON "AgentMissionEvidence"("tenantId", "businessId", "idempotencyKey");
CREATE UNIQUE INDEX "AgentMissionEvidence_workItemId_key"
  ON "AgentMissionEvidence"("workItemId");
CREATE UNIQUE INDEX "AgentMissionEvidence_draftId_key"
  ON "AgentMissionEvidence"("draftId");
CREATE UNIQUE INDEX "AgentMissionEvidence_source_mission_key"
  ON "AgentMissionEvidence"("sourceAgentRef", "missionId");
CREATE INDEX "AgentMissionEvidence_tenantId_businessId_status_createdAt_idx"
  ON "AgentMissionEvidence"("tenantId", "businessId", "status", "createdAt");
CREATE INDEX "AgentMissionEvidence_tenantId_businessId_projectId_workstreamId_status_idx"
  ON "AgentMissionEvidence"("tenantId", "businessId", "projectId", "workstreamId", "status");
CREATE INDEX "AgentMissionEvidence_actorId_status_idx"
  ON "AgentMissionEvidence"("actorId", "status");
