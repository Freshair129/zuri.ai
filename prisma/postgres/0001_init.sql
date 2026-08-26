-- CreateTable
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalEntity" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalEntityIdentifier" (
    "id" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'TH',
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalEntityIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "legalEntityId" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonCredential" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT,
    "branchId" TEXT,
    "employeeRef" TEXT,
    "role" TEXT NOT NULL DEFAULT 'OWNER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "domainKeysJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "assurance" TEXT NOT NULL DEFAULT 'PASSWORD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelIdentity" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "channelAccountId" TEXT NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "linkedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ChannelIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleBinding" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL DEFAULT 'BUSINESS',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "assignedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "RoleBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "portfolioId" TEXT,
    "tenantId" TEXT,
    "businessId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "businessId" TEXT,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'GENERAL',
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "priority" TEXT,
    "picPersonId" TEXT,
    "startAt" TIMESTAMP(3),
    "targetAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMembership" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTeam" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessRoadmap" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startAt" TIMESTAMP(3),
    "targetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "BusinessRoadmap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessRoadmapHorizon" (
    "id" TEXT NOT NULL,
    "roadmapId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT,
    "targetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessRoadmapHorizon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessGoal" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "roadmapId" TEXT,
    "horizonId" TEXT,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startAt" TIMESTAMP(3),
    "targetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "BusinessGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectGoal" (
    "projectId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectGoal_pkey" PRIMARY KEY ("projectId","goalId")
);

-- CreateTable
CREATE TABLE "Workstream" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "executionMode" TEXT NOT NULL,
    "executionModeId" TEXT,
    "laneId" TEXT,
    "executionContractId" TEXT,
    "contractVersion" TEXT,
    "primaryDomainId" TEXT,
    "supportingDomainIdsJson" TEXT NOT NULL DEFAULT '[]',
    "technicalOwnerDomainId" TEXT,
    "identityRefsJson" TEXT NOT NULL DEFAULT '{}',
    "progressStrategy" TEXT NOT NULL,
    "progressWeight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "progressCache" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "viewConfigJson" TEXT NOT NULL DEFAULT '{}',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Workstream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanImportReceipt" (
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "executionRunId" TEXT NOT NULL,
    "executionStepId" TEXT,
    "attemptId" TEXT,
    "stepKey" TEXT NOT NULL DEFAULT 'plan.import.commit',
    "status" TEXT NOT NULL DEFAULT 'SUCCEEDED',
    "correlationId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "replayOfExecutionRunId" TEXT,
    "replayOfExecutionStepId" TEXT,
    "auditEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanImportReceipt_pkey" PRIMARY KEY ("idempotencyKey")
);

-- CreateTable
CREATE TABLE "WorkContainer" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "workstreamId" TEXT NOT NULL,
    "parentId" TEXT,
    "subtype" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "startAt" TIMESTAMP(3),
    "targetAt" TIMESTAMP(3),
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "WorkContainer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItem" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "workstreamId" TEXT NOT NULL,
    "containerId" TEXT,
    "subtype" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "assigneeRef" TEXT,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "numericValue" DOUBLE PRECISION,
    "probability" DOUBLE PRECISION,
    "metricDataJson" TEXT NOT NULL DEFAULT '{}',
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "startAt" TIMESTAMP(3),
    "targetAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "WorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workstreamId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "targetAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workstreamId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "evidenceJson" TEXT NOT NULL DEFAULT '{}',
    "targetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dependency" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "dependencyType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "businessId" TEXT,
    "provider" TEXT NOT NULL,
    "externalRepoId" TEXT,
    "ownerName" TEXT,
    "repoName" TEXT,
    "fullName" TEXT,
    "url" TEXT,
    "defaultBranch" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectRepository" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "pathScope" TEXT,
    "branch" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectRepository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectFile" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workItemId" TEXT,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT,
    "blobRef" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalWorkspaceMount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "deviceKey" TEXT NOT NULL,
    "rootPath" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastScanAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalWorkspaceMount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileAsset" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "projectId" TEXT,
    "workItemId" TEXT,
    "storageKind" TEXT NOT NULL,
    "relativePath" TEXT,
    "externalUrl" TEXT,
    "blobRef" TEXT,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "FileAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileLink" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalIdentity" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSubject" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "linkedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityLinkToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'LINE',
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentityLinkToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalRef" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "labelAs" BOOLEAN NOT NULL DEFAULT true,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT,
    "personId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "lifecycleStage" TEXT NOT NULL DEFAULT 'LEAD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "consentStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "consentRecordedAt" TIMESTAMP(3),
    "consentRecordedByPersonId" TEXT,
    "consentNote" TEXT,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerImportBatch" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "snapshotSha256" TEXT NOT NULL,
    "sourceRowCount" INTEGER NOT NULL,
    "publishRowCount" INTEGER NOT NULL DEFAULT 0,
    "heldRowCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "approvedByPersonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerImportProvenance" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceTable" TEXT NOT NULL,
    "sourceRecordKey" TEXT NOT NULL,
    "sourceRow" INTEGER,
    "sourceSha256" TEXT NOT NULL,
    "snapshotSha256" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "resolutionStatus" TEXT NOT NULL,
    "matchMethod" TEXT NOT NULL,
    "disposition" TEXT NOT NULL,
    "personId" TEXT,
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewCaseId" TEXT,
    "reviewReasonCode" TEXT,
    "reviewEvidenceJson" TEXT,

    CONSTRAINT "CustomerImportProvenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerImportReviewCase" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "groupFingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "evidenceSummaryJson" TEXT NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerImportReviewCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerImportReviewDecision" (
    "id" TEXT NOT NULL,
    "reviewCaseId" TEXT NOT NULL,
    "provenanceId" TEXT NOT NULL,
    "decisionVersion" INTEGER NOT NULL DEFAULT 1,
    "action" TEXT NOT NULL,
    "targetCustomerId" TEXT,
    "decidedByPersonId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerImportReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT,
    "customerId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalThreadId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "externalMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "actorType" TEXT NOT NULL DEFAULT 'LOCAL_USER',
    "actorId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineRun" (
    "id" TEXT NOT NULL,
    "executionRunId" TEXT NOT NULL,
    "dataPipelineDefinitionId" TEXT NOT NULL,
    "executionContractId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "currentStageId" TEXT,
    "sourceRef" TEXT,
    "sourceSha256" TEXT,
    "artifactRef" TEXT,
    "artifactSha256" TEXT,
    "bootstrapBatchId" TEXT,
    "correlationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "expectedCount" INTEGER NOT NULL DEFAULT 0,
    "actualCount" INTEGER NOT NULL DEFAULT 0,
    "insertedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "tagIdsJson" TEXT NOT NULL DEFAULT '[]',
    "identityRefsJson" TEXT NOT NULL DEFAULT '{}',
    "primaryFailureCode" TEXT,
    "primaryErrorRef" TEXT,
    "primaryRetryable" BOOLEAN,
    "auditEventId" TEXT,
    "replayScope" TEXT,
    "replayOfExecutionRunId" TEXT,
    "replayOfExecutionStepId" TEXT,
    "replayOfPipelineRecordId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineStep" (
    "id" TEXT NOT NULL,
    "executionStepId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "pipelineStageId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "attemptId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "inputHash" TEXT,
    "outputHash" TEXT,
    "expectedCount" INTEGER NOT NULL DEFAULT 0,
    "actualCount" INTEGER NOT NULL DEFAULT 0,
    "insertedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failureCode" TEXT,
    "errorRef" TEXT,
    "retryable" BOOLEAN,
    "tagIdsJson" TEXT NOT NULL DEFAULT '[]',
    "identityRefsJson" TEXT NOT NULL DEFAULT '{}',
    "auditEventId" TEXT,
    "replayOfExecutionStepId" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineEventReceipt" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventHash" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL DEFAULT '{}',
    "auditEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineEventReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineRecordEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepId" TEXT,
    "attemptId" TEXT NOT NULL,
    "pipelineRecordId" TEXT NOT NULL,
    "sourceRecordKey" TEXT,
    "sourceRowNumber" INTEGER,
    "sourceSha256" TEXT,
    "docId" TEXT,
    "picId" TEXT,
    "factId" TEXT,
    "sourceDocIdsJson" TEXT NOT NULL DEFAULT '[]',
    "sourcePicIdsJson" TEXT NOT NULL DEFAULT '[]',
    "destinationRecordId" TEXT,
    "status" TEXT NOT NULL,
    "failureCode" TEXT,
    "errorRef" TEXT,
    "retryable" BOOLEAN,
    "tagIdsJson" TEXT NOT NULL DEFAULT '[]',
    "identityRefsJson" TEXT NOT NULL DEFAULT '{}',
    "idempotencyKey" TEXT NOT NULL,
    "auditEventId" TEXT,
    "replayOfPipelineRecordId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineRecordEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineReconciliation" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepId" TEXT,
    "expectedCount" INTEGER NOT NULL DEFAULT 0,
    "actualCount" INTEGER NOT NULL DEFAULT 0,
    "insertedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "sourceSha256" TEXT,
    "artifactSha256" TEXT,
    "stagingHash" TEXT,
    "destinationHash" TEXT,
    "rlsProbeResult" TEXT,
    "isolationResult" TEXT,
    "result" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL DEFAULT '{}',
    "auditEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineGateDecision" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "gateId" TEXT,
    "status" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "decidedByPersonId" TEXT,
    "reason" TEXT,
    "evidenceJson" TEXT NOT NULL DEFAULT '{}',
    "auditEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineGateDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationProvider" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "capabilitiesJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "IntegrationProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "authorizationType" TEXT NOT NULL DEFAULT 'SECRET_MANAGER',
    "externalAccountId" TEXT,
    "purpose" TEXT NOT NULL DEFAULT 'GENERAL',
    "role" TEXT NOT NULL DEFAULT 'SECONDARY',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "lastSyncAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationCredential" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "secretRef" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "rotatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT,
    "connectionId" TEXT NOT NULL,
    "lane" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "runType" TEXT NOT NULL DEFAULT 'INCREMENTAL',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "fetchedCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawExternalRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT,
    "connectionId" TEXT NOT NULL,
    "ingestionRunId" TEXT,
    "provider" TEXT NOT NULL,
    "lane" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceUri" TEXT,
    "schemaVersion" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "processingStatus" TEXT NOT NULL DEFAULT 'RECEIVED',
    "processingError" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RawExternalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncCursor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT,
    "connectionId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "cursorValue" TEXT,
    "watermarkAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalEntityRef" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT,
    "connectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "internalEntityType" TEXT,
    "internalEntityId" TEXT,
    "externalCode" TEXT,
    "documentNumber" TEXT,
    "payloadHash" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalEntityRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeadLetterRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT,
    "connectionId" TEXT NOT NULL,
    "ingestionRunId" TEXT,
    "rawRecordId" TEXT,
    "lane" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "failureStage" TEXT NOT NULL,
    "failureOwner" TEXT NOT NULL,
    "errorCode" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "nextRetryAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeadLetterRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketObservation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT,
    "rawRecordId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceEntityType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sourcePayloadHash" TEXT NOT NULL,
    "sourceUri" TEXT,
    "translationSchemaVersion" TEXT NOT NULL,
    "observationType" TEXT NOT NULL,
    "candidateJson" TEXT NOT NULL,
    "canonicalProductRef" TEXT,
    "canonicalCategoryRef" TEXT,
    "resolutionStatus" TEXT NOT NULL,
    "resolutionConfidence" DOUBLE PRECISION,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "translatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lineageKey" TEXT NOT NULL,

    CONSTRAINT "MarketObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SotDecision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT,
    "decisionType" TEXT NOT NULL,
    "subjectRef" TEXT NOT NULL,
    "phaseId" TEXT,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "payloadSha256" TEXT NOT NULL,
    "decisionVersion" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "submittedBy" TEXT,
    "decidedByPersonId" TEXT,
    "reason" TEXT,
    "auditEventId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SotDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SotDataPlaneKey" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SotDataPlaneKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiAccessKey" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ApiAccessKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Portfolio_code_key" ON "Portfolio"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_code_key" ON "Tenant"("code");

-- CreateIndex
CREATE INDEX "Tenant_portfolioId_idx" ON "Tenant"("portfolioId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalEntity_code_key" ON "LegalEntity"("code");

-- CreateIndex
CREATE INDEX "LegalEntity_portfolioId_idx" ON "LegalEntity"("portfolioId");

-- CreateIndex
CREATE INDEX "LegalEntityIdentifier_legalEntityId_idx" ON "LegalEntityIdentifier"("legalEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalEntityIdentifier_country_type_value_key" ON "LegalEntityIdentifier"("country", "type", "value");

-- CreateIndex
CREATE UNIQUE INDEX "Business_code_key" ON "Business"("code");

-- CreateIndex
CREATE INDEX "Business_tenantId_idx" ON "Business"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

-- CreateIndex
CREATE INDEX "Branch_tenantId_idx" ON "Branch"("tenantId");

-- CreateIndex
CREATE INDEX "Branch_businessId_idx" ON "Branch"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_code_key" ON "Person"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PersonCredential_personId_key" ON "PersonCredential"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "PasswordResetToken_personId_idx" ON "PasswordResetToken"("personId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_token_idx" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "Membership_personId_idx" ON "Membership"("personId");

-- CreateIndex
CREATE INDEX "Membership_personId_status_idx" ON "Membership"("personId", "status");

-- CreateIndex
CREATE INDEX "Membership_tenantId_idx" ON "Membership"("tenantId");

-- CreateIndex
CREATE INDEX "Membership_tenantId_status_idx" ON "Membership"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_personId_status_idx" ON "Session"("personId", "status");

-- CreateIndex
CREATE INDEX "Session_expiresAt_status_idx" ON "Session"("expiresAt", "status");

-- CreateIndex
CREATE INDEX "ChannelIdentity_personId_status_idx" ON "ChannelIdentity"("personId", "status");

-- CreateIndex
CREATE INDEX "ChannelIdentity_tenantId_status_idx" ON "ChannelIdentity"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelIdentity_tenantId_channel_channelAccountId_providerS_key" ON "ChannelIdentity"("tenantId", "channel", "channelAccountId", "providerSubject");

-- CreateIndex
CREATE INDEX "RoleBinding_tenantId_businessId_status_idx" ON "RoleBinding"("tenantId", "businessId", "status");

-- CreateIndex
CREATE INDEX "RoleBinding_personId_status_idx" ON "RoleBinding"("personId", "status");

-- CreateIndex
CREATE INDEX "RoleBinding_roleKey_status_idx" ON "RoleBinding"("roleKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RoleBinding_personId_businessId_roleKey_key" ON "RoleBinding"("personId", "businessId", "roleKey");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_code_key" ON "Workspace"("code");

-- CreateIndex
CREATE INDEX "Workspace_portfolioId_idx" ON "Workspace"("portfolioId");

-- CreateIndex
CREATE INDEX "Workspace_tenantId_idx" ON "Workspace"("tenantId");

-- CreateIndex
CREATE INDEX "Workspace_businessId_idx" ON "Workspace"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");

-- CreateIndex
CREATE INDEX "Project_businessId_idx" ON "Project"("businessId");

-- CreateIndex
CREATE INDEX "Project_workspaceId_idx" ON "Project"("workspaceId");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE INDEX "Project_priority_idx" ON "Project"("priority");

-- CreateIndex
CREATE INDEX "Project_picPersonId_idx" ON "Project"("picPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_code_key" ON "Team"("code");

-- CreateIndex
CREATE INDEX "Team_businessId_idx" ON "Team"("businessId");

-- CreateIndex
CREATE INDEX "TeamMembership_teamId_idx" ON "TeamMembership"("teamId");

-- CreateIndex
CREATE INDEX "TeamMembership_personId_idx" ON "TeamMembership"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMembership_teamId_personId_key" ON "TeamMembership"("teamId", "personId");

-- CreateIndex
CREATE INDEX "ProjectTeam_projectId_idx" ON "ProjectTeam"("projectId");

-- CreateIndex
CREATE INDEX "ProjectTeam_teamId_idx" ON "ProjectTeam"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTeam_projectId_teamId_key" ON "ProjectTeam"("projectId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessRoadmap_code_key" ON "BusinessRoadmap"("code");

-- CreateIndex
CREATE INDEX "BusinessRoadmap_businessId_status_idx" ON "BusinessRoadmap"("businessId", "status");

-- CreateIndex
CREATE INDEX "BusinessRoadmapHorizon_roadmapId_idx" ON "BusinessRoadmapHorizon"("roadmapId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessRoadmapHorizon_roadmapId_key_key" ON "BusinessRoadmapHorizon"("roadmapId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessRoadmapHorizon_roadmapId_position_key" ON "BusinessRoadmapHorizon"("roadmapId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessGoal_code_key" ON "BusinessGoal"("code");

-- CreateIndex
CREATE INDEX "BusinessGoal_businessId_status_idx" ON "BusinessGoal"("businessId", "status");

-- CreateIndex
CREATE INDEX "BusinessGoal_roadmapId_idx" ON "BusinessGoal"("roadmapId");

-- CreateIndex
CREATE INDEX "BusinessGoal_horizonId_idx" ON "BusinessGoal"("horizonId");

-- CreateIndex
CREATE INDEX "ProjectGoal_goalId_idx" ON "ProjectGoal"("goalId");

-- CreateIndex
CREATE UNIQUE INDEX "Workstream_code_key" ON "Workstream"("code");

-- CreateIndex
CREATE INDEX "Workstream_projectId_idx" ON "Workstream"("projectId");

-- CreateIndex
CREATE INDEX "Workstream_executionMode_idx" ON "Workstream"("executionMode");

-- CreateIndex
CREATE INDEX "Workstream_executionModeId_idx" ON "Workstream"("executionModeId");

-- CreateIndex
CREATE INDEX "Workstream_laneId_idx" ON "Workstream"("laneId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanImportReceipt_executionRunId_key" ON "PlanImportReceipt"("executionRunId");

-- CreateIndex
CREATE INDEX "PlanImportReceipt_projectId_idx" ON "PlanImportReceipt"("projectId");

-- CreateIndex
CREATE INDEX "PlanImportReceipt_correlationId_idx" ON "PlanImportReceipt"("correlationId");

-- CreateIndex
CREATE INDEX "PlanImportReceipt_replayOfExecutionRunId_idx" ON "PlanImportReceipt"("replayOfExecutionRunId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkContainer_code_key" ON "WorkContainer"("code");

-- CreateIndex
CREATE INDEX "WorkContainer_workstreamId_idx" ON "WorkContainer"("workstreamId");

-- CreateIndex
CREATE INDEX "WorkContainer_parentId_idx" ON "WorkContainer"("parentId");

-- CreateIndex
CREATE INDEX "WorkContainer_subtype_idx" ON "WorkContainer"("subtype");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItem_code_key" ON "WorkItem"("code");

-- CreateIndex
CREATE INDEX "WorkItem_workstreamId_idx" ON "WorkItem"("workstreamId");

-- CreateIndex
CREATE INDEX "WorkItem_containerId_idx" ON "WorkItem"("containerId");

-- CreateIndex
CREATE INDEX "WorkItem_subtype_idx" ON "WorkItem"("subtype");

-- CreateIndex
CREATE INDEX "WorkItem_status_idx" ON "WorkItem"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Milestone_code_key" ON "Milestone"("code");

-- CreateIndex
CREATE INDEX "Milestone_projectId_idx" ON "Milestone"("projectId");

-- CreateIndex
CREATE INDEX "Milestone_workstreamId_idx" ON "Milestone"("workstreamId");

-- CreateIndex
CREATE UNIQUE INDEX "Gate_code_key" ON "Gate"("code");

-- CreateIndex
CREATE INDEX "Gate_projectId_idx" ON "Gate"("projectId");

-- CreateIndex
CREATE INDEX "Gate_workstreamId_idx" ON "Gate"("workstreamId");

-- CreateIndex
CREATE INDEX "Dependency_sourceType_sourceId_idx" ON "Dependency"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "Dependency_targetType_targetId_idx" ON "Dependency"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "Dependency_sourceType_sourceId_targetType_targetId_dependen_key" ON "Dependency"("sourceType", "sourceId", "targetType", "targetId", "dependencyType");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_code_key" ON "Repository"("code");

-- CreateIndex
CREATE INDEX "Repository_provider_fullName_idx" ON "Repository"("provider", "fullName");

-- CreateIndex
CREATE INDEX "Repository_businessId_idx" ON "Repository"("businessId");

-- CreateIndex
CREATE INDEX "ProjectRepository_repoId_idx" ON "ProjectRepository"("repoId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectRepository_projectId_repoId_role_key" ON "ProjectRepository"("projectId", "repoId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectFile_code_key" ON "ProjectFile"("code");

-- CreateIndex
CREATE INDEX "ProjectFile_projectId_idx" ON "ProjectFile"("projectId");

-- CreateIndex
CREATE INDEX "ProjectFile_workItemId_idx" ON "ProjectFile"("workItemId");

-- CreateIndex
CREATE INDEX "LocalWorkspaceMount_tenantId_idx" ON "LocalWorkspaceMount"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "LocalWorkspaceMount_businessId_deviceKey_key" ON "LocalWorkspaceMount"("businessId", "deviceKey");

-- CreateIndex
CREATE UNIQUE INDEX "FileAsset_code_key" ON "FileAsset"("code");

-- CreateIndex
CREATE INDEX "FileAsset_tenantId_idx" ON "FileAsset"("tenantId");

-- CreateIndex
CREATE INDEX "FileAsset_businessId_idx" ON "FileAsset"("businessId");

-- CreateIndex
CREATE INDEX "FileAsset_projectId_idx" ON "FileAsset"("projectId");

-- CreateIndex
CREATE INDEX "FileAsset_workItemId_idx" ON "FileAsset"("workItemId");

-- CreateIndex
CREATE INDEX "FileLink_entityType_entityId_idx" ON "FileLink"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "FileLink_fileId_entityType_entityId_relationType_key" ON "FileLink"("fileId", "entityType", "entityId", "relationType");

-- CreateIndex
CREATE INDEX "ExternalIdentity_personId_idx" ON "ExternalIdentity"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalIdentity_tenantId_provider_providerSubject_key" ON "ExternalIdentity"("tenantId", "provider", "providerSubject");

-- CreateIndex
CREATE UNIQUE INDEX "IdentityLinkToken_token_key" ON "IdentityLinkToken"("token");

-- CreateIndex
CREATE INDEX "IdentityLinkToken_personId_idx" ON "IdentityLinkToken"("personId");

-- CreateIndex
CREATE INDEX "IdentityLinkToken_tenantId_idx" ON "IdentityLinkToken"("tenantId");

-- CreateIndex
CREATE INDEX "ExternalRef_entityType_entityId_idx" ON "ExternalRef"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalRef_system_value_key" ON "ExternalRef"("system", "value");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");

-- CreateIndex
CREATE INDEX "Customer_businessId_idx" ON "Customer"("businessId");

-- CreateIndex
CREATE INDEX "Customer_consentStatus_idx" ON "Customer"("consentStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenantId_personId_key" ON "Customer"("tenantId", "personId");

-- CreateIndex
CREATE INDEX "CustomerImportBatch_tenantId_businessId_status_idx" ON "CustomerImportBatch"("tenantId", "businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerImportBatch_contractId_missionId_versionId_snapshot_key" ON "CustomerImportBatch"("contractId", "missionId", "versionId", "snapshotSha256");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerImportProvenance_idempotencyKey_key" ON "CustomerImportProvenance"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CustomerImportProvenance_batchId_resolutionStatus_dispositi_idx" ON "CustomerImportProvenance"("batchId", "resolutionStatus", "disposition");

-- CreateIndex
CREATE INDEX "CustomerImportProvenance_personId_customerId_idx" ON "CustomerImportProvenance"("personId", "customerId");

-- CreateIndex
CREATE INDEX "CustomerImportProvenance_reviewCaseId_idx" ON "CustomerImportProvenance"("reviewCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerImportProvenance_sourceSystem_sourceTable_sourceRec_key" ON "CustomerImportProvenance"("sourceSystem", "sourceTable", "sourceRecordKey", "snapshotSha256");

-- CreateIndex
CREATE INDEX "CustomerImportReviewCase_tenantId_businessId_status_idx" ON "CustomerImportReviewCase"("tenantId", "businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerImportReviewCase_batchId_groupFingerprint_key" ON "CustomerImportReviewCase"("batchId", "groupFingerprint");

-- CreateIndex
CREATE INDEX "CustomerImportReviewDecision_reviewCaseId_provenanceId_deci_idx" ON "CustomerImportReviewDecision"("reviewCaseId", "provenanceId", "decisionVersion");

-- CreateIndex
CREATE INDEX "CustomerImportReviewDecision_targetCustomerId_idx" ON "CustomerImportReviewDecision"("targetCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerImportReviewDecision_provenanceId_decisionVersion_key" ON "CustomerImportReviewDecision"("provenanceId", "decisionVersion");

-- CreateIndex
CREATE INDEX "Conversation_customerId_idx" ON "Conversation"("customerId");

-- CreateIndex
CREATE INDEX "Conversation_tenantId_idx" ON "Conversation"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_tenantId_channel_externalThreadId_key" ON "Conversation"("tenantId", "channel", "externalThreadId");

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_conversationId_externalMessageId_key" ON "Message"("conversationId", "externalMessageId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_occurredAt_idx" ON "AuditEvent"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineRun_executionRunId_key" ON "PipelineRun"("executionRunId");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineRun_idempotencyKey_key" ON "PipelineRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PipelineRun_tenantId_status_idx" ON "PipelineRun"("tenantId", "status");

-- CreateIndex
CREATE INDEX "PipelineRun_businessId_status_createdAt_idx" ON "PipelineRun"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PipelineRun_correlationId_idx" ON "PipelineRun"("correlationId");

-- CreateIndex
CREATE INDEX "PipelineRun_replayOfExecutionRunId_idx" ON "PipelineRun"("replayOfExecutionRunId");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStep_executionStepId_key" ON "PipelineStep"("executionStepId");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStep_attemptId_key" ON "PipelineStep"("attemptId");

-- CreateIndex
CREATE INDEX "PipelineStep_runId_pipelineStageId_sequence_idx" ON "PipelineStep"("runId", "pipelineStageId", "sequence");

-- CreateIndex
CREATE INDEX "PipelineStep_runId_status_idx" ON "PipelineStep"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineEventReceipt_idempotencyKey_key" ON "PipelineEventReceipt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PipelineEventReceipt_runId_eventType_idx" ON "PipelineEventReceipt"("runId", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineRecordEvent_idempotencyKey_key" ON "PipelineRecordEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PipelineRecordEvent_runId_status_idx" ON "PipelineRecordEvent"("runId", "status");

-- CreateIndex
CREATE INDEX "PipelineRecordEvent_pipelineRecordId_idx" ON "PipelineRecordEvent"("pipelineRecordId");

-- CreateIndex
CREATE INDEX "PipelineRecordEvent_docId_idx" ON "PipelineRecordEvent"("docId");

-- CreateIndex
CREATE INDEX "PipelineRecordEvent_picId_idx" ON "PipelineRecordEvent"("picId");

-- CreateIndex
CREATE INDEX "PipelineRecordEvent_factId_idx" ON "PipelineRecordEvent"("factId");

-- CreateIndex
CREATE INDEX "PipelineReconciliation_runId_result_idx" ON "PipelineReconciliation"("runId", "result");

-- CreateIndex
CREATE INDEX "PipelineReconciliation_stepId_idx" ON "PipelineReconciliation"("stepId");

-- CreateIndex
CREATE INDEX "PipelineGateDecision_runId_status_idx" ON "PipelineGateDecision"("runId", "status");

-- CreateIndex
CREATE INDEX "PipelineGateDecision_gateId_idx" ON "PipelineGateDecision"("gateId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationProvider_code_key" ON "IntegrationProvider"("code");

-- CreateIndex
CREATE INDEX "IntegrationConnection_tenantId_businessId_purpose_status_ro_idx" ON "IntegrationConnection"("tenantId", "businessId", "purpose", "status", "role");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_tenantId_providerId_externalAccountId_key" ON "IntegrationConnection"("tenantId", "providerId", "externalAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationCredential_connectionId_key" ON "IntegrationCredential"("connectionId");

-- CreateIndex
CREATE INDEX "IngestionRun_tenantId_status_idx" ON "IngestionRun"("tenantId", "status");

-- CreateIndex
CREATE INDEX "IngestionRun_businessId_idx" ON "IngestionRun"("businessId");

-- CreateIndex
CREATE INDEX "IngestionRun_connectionId_resourceType_idx" ON "IngestionRun"("connectionId", "resourceType");

-- CreateIndex
CREATE INDEX "IngestionRun_startedAt_idx" ON "IngestionRun"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RawExternalRecord_idempotencyKey_key" ON "RawExternalRecord"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RawExternalRecord_tenantId_entityType_idx" ON "RawExternalRecord"("tenantId", "entityType");

-- CreateIndex
CREATE INDEX "RawExternalRecord_businessId_idx" ON "RawExternalRecord"("businessId");

-- CreateIndex
CREATE INDEX "RawExternalRecord_connectionId_entityType_externalId_idx" ON "RawExternalRecord"("connectionId", "entityType", "externalId");

-- CreateIndex
CREATE INDEX "RawExternalRecord_ingestionRunId_idx" ON "RawExternalRecord"("ingestionRunId");

-- CreateIndex
CREATE INDEX "RawExternalRecord_processingStatus_idx" ON "RawExternalRecord"("processingStatus");

-- CreateIndex
CREATE INDEX "SyncCursor_tenantId_resourceType_idx" ON "SyncCursor"("tenantId", "resourceType");

-- CreateIndex
CREATE INDEX "SyncCursor_businessId_idx" ON "SyncCursor"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncCursor_connectionId_resourceType_key" ON "SyncCursor"("connectionId", "resourceType");

-- CreateIndex
CREATE INDEX "ExternalEntityRef_tenantId_entityType_idx" ON "ExternalEntityRef"("tenantId", "entityType");

-- CreateIndex
CREATE INDEX "ExternalEntityRef_businessId_idx" ON "ExternalEntityRef"("businessId");

-- CreateIndex
CREATE INDEX "ExternalEntityRef_internalEntityType_internalEntityId_idx" ON "ExternalEntityRef"("internalEntityType", "internalEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalEntityRef_connectionId_entityType_externalId_key" ON "ExternalEntityRef"("connectionId", "entityType", "externalId");

-- CreateIndex
CREATE INDEX "DeadLetterRecord_tenantId_status_idx" ON "DeadLetterRecord"("tenantId", "status");

-- CreateIndex
CREATE INDEX "DeadLetterRecord_businessId_idx" ON "DeadLetterRecord"("businessId");

-- CreateIndex
CREATE INDEX "DeadLetterRecord_connectionId_status_idx" ON "DeadLetterRecord"("connectionId", "status");

-- CreateIndex
CREATE INDEX "DeadLetterRecord_ingestionRunId_idx" ON "DeadLetterRecord"("ingestionRunId");

-- CreateIndex
CREATE INDEX "DeadLetterRecord_rawRecordId_idx" ON "DeadLetterRecord"("rawRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketObservation_lineageKey_key" ON "MarketObservation"("lineageKey");

-- CreateIndex
CREATE INDEX "MarketObservation_tenantId_businessId_observedAt_idx" ON "MarketObservation"("tenantId", "businessId", "observedAt");

-- CreateIndex
CREATE INDEX "MarketObservation_tenantId_connectionId_provider_idx" ON "MarketObservation"("tenantId", "connectionId", "provider");

-- CreateIndex
CREATE INDEX "MarketObservation_rawRecordId_idx" ON "MarketObservation"("rawRecordId");

-- CreateIndex
CREATE INDEX "MarketObservation_canonicalProductRef_idx" ON "MarketObservation"("canonicalProductRef");

-- CreateIndex
CREATE INDEX "SotDecision_tenantId_status_decisionType_idx" ON "SotDecision"("tenantId", "status", "decisionType");

-- CreateIndex
CREATE INDEX "SotDecision_businessId_status_idx" ON "SotDecision"("businessId", "status");

-- CreateIndex
CREATE INDEX "SotDecision_phaseId_status_idx" ON "SotDecision"("phaseId", "status");

-- CreateIndex
CREATE INDEX "SotDecision_updatedAt_idx" ON "SotDecision"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SotDecision_tenantId_decisionType_subjectRef_decisionVersio_key" ON "SotDecision"("tenantId", "decisionType", "subjectRef", "decisionVersion");

-- CreateIndex
CREATE UNIQUE INDEX "SotDataPlaneKey_keyHash_key" ON "SotDataPlaneKey"("keyHash");

-- CreateIndex
CREATE INDEX "SotDataPlaneKey_tenantId_status_idx" ON "SotDataPlaneKey"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApiAccessKey_keyHash_key" ON "ApiAccessKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiAccessKey_tenantId_status_idx" ON "ApiAccessKey"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalEntity" ADD CONSTRAINT "LegalEntity_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalEntityIdentifier" ADD CONSTRAINT "LegalEntityIdentifier_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Business" ADD CONSTRAINT "Business_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Business" ADD CONSTRAINT "Business_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonCredential" ADD CONSTRAINT "PersonCredential_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelIdentity" ADD CONSTRAINT "ChannelIdentity_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelIdentity" ADD CONSTRAINT "ChannelIdentity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleBinding" ADD CONSTRAINT "RoleBinding_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleBinding" ADD CONSTRAINT "RoleBinding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleBinding" ADD CONSTRAINT "RoleBinding_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_picPersonId_fkey" FOREIGN KEY ("picPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTeam" ADD CONSTRAINT "ProjectTeam_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTeam" ADD CONSTRAINT "ProjectTeam_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessRoadmap" ADD CONSTRAINT "BusinessRoadmap_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessRoadmapHorizon" ADD CONSTRAINT "BusinessRoadmapHorizon_roadmapId_fkey" FOREIGN KEY ("roadmapId") REFERENCES "BusinessRoadmap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessGoal" ADD CONSTRAINT "BusinessGoal_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessGoal" ADD CONSTRAINT "BusinessGoal_roadmapId_fkey" FOREIGN KEY ("roadmapId") REFERENCES "BusinessRoadmap"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessGoal" ADD CONSTRAINT "BusinessGoal_horizonId_fkey" FOREIGN KEY ("horizonId") REFERENCES "BusinessRoadmapHorizon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectGoal" ADD CONSTRAINT "ProjectGoal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectGoal" ADD CONSTRAINT "ProjectGoal_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "BusinessGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workstream" ADD CONSTRAINT "Workstream_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanImportReceipt" ADD CONSTRAINT "PlanImportReceipt_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkContainer" ADD CONSTRAINT "WorkContainer_workstreamId_fkey" FOREIGN KEY ("workstreamId") REFERENCES "Workstream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkContainer" ADD CONSTRAINT "WorkContainer_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "WorkContainer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_workstreamId_fkey" FOREIGN KEY ("workstreamId") REFERENCES "Workstream"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "WorkContainer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_workstreamId_fkey" FOREIGN KEY ("workstreamId") REFERENCES "Workstream"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gate" ADD CONSTRAINT "Gate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gate" ADD CONSTRAINT "Gate_workstreamId_fkey" FOREIGN KEY ("workstreamId") REFERENCES "Workstream"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRepository" ADD CONSTRAINT "ProjectRepository_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRepository" ADD CONSTRAINT "ProjectRepository_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFile" ADD CONSTRAINT "ProjectFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFile" ADD CONSTRAINT "ProjectFile_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalWorkspaceMount" ADD CONSTRAINT "LocalWorkspaceMount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalWorkspaceMount" ADD CONSTRAINT "LocalWorkspaceMount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileLink" ADD CONSTRAINT "FileLink_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityLinkToken" ADD CONSTRAINT "IdentityLinkToken_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityLinkToken" ADD CONSTRAINT "IdentityLinkToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_consentRecordedByPersonId_fkey" FOREIGN KEY ("consentRecordedByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerImportBatch" ADD CONSTRAINT "CustomerImportBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerImportBatch" ADD CONSTRAINT "CustomerImportBatch_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerImportBatch" ADD CONSTRAINT "CustomerImportBatch_approvedByPersonId_fkey" FOREIGN KEY ("approvedByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerImportProvenance" ADD CONSTRAINT "CustomerImportProvenance_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CustomerImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerImportProvenance" ADD CONSTRAINT "CustomerImportProvenance_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerImportProvenance" ADD CONSTRAINT "CustomerImportProvenance_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerImportProvenance" ADD CONSTRAINT "CustomerImportProvenance_reviewCaseId_fkey" FOREIGN KEY ("reviewCaseId") REFERENCES "CustomerImportReviewCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerImportReviewCase" ADD CONSTRAINT "CustomerImportReviewCase_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CustomerImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerImportReviewCase" ADD CONSTRAINT "CustomerImportReviewCase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerImportReviewCase" ADD CONSTRAINT "CustomerImportReviewCase_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerImportReviewDecision" ADD CONSTRAINT "CustomerImportReviewDecision_reviewCaseId_fkey" FOREIGN KEY ("reviewCaseId") REFERENCES "CustomerImportReviewCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerImportReviewDecision" ADD CONSTRAINT "CustomerImportReviewDecision_provenanceId_fkey" FOREIGN KEY ("provenanceId") REFERENCES "CustomerImportProvenance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerImportReviewDecision" ADD CONSTRAINT "CustomerImportReviewDecision_targetCustomerId_fkey" FOREIGN KEY ("targetCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerImportReviewDecision" ADD CONSTRAINT "CustomerImportReviewDecision_decidedByPersonId_fkey" FOREIGN KEY ("decidedByPersonId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineRun" ADD CONSTRAINT "PipelineRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineRun" ADD CONSTRAINT "PipelineRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineStep" ADD CONSTRAINT "PipelineStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PipelineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineEventReceipt" ADD CONSTRAINT "PipelineEventReceipt_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PipelineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineRecordEvent" ADD CONSTRAINT "PipelineRecordEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PipelineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineRecordEvent" ADD CONSTRAINT "PipelineRecordEvent_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "PipelineStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineReconciliation" ADD CONSTRAINT "PipelineReconciliation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PipelineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineReconciliation" ADD CONSTRAINT "PipelineReconciliation_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "PipelineStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineGateDecision" ADD CONSTRAINT "PipelineGateDecision_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PipelineRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "IntegrationProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationCredential" ADD CONSTRAINT "IntegrationCredential_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionRun" ADD CONSTRAINT "IngestionRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionRun" ADD CONSTRAINT "IngestionRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionRun" ADD CONSTRAINT "IngestionRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawExternalRecord" ADD CONSTRAINT "RawExternalRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawExternalRecord" ADD CONSTRAINT "RawExternalRecord_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawExternalRecord" ADD CONSTRAINT "RawExternalRecord_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawExternalRecord" ADD CONSTRAINT "RawExternalRecord_ingestionRunId_fkey" FOREIGN KEY ("ingestionRunId") REFERENCES "IngestionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncCursor" ADD CONSTRAINT "SyncCursor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncCursor" ADD CONSTRAINT "SyncCursor_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncCursor" ADD CONSTRAINT "SyncCursor_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalEntityRef" ADD CONSTRAINT "ExternalEntityRef_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalEntityRef" ADD CONSTRAINT "ExternalEntityRef_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalEntityRef" ADD CONSTRAINT "ExternalEntityRef_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadLetterRecord" ADD CONSTRAINT "DeadLetterRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadLetterRecord" ADD CONSTRAINT "DeadLetterRecord_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadLetterRecord" ADD CONSTRAINT "DeadLetterRecord_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadLetterRecord" ADD CONSTRAINT "DeadLetterRecord_ingestionRunId_fkey" FOREIGN KEY ("ingestionRunId") REFERENCES "IngestionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadLetterRecord" ADD CONSTRAINT "DeadLetterRecord_rawRecordId_fkey" FOREIGN KEY ("rawRecordId") REFERENCES "RawExternalRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SotDecision" ADD CONSTRAINT "SotDecision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SotDecision" ADD CONSTRAINT "SotDecision_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SotDataPlaneKey" ADD CONSTRAINT "SotDataPlaneKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiAccessKey" ADD CONSTRAINT "ApiAccessKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

