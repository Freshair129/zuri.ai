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
    "tenantId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "legalAddress" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
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
CREATE TABLE "TaxRegistrationBranch" (
    "id" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "branchCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRegistrationBranch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "legalEntityId" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "capabilitiesJson" TEXT NOT NULL DEFAULT '{}',
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
    "address" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'SITE',
    "taxRegistrationBranchId" TEXT,
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
    "firstName" TEXT,
    "lastName" TEXT,
    "phone" TEXT,
    "profileCompletedAt" TIMESTAMP(3),
    "accessDisabledAt" TIMESTAMP(3),
    "accessDisabledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformGrant" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "capability" TEXT NOT NULL DEFAULT 'OPERATOR',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "grantedByPersonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,

    CONSTRAINT "PlatformGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMembership" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "invitedByPersonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "WorkspaceMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceInvite" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "invitedByPersonId" TEXT NOT NULL,
    "targetPersonId" TEXT,
    "invitedEmail" TEXT,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedByPersonId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceInvite_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "PluginInstallation" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluginInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PluginAuthorizationCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "codeChallengeMethod" TEXT NOT NULL DEFAULT 'S256',
    "pluginInstallationId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PluginAuthorizationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PluginSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "pluginInstallationId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "authorizationCodeId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluginSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL DEFAULT 'BUSINESS',
    "businessId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "domainKeysJson" TEXT NOT NULL DEFAULT '[]',
    "grantedByPersonId" TEXT,
    "grantReason" TEXT,
    "grantSource" TEXT NOT NULL DEFAULT 'ADMIN',
    "expiresAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByPersonId" TEXT,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employment" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "branchId" TEXT,
    "employeeNo" TEXT,
    "title" TEXT,
    "employmentType" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Employment_pkey" PRIMARY KEY ("id")
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
    "cascadeOfMembershipId" TEXT,
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
CREATE TABLE "RegisteredAsset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "intakeId" TEXT,
    "lotId" TEXT,
    "assetCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryCode" TEXT NOT NULL,
    "description" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "condition" TEXT NOT NULL DEFAULT 'GOOD',
    "acquisitionAmount" TEXT,
    "currency" TEXT,
    "receivedOn" TIMESTAMP(3),
    "registeredAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RegisteredAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetIntake" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "intakeCode" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "sourceChannel" TEXT NOT NULL,
    "sourceCorrelationId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "payloadSha256" TEXT,
    "normalizedEnvelopeJson" TEXT NOT NULL DEFAULT '{}',
    "validationJson" TEXT NOT NULL DEFAULT '{}',
    "validatedAt" TIMESTAMP(3),
    "pipelineRunId" TEXT,
    "submittedByPersonId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedByPersonId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AssetIntake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetEvidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "registeredAssetId" TEXT,
    "fileAssetId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sha256" TEXT,
    "paymentReference" TEXT,
    "extractionJson" TEXT NOT NULL DEFAULT '{}',
    "reviewJson" TEXT NOT NULL DEFAULT '{}',
    "reviewedByPersonId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AssetEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetProcurementRef" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "registeredAssetId" TEXT,
    "type" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "lineValue" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNRESOLVED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AssetProcurementRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetLot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "lotCode" TEXT NOT NULL,
    "manufacturedOn" TIMESTAMP(3),
    "expiresOn" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AssetLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetResponsibility" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "registeredAssetId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "orgUnitSystem" TEXT,
    "orgUnitRef" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AssetResponsibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetLocationHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "registeredAssetId" TEXT NOT NULL,
    "branchId" TEXT,
    "locationCode" TEXT NOT NULL,
    "locationName" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AssetLocationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetProjectAllocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "registeredAssetId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workstreamId" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "exclusive" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AssetProjectAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetDepreciationCandidate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "intakeId" TEXT,
    "registeredAssetId" TEXT,
    "method" TEXT NOT NULL,
    "acquisitionAmount" TEXT NOT NULL,
    "residualValue" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "usefulLifeMonths" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "calculationVersion" TEXT NOT NULL,
    "scheduleJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "reviewedByPersonId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AssetDepreciationCandidate_pkey" PRIMARY KEY ("id")
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
    "channelAccountId" TEXT NOT NULL DEFAULT 'LEGACY:LINE',
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
CREATE TABLE "ConversationAnalysis" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "analyzedDate" TIMESTAMP(3) NOT NULL,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contactType" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "cta" TEXT,
    "tags" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "rawOutputJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationAnalysis_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "AgentTraceEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "executionId" TEXT,
    "kind" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "AgentTraceEvent_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "KnowledgeEvidenceCursor" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sharing" TEXT NOT NULL,
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "lastPulledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeEvidenceCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeRawArtifact" (
    "id" TEXT NOT NULL,
    "rawExternalRecordId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceUri" TEXT,
    "contentType" TEXT NOT NULL,
    "pipelineVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeRawArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeParsedArtifact" (
    "id" TEXT NOT NULL,
    "rawArtifactId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "structureJson" TEXT NOT NULL DEFAULT '[]',
    "textBlocksJson" TEXT NOT NULL DEFAULT '[]',
    "tablesJson" TEXT NOT NULL DEFAULT '[]',
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "portfolioId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeParsedArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "parsedArtifactId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "headingPathJson" TEXT NOT NULL DEFAULT '[]',
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "portfolioId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenesisRag17IngestionIntent" (
    "id" TEXT NOT NULL,
    "intentKey" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "executionRunId" TEXT NOT NULL,
    "scopeJson" TEXT NOT NULL,
    "requestJson" TEXT NOT NULL,
    "derivationJson" TEXT NOT NULL,
    "rawArtifactId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "nextStageNumber" INTEGER NOT NULL DEFAULT 1,
    "lastErrorJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenesisRag17IngestionIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenesisRag17SourceMention" (
    "id" TEXT NOT NULL,
    "sourceMentionId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "executionRunId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "rawArtifactId" TEXT NOT NULL,
    "parsedArtifactId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "resolutionKey" TEXT NOT NULL,
    "semanticType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "recognizerVersion" TEXT NOT NULL,
    "recognizerProvenance" TEXT NOT NULL,
    "derivationHash" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GenesisRag17SourceMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenesisRag17Batch" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "executionRunId" TEXT NOT NULL,
    "stage9StepId" TEXT NOT NULL,
    "stage9AttemptId" TEXT NOT NULL,
    "scopeJson" TEXT NOT NULL,
    "requestJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decisionId" TEXT,
    "responseJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenesisRag17Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenesisRag17StageEvidence" (
    "id" TEXT NOT NULL,
    "cursor" INTEGER,
    "runId" TEXT NOT NULL,
    "executionRunId" TEXT NOT NULL,
    "pipelineStageId" TEXT NOT NULL,
    "executionStepId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "stageNumber" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "recordsIn" INTEGER NOT NULL,
    "recordsOut" INTEGER NOT NULL,
    "recordsQuarantined" INTEGER NOT NULL,
    "errorCount" INTEGER NOT NULL,
    "retryCount" INTEGER NOT NULL,
    "durationMs" DOUBLE PRECISION NOT NULL,
    "detailsJson" TEXT NOT NULL DEFAULT '{}',
    "rowHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GenesisRag17StageEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenesisRag17PublicationReceipt" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "executionRunId" TEXT NOT NULL,
    "scopeJson" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "decisionHash" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "generation" TEXT NOT NULL,
    "receiptHash" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "pointerHash" TEXT NOT NULL,
    "modelRevision" TEXT NOT NULL,
    "transactionFrontier" TEXT NOT NULL,
    "readbackJson" TEXT NOT NULL,
    "receiptJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GenesisRag17PublicationReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenesisRag17EvidenceCursor" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "lastPulledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenesisRag17EvidenceCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeCorpus" (
    "id" TEXT NOT NULL,
    "corpusKey" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "projectId" TEXT,
    "workspaceId" TEXT NOT NULL DEFAULT '',
    "scopeJson" TEXT NOT NULL,
    "policyJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "generation" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "KnowledgeCorpus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeSource" (
    "id" TEXT NOT NULL,
    "corpusId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileAssetId" TEXT,
    "desiredRevision" INTEGER NOT NULL DEFAULT 0,
    "activeIngestionId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeIngestion" (
    "id" TEXT NOT NULL,
    "corpusId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceMetaJson" TEXT NOT NULL DEFAULT '{}',
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "submittedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "executionRunId" TEXT,
    "rawArtifactId" TEXT,
    "parsedArtifactId" TEXT,
    "snapshotId" TEXT,
    "snapshotGeneration" TEXT,
    "receiptHash" TEXT,
    "claimToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failureCode" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeIngestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeCorpusGeneration" (
    "id" TEXT NOT NULL,
    "corpusId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "manifestJson" TEXT NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeCorpusGeneration_pkey" PRIMARY KEY ("id")
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
    "artifactId" TEXT,
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

-- CreateTable
CREATE TABLE "EdgeDeviceCredential" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "EdgeDeviceCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetExtractionJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "claimedByDeviceId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "resultJson" TEXT NOT NULL DEFAULT '{}',
    "provider" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "AssetExtractionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineOaAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "integrationConnectionId" TEXT NOT NULL,
    "bindingCode" TEXT,
    "displayName" TEXT NOT NULL,
    "basicId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "transportMode" TEXT NOT NULL DEFAULT 'CLOUD',
    "serverEnabled" BOOLEAN NOT NULL DEFAULT false,
    "executionMode" TEXT NOT NULL DEFAULT 'SERVER',
    "modelAccess" TEXT NOT NULL DEFAULT 'LOCAL_ONLY',
    "allowDelayedPush" BOOLEAN NOT NULL DEFAULT false,
    "transportEpoch" INTEGER NOT NULL DEFAULT 1,
    "isDefaultForBusiness" BOOLEAN NOT NULL DEFAULT false,
    "botProfileJson" TEXT NOT NULL DEFAULT '{}',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "LineOaAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineOaRichMenu" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "lineOaAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "alias" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "LineOaRichMenu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineOaRichMenuVersion" (
    "id" TEXT NOT NULL,
    "richMenuId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "lineOaAccountId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "layout" TEXT NOT NULL,
    "chatBarText" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "imageFileAssetId" TEXT,
    "imageWidth" INTEGER NOT NULL,
    "imageHeight" INTEGER NOT NULL,
    "areasJson" TEXT NOT NULL DEFAULT '[]',
    "externalRichMenuId" TEXT,
    "frozenAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineOaRichMenuVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineOaLiffApp" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "lineOaAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "viewSize" TEXT NOT NULL DEFAULT 'FULL',
    "endpointUrl" TEXT NOT NULL,
    "scopesJson" TEXT NOT NULL DEFAULT '[]',
    "botPrompt" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "externalLiffId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "LineOaLiffApp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineOaRichMenuJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "richMenuId" TEXT NOT NULL,
    "richMenuVersionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'CREATE',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "transportEpoch" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimantId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "externalRichMenuId" TEXT,
    "providerRequestId" TEXT,
    "errorCode" TEXT,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "LineOaRichMenuJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineConversationJob" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "inboundMessageId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "executionId" TEXT,
    "channelAccountId" TEXT NOT NULL,
    "transportEpoch" INTEGER NOT NULL,
    "executionMode" TEXT NOT NULL,
    "modelAccess" TEXT NOT NULL,
    "audienceKind" TEXT NOT NULL DEFAULT 'DIRECT',
    "allowDelayedPush" BOOLEAN NOT NULL DEFAULT false,
    "recipientId" TEXT NOT NULL,
    "sourceUserId" TEXT NOT NULL,
    "sealedReplyToken" TEXT,
    "replyExpiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "answerText" TEXT,
    "sendMethod" TEXT,
    "retryKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "firstSendAt" TIMESTAMP(3),
    "claimantId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "providerRequestId" TEXT,
    "providerMessageId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "memorySyncOptIn" BOOLEAN NOT NULL DEFAULT false,
    "memoryDeliveryState" TEXT NOT NULL DEFAULT 'NONE',
    "memoryDeliveryAttempts" INTEGER NOT NULL DEFAULT 0,
    "memoryDeliveryNextAttemptAt" TIMESTAMP(3),
    "memoryDeliveryLeaseUntil" TIMESTAMP(3),
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "LineConversationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingPlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MarketingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingPlanVersion" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingPlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingReview" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingDecision" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "reviewId" TEXT,
    "verdict" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingHandoff" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "envelopeHash" TEXT NOT NULL,
    "receiptJson" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingInitiative" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "handoffId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closureReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MarketingInitiative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingContentBrief" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MarketingContentBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingContentVersion" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingContentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingContentReview" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "contentVersionId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "rightsConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "brandConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "reviewerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingContentReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingContentDecision" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "contentVersionId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "reviewId" TEXT,
    "verdict" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingContentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingOperationsIntake" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "requiredAt" TIMESTAMP(3),
    "evidenceReference" TEXT,
    "responsibleOwnerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MarketingOperationsIntake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingBroadcastIntent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNING',
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MarketingBroadcastIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingBroadcastIntentVersion" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingBroadcastIntentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "nameTh" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "slug" TEXT,
    "vibe" TEXT,
    "targetRecipient" TEXT,
    "guardrail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "InventoryCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductFamily" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ProductFamily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Factory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "contact" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Factory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMaster" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "familyId" TEXT,
    "factoryId" TEXT,
    "nameTh" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "baseCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "specsJson" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ProductMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productMasterId" TEXT NOT NULL,
    "name" TEXT,
    "color" TEXT,
    "material" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'EA',
    "stockPolicy" TEXT NOT NULL DEFAULT 'TRACKED',
    "trackingMode" TEXT NOT NULL DEFAULT 'NONE',
    "safetyStock" INTEGER NOT NULL DEFAULT 10,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "itemKind" TEXT NOT NULL DEFAULT 'RAW_COMPONENT',
    "dedicatedCustomerId" TEXT,
    "dedicatedSalesOrderId" TEXT,
    "flowAccountSku" TEXT,
    "maintenanceIntervalDays" INTEGER,
    "maxStorageDays" INTEGER,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductLot" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "factoryId" TEXT,
    "manufacturedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "lastMaintainedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ProductLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SerialUnit" (
    "id" TEXT NOT NULL,
    "serialNo" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_STOCK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SerialUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductBundle" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "targetRecipients" INTEGER,
    "totalPrice" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ProductBundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductBundleItem" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ProductBundleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lotId" TEXT,
    "serialUnitId" TEXT,
    "kind" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "reference" TEXT,
    "actorId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceLocationId" TEXT,
    "targetLocationId" TEXT,
    "costSatang" INTEGER,
    "customerId" TEXT,
    "salesOrderId" TEXT,
    "workOrderId" TEXT,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLedgerFence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "mutationRevision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryLedgerFence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryStocktake" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "normalizedLinesJson" TEXT NOT NULL,
    "snapshotVersion" INTEGER NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEWED',
    "resultJson" TEXT,
    "committedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "InventoryStocktake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductRecipe" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "batchSize" INTEGER NOT NULL,
    "yieldQty" INTEGER NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'EA',
    "notes" TEXT,
    "scrapAllowanceFactor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ProductRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductRecipeLine" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "componentProductId" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "fixed" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,

    CONSTRAINT "ProductRecipeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseLocation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isVirtual" BOOLEAN NOT NULL DEFAULT false,
    "address" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "WarehouseLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomizationWorkOrder" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "salesOrderId" TEXT,
    "customerId" TEXT,
    "rawProductId" TEXT NOT NULL,
    "outputProductId" TEXT,
    "technique" TEXT NOT NULL,
    "logoArtworkUrl" TEXT,
    "pantoneColorsJson" TEXT,
    "plannedQty" INTEGER NOT NULL,
    "issuedQty" INTEGER NOT NULL DEFAULT 0,
    "completedQty" INTEGER NOT NULL DEFAULT 0,
    "scrapQty" INTEGER NOT NULL DEFAULT 0,
    "scrapAllowanceFactor" DOUBLE PRECISION NOT NULL DEFAULT 0.02,
    "setupCostSatang" INTEGER NOT NULL DEFAULT 0,
    "runCostSatang" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "wipLocationId" TEXT,
    "scrapLocationId" TEXT,
    "sourceLocationId" TEXT,
    "scheduledDate" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdByPersonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CustomizationWorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KittingWorkOrder" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "salesOrderId" TEXT,
    "customerId" TEXT,
    "recipeId" TEXT NOT NULL,
    "finishedProductId" TEXT NOT NULL,
    "plannedQty" INTEGER NOT NULL,
    "assembledQty" INTEGER NOT NULL DEFAULT 0,
    "scrapQty" INTEGER NOT NULL DEFAULT 0,
    "laborCostSatang" INTEGER NOT NULL DEFAULT 0,
    "unitCostSatang" INTEGER,
    "plannedLinesJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sourceLocationId" TEXT,
    "wipLocationId" TEXT,
    "targetLocationId" TEXT,
    "scrapLocationId" TEXT,
    "outputLotCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdByPersonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "KittingWorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "customerId" TEXT,
    "salesOrderId" TEXT,
    "quoteReference" TEXT,
    "customerCompany" TEXT,
    "contactHandle" TEXT,
    "notes" TEXT,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "createdByPersonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesTask" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT,
    "conversationId" TEXT,
    "assigneePersonId" TEXT,
    "createdByPersonId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'FOLLOW_UP',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "scheduleKind" TEXT NOT NULL DEFAULT 'SINGLE',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "startDate" TIMESTAMP(3),
    "timeStart" TEXT,
    "timeEnd" TEXT,
    "outcome" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedByPersonId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SalesTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessBillingProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "vatRegistered" BOOLEAN NOT NULL DEFAULT false,
    "vatRateBps" INTEGER,
    "vatTreatment" TEXT,
    "taxPolicyVersion" TEXT,
    "taxEffectiveAt" TIMESTAMP(3),
    "taxVerifiedAt" TIMESTAMP(3),
    "nonVatDocumentPolicy" TEXT,
    "walkInDocumentPolicy" TEXT,
    "promptPayProvider" TEXT,
    "promptPayTargetType" TEXT,
    "promptPayTarget" TEXT,
    "promptPayActive" BOOLEAN NOT NULL DEFAULT false,
    "promptPayVerifiedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessBillingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceDocumentSequence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "calendarYear" INTEGER NOT NULL,
    "lastSequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceDocumentSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "calendarYear" INTEGER NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedByPersonId" TEXT,
    "snapshotJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT,
    "conversationId" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'WALK_IN',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "discountSatang" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "stockIssuedAt" TIMESTAMP(3),
    "closedByPersonId" TEXT,
    "createdByPersonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPriceSatang" INTEGER NOT NULL,
    "discountSatang" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SalesOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PAYMENT',
    "method" TEXT NOT NULL,
    "amountSatang" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "bankReference" TEXT,
    "slipFileAssetId" TEXT,
    "note" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByPersonId" TEXT,
    "rejectReason" TEXT,
    "createdByPersonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "paymentTerms" TEXT,
    "leadTimeDays" INTEGER,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "expectedAt" TIMESTAMP(3),
    "notes" TEXT,
    "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdByPersonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitCostSatang" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "supplierReference" TEXT,
    "notes" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedByPersonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "lotCode" TEXT,
    "expiresAt" TIMESTAMP(3),
    "serialNosJson" TEXT,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "LegalEntity_tenantId_idx" ON "LegalEntity"("tenantId");

-- CreateIndex
CREATE INDEX "LegalEntityIdentifier_legalEntityId_idx" ON "LegalEntityIdentifier"("legalEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalEntityIdentifier_country_type_value_key" ON "LegalEntityIdentifier"("country", "type", "value");

-- CreateIndex
CREATE INDEX "TaxRegistrationBranch_legalEntityId_idx" ON "TaxRegistrationBranch"("legalEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRegistrationBranch_legalEntityId_branchCode_key" ON "TaxRegistrationBranch"("legalEntityId", "branchCode");

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
CREATE INDEX "Branch_taxRegistrationBranchId_idx" ON "Branch"("taxRegistrationBranchId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_code_key" ON "Person"("code");

-- CreateIndex
CREATE INDEX "PlatformGrant_capability_status_idx" ON "PlatformGrant"("capability", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformGrant_personId_capability_key" ON "PlatformGrant"("personId", "capability");

-- CreateIndex
CREATE INDEX "WorkspaceMembership_personId_status_idx" ON "WorkspaceMembership"("personId", "status");

-- CreateIndex
CREATE INDEX "WorkspaceMembership_portfolioId_status_idx" ON "WorkspaceMembership"("portfolioId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMembership_portfolioId_personId_key" ON "WorkspaceMembership"("portfolioId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceInvite_tokenHash_key" ON "WorkspaceInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "WorkspaceInvite_portfolioId_status_idx" ON "WorkspaceInvite"("portfolioId", "status");

-- CreateIndex
CREATE INDEX "WorkspaceInvite_targetPersonId_status_idx" ON "WorkspaceInvite"("targetPersonId", "status");

-- CreateIndex
CREATE INDEX "WorkspaceInvite_invitedEmail_status_idx" ON "WorkspaceInvite"("invitedEmail", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PersonCredential_personId_key" ON "PersonCredential"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "PasswordResetToken_personId_idx" ON "PasswordResetToken"("personId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_token_idx" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "PluginInstallation_installationId_key" ON "PluginInstallation"("installationId");

-- CreateIndex
CREATE INDEX "PluginInstallation_clientId_status_idx" ON "PluginInstallation"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PluginAuthorizationCode_codeHash_key" ON "PluginAuthorizationCode"("codeHash");

-- CreateIndex
CREATE INDEX "PluginAuthorizationCode_pluginInstallationId_expiresAt_idx" ON "PluginAuthorizationCode"("pluginInstallationId", "expiresAt");

-- CreateIndex
CREATE INDEX "PluginAuthorizationCode_personId_expiresAt_idx" ON "PluginAuthorizationCode"("personId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PluginSession_tokenHash_key" ON "PluginSession"("tokenHash");

-- CreateIndex
CREATE INDEX "PluginSession_pluginInstallationId_expiresAt_idx" ON "PluginSession"("pluginInstallationId", "expiresAt");

-- CreateIndex
CREATE INDEX "PluginSession_personId_expiresAt_idx" ON "PluginSession"("personId", "expiresAt");

-- CreateIndex
CREATE INDEX "PluginSession_authorizationCodeId_idx" ON "PluginSession"("authorizationCodeId");

-- CreateIndex
CREATE INDEX "Membership_personId_idx" ON "Membership"("personId");

-- CreateIndex
CREATE INDEX "Membership_personId_status_idx" ON "Membership"("personId", "status");

-- CreateIndex
CREATE INDEX "Membership_tenantId_idx" ON "Membership"("tenantId");

-- CreateIndex
CREATE INDEX "Membership_tenantId_status_idx" ON "Membership"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Membership_businessId_status_idx" ON "Membership"("businessId", "status");

-- CreateIndex
CREATE INDEX "Membership_expiresAt_status_idx" ON "Membership"("expiresAt", "status");

-- CreateIndex
CREATE INDEX "Employment_personId_idx" ON "Employment"("personId");

-- CreateIndex
CREATE INDEX "Employment_tenantId_idx" ON "Employment"("tenantId");

-- CreateIndex
CREATE INDEX "Employment_businessId_status_idx" ON "Employment"("businessId", "status");

-- CreateIndex
CREATE INDEX "Employment_branchId_idx" ON "Employment"("branchId");

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
CREATE UNIQUE INDEX "RegisteredAsset_intakeId_key" ON "RegisteredAsset"("intakeId");

-- CreateIndex
CREATE INDEX "RegisteredAsset_tenantId_businessId_status_idx" ON "RegisteredAsset"("tenantId", "businessId", "status");

-- CreateIndex
CREATE INDEX "RegisteredAsset_businessId_serialNumber_idx" ON "RegisteredAsset"("businessId", "serialNumber");

-- CreateIndex
CREATE INDEX "RegisteredAsset_lotId_idx" ON "RegisteredAsset"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "RegisteredAsset_businessId_assetCode_key" ON "RegisteredAsset"("businessId", "assetCode");

-- CreateIndex
CREATE INDEX "AssetIntake_tenantId_businessId_status_idx" ON "AssetIntake"("tenantId", "businessId", "status");

-- CreateIndex
CREATE INDEX "AssetIntake_businessId_payloadSha256_idx" ON "AssetIntake"("businessId", "payloadSha256");

-- CreateIndex
CREATE INDEX "AssetIntake_pipelineRunId_idx" ON "AssetIntake"("pipelineRunId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetIntake_businessId_intakeCode_key" ON "AssetIntake"("businessId", "intakeCode");

-- CreateIndex
CREATE UNIQUE INDEX "AssetIntake_businessId_sourceChannel_sourceCorrelationId_key" ON "AssetIntake"("businessId", "sourceChannel", "sourceCorrelationId");

-- CreateIndex
CREATE INDEX "AssetEvidence_tenantId_businessId_status_idx" ON "AssetEvidence"("tenantId", "businessId", "status");

-- CreateIndex
CREATE INDEX "AssetEvidence_registeredAssetId_idx" ON "AssetEvidence"("registeredAssetId");

-- CreateIndex
CREATE INDEX "AssetEvidence_businessId_sha256_idx" ON "AssetEvidence"("businessId", "sha256");

-- CreateIndex
CREATE INDEX "AssetEvidence_businessId_paymentReference_idx" ON "AssetEvidence"("businessId", "paymentReference");

-- CreateIndex
CREATE UNIQUE INDEX "AssetEvidence_intakeId_fileAssetId_role_key" ON "AssetEvidence"("intakeId", "fileAssetId", "role");

-- CreateIndex
CREATE INDEX "AssetProcurementRef_tenantId_businessId_type_idx" ON "AssetProcurementRef"("tenantId", "businessId", "type");

-- CreateIndex
CREATE INDEX "AssetProcurementRef_registeredAssetId_idx" ON "AssetProcurementRef"("registeredAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetProcurementRef_intakeId_type_system_value_lineValue_key" ON "AssetProcurementRef"("intakeId", "type", "system", "value", "lineValue");

-- CreateIndex
CREATE INDEX "AssetLot_tenantId_businessId_expiresOn_idx" ON "AssetLot"("tenantId", "businessId", "expiresOn");

-- CreateIndex
CREATE UNIQUE INDEX "AssetLot_businessId_lotCode_key" ON "AssetLot"("businessId", "lotCode");

-- CreateIndex
CREATE INDEX "AssetResponsibility_tenantId_businessId_role_idx" ON "AssetResponsibility"("tenantId", "businessId", "role");

-- CreateIndex
CREATE INDEX "AssetResponsibility_registeredAssetId_role_effectiveTo_idx" ON "AssetResponsibility"("registeredAssetId", "role", "effectiveTo");

-- CreateIndex
CREATE INDEX "AssetResponsibility_personId_effectiveTo_idx" ON "AssetResponsibility"("personId", "effectiveTo");

-- CreateIndex
CREATE INDEX "AssetLocationHistory_tenantId_businessId_effectiveTo_idx" ON "AssetLocationHistory"("tenantId", "businessId", "effectiveTo");

-- CreateIndex
CREATE INDEX "AssetLocationHistory_registeredAssetId_isPrimary_effectiveT_idx" ON "AssetLocationHistory"("registeredAssetId", "isPrimary", "effectiveTo");

-- CreateIndex
CREATE INDEX "AssetLocationHistory_branchId_idx" ON "AssetLocationHistory"("branchId");

-- CreateIndex
CREATE INDEX "AssetProjectAllocation_tenantId_businessId_status_idx" ON "AssetProjectAllocation"("tenantId", "businessId", "status");

-- CreateIndex
CREATE INDEX "AssetProjectAllocation_registeredAssetId_exclusive_effectiv_idx" ON "AssetProjectAllocation"("registeredAssetId", "exclusive", "effectiveTo");

-- CreateIndex
CREATE INDEX "AssetProjectAllocation_projectId_effectiveTo_idx" ON "AssetProjectAllocation"("projectId", "effectiveTo");

-- CreateIndex
CREATE INDEX "AssetProjectAllocation_workstreamId_idx" ON "AssetProjectAllocation"("workstreamId");

-- CreateIndex
CREATE INDEX "AssetDepreciationCandidate_tenantId_businessId_status_idx" ON "AssetDepreciationCandidate"("tenantId", "businessId", "status");

-- CreateIndex
CREATE INDEX "AssetDepreciationCandidate_intakeId_idx" ON "AssetDepreciationCandidate"("intakeId");

-- CreateIndex
CREATE INDEX "AssetDepreciationCandidate_registeredAssetId_idx" ON "AssetDepreciationCandidate"("registeredAssetId");

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
CREATE UNIQUE INDEX "Conversation_account_thread_key" ON "Conversation"("tenantId", "channel", "channelAccountId", "externalThreadId");

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_conversationId_externalMessageId_key" ON "Message"("conversationId", "externalMessageId");

-- CreateIndex
CREATE INDEX "ConversationAnalysis_conversationId_analyzedDate_idx" ON "ConversationAnalysis"("conversationId", "analyzedDate");

-- CreateIndex
CREATE INDEX "ConversationAnalysis_analyzedDate_idx" ON "ConversationAnalysis"("analyzedDate");

-- CreateIndex
CREATE INDEX "ConversationAnalysis_contactType_idx" ON "ConversationAnalysis"("contactType");

-- CreateIndex
CREATE INDEX "ConversationAnalysis_state_idx" ON "ConversationAnalysis"("state");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_occurredAt_idx" ON "AuditEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "AgentTraceEvent_tenantId_businessId_turnId_occurredAt_idx" ON "AgentTraceEvent"("tenantId", "businessId", "turnId", "occurredAt");

-- CreateIndex
CREATE INDEX "AgentTraceEvent_tenantId_businessId_turnId_createdAt_idx" ON "AgentTraceEvent"("tenantId", "businessId", "turnId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTraceEvent_scope_idempotency_key" ON "AgentTraceEvent"("tenantId", "businessId", "idempotencyKey");

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
CREATE INDEX "KnowledgeEvidenceCursor_tenantId_idx" ON "KnowledgeEvidenceCursor"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeEvidenceCursor_portfolioId_tenantId_businessId_wor_key" ON "KnowledgeEvidenceCursor"("portfolioId", "tenantId", "businessId", "workspaceId", "projectId", "sharing");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeRawArtifact_rawExternalRecordId_key" ON "KnowledgeRawArtifact"("rawExternalRecordId");

-- CreateIndex
CREATE INDEX "KnowledgeRawArtifact_tenantId_documentId_version_idx" ON "KnowledgeRawArtifact"("tenantId", "documentId", "version");

-- CreateIndex
CREATE INDEX "KnowledgeRawArtifact_tenantId_contentHash_idx" ON "KnowledgeRawArtifact"("tenantId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeRawArtifact_portfolioId_tenantId_businessId_worksp_key" ON "KnowledgeRawArtifact"("portfolioId", "tenantId", "businessId", "workspaceId", "agentId", "visibility", "sourceId", "version", "contentHash", "pipelineVersion");

-- CreateIndex
CREATE INDEX "KnowledgeParsedArtifact_tenantId_documentId_idx" ON "KnowledgeParsedArtifact"("tenantId", "documentId");

-- CreateIndex
CREATE INDEX "KnowledgeParsedArtifact_rawArtifactId_idx" ON "KnowledgeParsedArtifact"("rawArtifactId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeParsedArtifact_rawArtifactId_parserVersion_key" ON "KnowledgeParsedArtifact"("rawArtifactId", "parserVersion");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_tenantId_documentId_ordinal_idx" ON "KnowledgeChunk"("tenantId", "documentId", "ordinal");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_parsedArtifactId_idx" ON "KnowledgeChunk"("parsedArtifactId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeChunk_parsedArtifactId_ordinal_key" ON "KnowledgeChunk"("parsedArtifactId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "GenesisRag17IngestionIntent_intentKey_key" ON "GenesisRag17IngestionIntent"("intentKey");

-- CreateIndex
CREATE UNIQUE INDEX "GenesisRag17IngestionIntent_executionRunId_key" ON "GenesisRag17IngestionIntent"("executionRunId");

-- CreateIndex
CREATE INDEX "GenesisRag17IngestionIntent_tenantId_status_idx" ON "GenesisRag17IngestionIntent"("tenantId", "status");

-- CreateIndex
CREATE INDEX "GenesisRag17IngestionIntent_executionRunId_status_idx" ON "GenesisRag17IngestionIntent"("executionRunId", "status");

-- CreateIndex
CREATE INDEX "GenesisRag17SourceMention_tenantId_parsedArtifactId_idx" ON "GenesisRag17SourceMention"("tenantId", "parsedArtifactId");

-- CreateIndex
CREATE INDEX "GenesisRag17SourceMention_executionRunId_attemptId_idx" ON "GenesisRag17SourceMention"("executionRunId", "attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "GenesisRag17SourceMention_executionRunId_attemptId_sourceMe_key" ON "GenesisRag17SourceMention"("executionRunId", "attemptId", "sourceMentionId");

-- CreateIndex
CREATE UNIQUE INDEX "GenesisRag17Batch_batchId_key" ON "GenesisRag17Batch"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "GenesisRag17Batch_idempotencyKey_key" ON "GenesisRag17Batch"("idempotencyKey");

-- CreateIndex
CREATE INDEX "GenesisRag17Batch_runId_status_idx" ON "GenesisRag17Batch"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GenesisRag17Batch_executionRunId_stage9AttemptId_key" ON "GenesisRag17Batch"("executionRunId", "stage9AttemptId");

-- CreateIndex
CREATE INDEX "GenesisRag17StageEvidence_runId_stageNumber_idx" ON "GenesisRag17StageEvidence"("runId", "stageNumber");

-- CreateIndex
CREATE INDEX "GenesisRag17StageEvidence_executionRunId_cursor_idx" ON "GenesisRag17StageEvidence"("executionRunId", "cursor");

-- CreateIndex
CREATE UNIQUE INDEX "GenesisRag17StageEvidence_executionRunId_pipelineStageId_ex_key" ON "GenesisRag17StageEvidence"("executionRunId", "pipelineStageId", "executionStepId", "attemptId");

-- CreateIndex
CREATE INDEX "GenesisRag17PublicationReceipt_runId_snapshotId_generation_idx" ON "GenesisRag17PublicationReceipt"("runId", "snapshotId", "generation");

-- CreateIndex
CREATE UNIQUE INDEX "GenesisRag17PublicationReceipt_executionRunId_decisionId_de_key" ON "GenesisRag17PublicationReceipt"("executionRunId", "decisionId", "decisionHash", "snapshotId", "generation", "receiptHash");

-- CreateIndex
CREATE INDEX "GenesisRag17EvidenceCursor_tenantId_idx" ON "GenesisRag17EvidenceCursor"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "GenesisRag17EvidenceCursor_runId_portfolioId_tenantId_busin_key" ON "GenesisRag17EvidenceCursor"("runId", "portfolioId", "tenantId", "businessId", "workspaceId", "agentId", "visibility");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeCorpus_corpusKey_key" ON "KnowledgeCorpus"("corpusKey");

-- CreateIndex
CREATE INDEX "KnowledgeCorpus_tenantId_businessId_projectId_idx" ON "KnowledgeCorpus"("tenantId", "businessId", "projectId");

-- CreateIndex
CREATE INDEX "KnowledgeSource_fileAssetId_idx" ON "KnowledgeSource"("fileAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeSource_corpusId_sourceKey_key" ON "KnowledgeSource"("corpusId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeIngestion_idempotencyKey_key" ON "KnowledgeIngestion"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeIngestion_executionRunId_key" ON "KnowledgeIngestion"("executionRunId");

-- CreateIndex
CREATE INDEX "KnowledgeIngestion_status_leaseExpiresAt_createdAt_idx" ON "KnowledgeIngestion"("status", "leaseExpiresAt", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeIngestion_corpusId_createdAt_idx" ON "KnowledgeIngestion"("corpusId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeIngestion_sourceId_sourceVersion_key" ON "KnowledgeIngestion"("sourceId", "sourceVersion");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeCorpusGeneration_corpusId_number_key" ON "KnowledgeCorpusGeneration"("corpusId", "number");

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
CREATE INDEX "RawExternalRecord_artifactId_idx" ON "RawExternalRecord"("artifactId");

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

-- CreateIndex
CREATE UNIQUE INDEX "EdgeDeviceCredential_keyHash_key" ON "EdgeDeviceCredential"("keyHash");

-- CreateIndex
CREATE INDEX "EdgeDeviceCredential_businessId_status_idx" ON "EdgeDeviceCredential"("businessId", "status");

-- CreateIndex
CREATE INDEX "EdgeDeviceCredential_businessId_deviceId_idx" ON "EdgeDeviceCredential"("businessId", "deviceId");

-- CreateIndex
CREATE INDEX "AssetExtractionJob_businessId_status_createdAt_idx" ON "AssetExtractionJob"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AssetExtractionJob_evidenceId_status_idx" ON "AssetExtractionJob"("evidenceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LineOaAccount_integrationConnectionId_key" ON "LineOaAccount"("integrationConnectionId");

-- CreateIndex
CREATE INDEX "LineOaAccount_businessId_status_idx" ON "LineOaAccount"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LineOaAccount_tenantId_code_key" ON "LineOaAccount"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LineOaAccount_tenantId_bindingCode_key" ON "LineOaAccount"("tenantId", "bindingCode");

-- CreateIndex
CREATE INDEX "LineOaRichMenu_lineOaAccountId_status_idx" ON "LineOaRichMenu"("lineOaAccountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LineOaRichMenu_tenantId_code_key" ON "LineOaRichMenu"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LineOaRichMenu_lineOaAccountId_alias_key" ON "LineOaRichMenu"("lineOaAccountId", "alias");

-- CreateIndex
CREATE INDEX "LineOaRichMenuVersion_lineOaAccountId_status_idx" ON "LineOaRichMenuVersion"("lineOaAccountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LineOaRichMenuVersion_richMenuId_versionNumber_key" ON "LineOaRichMenuVersion"("richMenuId", "versionNumber");

-- CreateIndex
CREATE INDEX "LineOaLiffApp_lineOaAccountId_status_idx" ON "LineOaLiffApp"("lineOaAccountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LineOaLiffApp_tenantId_code_key" ON "LineOaLiffApp"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LineOaLiffApp_lineOaAccountId_externalLiffId_key" ON "LineOaLiffApp"("lineOaAccountId", "externalLiffId");

-- CreateIndex
CREATE INDEX "LineOaRichMenuJob_status_availableAt_idx" ON "LineOaRichMenuJob"("status", "availableAt");

-- CreateIndex
CREATE INDEX "LineOaRichMenuJob_accountId_status_idx" ON "LineOaRichMenuJob"("accountId", "status");

-- CreateIndex
CREATE INDEX "LineOaRichMenuJob_richMenuId_status_idx" ON "LineOaRichMenuJob"("richMenuId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LineConversationJob_inboundMessageId_key" ON "LineConversationJob"("inboundMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "LineConversationJob_retryKey_key" ON "LineConversationJob"("retryKey");

-- CreateIndex
CREATE INDEX "LineConversationJob_status_executionMode_availableAt_idx" ON "LineConversationJob"("status", "executionMode", "availableAt");

-- CreateIndex
CREATE INDEX "LineConversationJob_tenantId_businessId_status_idx" ON "LineConversationJob"("tenantId", "businessId", "status");

-- CreateIndex
CREATE INDEX "LineConversationJob_memoryDeliveryState_memoryDeliveryNextA_idx" ON "LineConversationJob"("memoryDeliveryState", "memoryDeliveryNextAttemptAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LineConversationJob_accountId_eventId_key" ON "LineConversationJob"("accountId", "eventId");

-- CreateIndex
CREATE INDEX "MarketingPlan_tenantId_businessId_status_idx" ON "MarketingPlan"("tenantId", "businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingPlan_businessId_code_key" ON "MarketingPlan"("businessId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingPlanVersion_planId_revision_key" ON "MarketingPlanVersion"("planId", "revision");

-- CreateIndex
CREATE INDEX "MarketingReview_planId_createdAt_idx" ON "MarketingReview"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingDecision_planId_createdAt_idx" ON "MarketingDecision"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingHandoff_planId_idx" ON "MarketingHandoff"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingHandoff_planVersionId_workspaceId_key" ON "MarketingHandoff"("planVersionId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingInitiative_planId_key" ON "MarketingInitiative"("planId");

-- CreateIndex
CREATE INDEX "MarketingInitiative_tenantId_businessId_status_idx" ON "MarketingInitiative"("tenantId", "businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingInitiative_businessId_code_key" ON "MarketingInitiative"("businessId", "code");

-- CreateIndex
CREATE INDEX "MarketingContentBrief_tenantId_businessId_status_idx" ON "MarketingContentBrief"("tenantId", "businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingContentBrief_businessId_code_key" ON "MarketingContentBrief"("businessId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingContentVersion_briefId_revision_key" ON "MarketingContentVersion"("briefId", "revision");

-- CreateIndex
CREATE INDEX "MarketingContentReview_briefId_createdAt_idx" ON "MarketingContentReview"("briefId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingContentReview_briefId_sequence_key" ON "MarketingContentReview"("briefId", "sequence");

-- CreateIndex
CREATE INDEX "MarketingContentDecision_briefId_createdAt_idx" ON "MarketingContentDecision"("briefId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingContentDecision_briefId_sequence_key" ON "MarketingContentDecision"("briefId", "sequence");

-- CreateIndex
CREATE INDEX "MarketingOperationsIntake_tenantId_businessId_status_idx" ON "MarketingOperationsIntake"("tenantId", "businessId", "status");

-- CreateIndex
CREATE INDEX "MarketingOperationsIntake_businessId_requiredAt_idx" ON "MarketingOperationsIntake"("businessId", "requiredAt");

-- CreateIndex
CREATE INDEX "MarketingBroadcastIntent_tenantId_businessId_status_idx" ON "MarketingBroadcastIntent"("tenantId", "businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingBroadcastIntent_businessId_idempotencyKey_key" ON "MarketingBroadcastIntent"("businessId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingBroadcastIntent_businessId_code_key" ON "MarketingBroadcastIntent"("businessId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingBroadcastIntentVersion_intentId_revision_key" ON "MarketingBroadcastIntentVersion"("intentId", "revision");

-- CreateIndex
CREATE INDEX "InventoryCategory_businessId_status_idx" ON "InventoryCategory"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCategory_tenantId_code_key" ON "InventoryCategory"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCategory_businessId_slug_key" ON "InventoryCategory"("businessId", "slug");

-- CreateIndex
CREATE INDEX "ProductFamily_businessId_status_idx" ON "ProductFamily"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductFamily_tenantId_code_key" ON "ProductFamily"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Factory_businessId_status_idx" ON "Factory"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Factory_tenantId_code_key" ON "Factory"("tenantId", "code");

-- CreateIndex
CREATE INDEX "ProductMaster_businessId_status_idx" ON "ProductMaster"("businessId", "status");

-- CreateIndex
CREATE INDEX "ProductMaster_categoryId_idx" ON "ProductMaster"("categoryId");

-- CreateIndex
CREATE INDEX "ProductMaster_familyId_idx" ON "ProductMaster"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMaster_tenantId_code_key" ON "ProductMaster"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Product_businessId_status_idx" ON "Product"("businessId", "status");

-- CreateIndex
CREATE INDEX "Product_productMasterId_idx" ON "Product"("productMasterId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_code_key" ON "Product"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_flowAccountSku_key" ON "Product"("tenantId", "flowAccountSku");

-- CreateIndex
CREATE INDEX "ProductLot_businessId_status_idx" ON "ProductLot"("businessId", "status");

-- CreateIndex
CREATE INDEX "ProductLot_factoryId_idx" ON "ProductLot"("factoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductLot_productId_code_key" ON "ProductLot"("productId", "code");

-- CreateIndex
CREATE INDEX "SerialUnit_businessId_status_idx" ON "SerialUnit"("businessId", "status");

-- CreateIndex
CREATE INDEX "SerialUnit_lotId_idx" ON "SerialUnit"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "SerialUnit_productId_serialNo_key" ON "SerialUnit"("productId", "serialNo");

-- CreateIndex
CREATE INDEX "ProductBundle_businessId_status_idx" ON "ProductBundle"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductBundle_tenantId_code_key" ON "ProductBundle"("tenantId", "code");

-- CreateIndex
CREATE INDEX "ProductBundleItem_productId_idx" ON "ProductBundleItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductBundleItem_bundleId_productId_key" ON "ProductBundleItem"("bundleId", "productId");

-- CreateIndex
CREATE INDEX "StockMovement_productId_occurredAt_idx" ON "StockMovement"("productId", "occurredAt");

-- CreateIndex
CREATE INDEX "StockMovement_businessId_occurredAt_idx" ON "StockMovement"("businessId", "occurredAt");

-- CreateIndex
CREATE INDEX "StockMovement_lotId_idx" ON "StockMovement"("lotId");

-- CreateIndex
CREATE INDEX "StockMovement_serialUnitId_idx" ON "StockMovement"("serialUnitId");

-- CreateIndex
CREATE INDEX "StockMovement_sourceLocationId_idx" ON "StockMovement"("sourceLocationId");

-- CreateIndex
CREATE INDEX "StockMovement_targetLocationId_idx" ON "StockMovement"("targetLocationId");

-- CreateIndex
CREATE INDEX "StockMovement_workOrderId_idx" ON "StockMovement"("workOrderId");

-- CreateIndex
CREATE INDEX "StockMovement_salesOrderId_idx" ON "StockMovement"("salesOrderId");

-- CreateIndex
CREATE INDEX "InventoryLedgerFence_businessId_idx" ON "InventoryLedgerFence"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLedgerFence_tenantId_businessId_key" ON "InventoryLedgerFence"("tenantId", "businessId");

-- CreateIndex
CREATE INDEX "InventoryStocktake_businessId_status_createdAt_idx" ON "InventoryStocktake"("businessId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryStocktake_tenantId_businessId_idempotencyKey_key" ON "InventoryStocktake"("tenantId", "businessId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ProductRecipe_businessId_status_idx" ON "ProductRecipe"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductRecipe_tenantId_code_key" ON "ProductRecipe"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ProductRecipe_productId_batchSize_key" ON "ProductRecipe"("productId", "batchSize");

-- CreateIndex
CREATE INDEX "ProductRecipeLine_componentProductId_idx" ON "ProductRecipeLine"("componentProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductRecipeLine_recipeId_componentProductId_key" ON "ProductRecipeLine"("recipeId", "componentProductId");

-- CreateIndex
CREATE INDEX "WarehouseLocation_businessId_type_idx" ON "WarehouseLocation"("businessId", "type");

-- CreateIndex
CREATE INDEX "WarehouseLocation_businessId_status_idx" ON "WarehouseLocation"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseLocation_tenantId_code_key" ON "WarehouseLocation"("tenantId", "code");

-- CreateIndex
CREATE INDEX "CustomizationWorkOrder_businessId_status_idx" ON "CustomizationWorkOrder"("businessId", "status");

-- CreateIndex
CREATE INDEX "CustomizationWorkOrder_salesOrderId_idx" ON "CustomizationWorkOrder"("salesOrderId");

-- CreateIndex
CREATE INDEX "CustomizationWorkOrder_customerId_idx" ON "CustomizationWorkOrder"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomizationWorkOrder_tenantId_code_key" ON "CustomizationWorkOrder"("tenantId", "code");

-- CreateIndex
CREATE INDEX "KittingWorkOrder_businessId_status_idx" ON "KittingWorkOrder"("businessId", "status");

-- CreateIndex
CREATE INDEX "KittingWorkOrder_salesOrderId_idx" ON "KittingWorkOrder"("salesOrderId");

-- CreateIndex
CREATE INDEX "KittingWorkOrder_recipeId_idx" ON "KittingWorkOrder"("recipeId");

-- CreateIndex
CREATE UNIQUE INDEX "KittingWorkOrder_tenantId_code_key" ON "KittingWorkOrder"("tenantId", "code");

-- CreateIndex
CREATE INDEX "StockReservation_businessId_status_idx" ON "StockReservation"("businessId", "status");

-- CreateIndex
CREATE INDEX "StockReservation_productId_status_idx" ON "StockReservation"("productId", "status");

-- CreateIndex
CREATE INDEX "StockReservation_expiresAt_idx" ON "StockReservation"("expiresAt");

-- CreateIndex
CREATE INDEX "StockReservation_salesOrderId_idx" ON "StockReservation"("salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "StockReservation_tenantId_code_key" ON "StockReservation"("tenantId", "code");

-- CreateIndex
CREATE INDEX "SalesTask_businessId_status_dueDate_idx" ON "SalesTask"("businessId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "SalesTask_assigneePersonId_status_idx" ON "SalesTask"("assigneePersonId", "status");

-- CreateIndex
CREATE INDEX "SalesTask_customerId_idx" ON "SalesTask"("customerId");

-- CreateIndex
CREATE INDEX "SalesTask_conversationId_idx" ON "SalesTask"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesTask_tenantId_code_key" ON "SalesTask"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessBillingProfile_businessId_key" ON "BusinessBillingProfile"("businessId");

-- CreateIndex
CREATE INDEX "BusinessBillingProfile_tenantId_idx" ON "BusinessBillingProfile"("tenantId");

-- CreateIndex
CREATE INDEX "CommerceDocumentSequence_tenantId_businessId_idx" ON "CommerceDocumentSequence"("tenantId", "businessId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceDocumentSequence_businessId_documentType_calendarYe_key" ON "CommerceDocumentSequence"("businessId", "documentType", "calendarYear");

-- CreateIndex
CREATE INDEX "CommerceDocument_businessId_orderId_issuedAt_idx" ON "CommerceDocument"("businessId", "orderId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceDocument_businessId_idempotencyKey_key" ON "CommerceDocument"("businessId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceDocument_businessId_documentNumber_key" ON "CommerceDocument"("businessId", "documentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceDocument_businessId_documentType_calendarYear_seque_key" ON "CommerceDocument"("businessId", "documentType", "calendarYear", "sequenceNumber");

-- CreateIndex
CREATE INDEX "SalesOrder_businessId_status_orderedAt_idx" ON "SalesOrder"("businessId", "status", "orderedAt");

-- CreateIndex
CREATE INDEX "SalesOrder_customerId_idx" ON "SalesOrder"("customerId");

-- CreateIndex
CREATE INDEX "SalesOrder_conversationId_idx" ON "SalesOrder"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_tenantId_code_key" ON "SalesOrder"("tenantId", "code");

-- CreateIndex
CREATE INDEX "SalesOrderLine_orderId_idx" ON "SalesOrderLine"("orderId");

-- CreateIndex
CREATE INDEX "SalesOrderLine_productId_idx" ON "SalesOrderLine"("productId");

-- CreateIndex
CREATE INDEX "Payment_orderId_status_idx" ON "Payment"("orderId", "status");

-- CreateIndex
CREATE INDEX "Payment_businessId_status_paidAt_idx" ON "Payment"("businessId", "status", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_tenantId_code_key" ON "Payment"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_tenantId_bankReference_key" ON "Payment"("tenantId", "bankReference");

-- CreateIndex
CREATE INDEX "Supplier_businessId_status_idx" ON "Supplier"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_tenantId_code_key" ON "Supplier"("tenantId", "code");

-- CreateIndex
CREATE INDEX "PurchaseOrder_businessId_status_orderedAt_idx" ON "PurchaseOrder"("businessId", "status", "orderedAt");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_tenantId_code_key" ON "PurchaseOrder"("tenantId", "code");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_purchaseOrderId_idx" ON "PurchaseOrderLine"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_productId_idx" ON "PurchaseOrderLine"("productId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_purchaseOrderId_idx" ON "GoodsReceipt"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_businessId_receivedAt_idx" ON "GoodsReceipt"("businessId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_tenantId_code_key" ON "GoodsReceipt"("tenantId", "code");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_receiptId_idx" ON "GoodsReceiptLine"("receiptId");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_purchaseOrderLineId_idx" ON "GoodsReceiptLine"("purchaseOrderLineId");

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalEntity" ADD CONSTRAINT "LegalEntity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalEntityIdentifier" ADD CONSTRAINT "LegalEntityIdentifier_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRegistrationBranch" ADD CONSTRAINT "TaxRegistrationBranch_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Business" ADD CONSTRAINT "Business_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Business" ADD CONSTRAINT "Business_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_taxRegistrationBranchId_fkey" FOREIGN KEY ("taxRegistrationBranchId") REFERENCES "TaxRegistrationBranch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformGrant" ADD CONSTRAINT "PlatformGrant_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformGrant" ADD CONSTRAINT "PlatformGrant_grantedByPersonId_fkey" FOREIGN KEY ("grantedByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_invitedByPersonId_fkey" FOREIGN KEY ("invitedByPersonId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonCredential" ADD CONSTRAINT "PersonCredential_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluginAuthorizationCode" ADD CONSTRAINT "PluginAuthorizationCode_pluginInstallationId_fkey" FOREIGN KEY ("pluginInstallationId") REFERENCES "PluginInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluginAuthorizationCode" ADD CONSTRAINT "PluginAuthorizationCode_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluginSession" ADD CONSTRAINT "PluginSession_pluginInstallationId_fkey" FOREIGN KEY ("pluginInstallationId") REFERENCES "PluginInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluginSession" ADD CONSTRAINT "PluginSession_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_grantedByPersonId_fkey" FOREIGN KEY ("grantedByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_revokedByPersonId_fkey" FOREIGN KEY ("revokedByPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "RegisteredAsset" ADD CONSTRAINT "RegisteredAsset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisteredAsset" ADD CONSTRAINT "RegisteredAsset_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisteredAsset" ADD CONSTRAINT "RegisteredAsset_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "AssetIntake"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisteredAsset" ADD CONSTRAINT "RegisteredAsset_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "AssetLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetIntake" ADD CONSTRAINT "AssetIntake_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetIntake" ADD CONSTRAINT "AssetIntake_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetEvidence" ADD CONSTRAINT "AssetEvidence_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "AssetIntake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetEvidence" ADD CONSTRAINT "AssetEvidence_registeredAssetId_fkey" FOREIGN KEY ("registeredAssetId") REFERENCES "RegisteredAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetEvidence" ADD CONSTRAINT "AssetEvidence_fileAssetId_fkey" FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetProcurementRef" ADD CONSTRAINT "AssetProcurementRef_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "AssetIntake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetProcurementRef" ADD CONSTRAINT "AssetProcurementRef_registeredAssetId_fkey" FOREIGN KEY ("registeredAssetId") REFERENCES "RegisteredAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetLot" ADD CONSTRAINT "AssetLot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetLot" ADD CONSTRAINT "AssetLot_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetResponsibility" ADD CONSTRAINT "AssetResponsibility_registeredAssetId_fkey" FOREIGN KEY ("registeredAssetId") REFERENCES "RegisteredAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetResponsibility" ADD CONSTRAINT "AssetResponsibility_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetLocationHistory" ADD CONSTRAINT "AssetLocationHistory_registeredAssetId_fkey" FOREIGN KEY ("registeredAssetId") REFERENCES "RegisteredAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetLocationHistory" ADD CONSTRAINT "AssetLocationHistory_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetProjectAllocation" ADD CONSTRAINT "AssetProjectAllocation_registeredAssetId_fkey" FOREIGN KEY ("registeredAssetId") REFERENCES "RegisteredAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetProjectAllocation" ADD CONSTRAINT "AssetProjectAllocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetProjectAllocation" ADD CONSTRAINT "AssetProjectAllocation_workstreamId_fkey" FOREIGN KEY ("workstreamId") REFERENCES "Workstream"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetDepreciationCandidate" ADD CONSTRAINT "AssetDepreciationCandidate_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "AssetIntake"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetDepreciationCandidate" ADD CONSTRAINT "AssetDepreciationCandidate_registeredAssetId_fkey" FOREIGN KEY ("registeredAssetId") REFERENCES "RegisteredAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "ConversationAnalysis" ADD CONSTRAINT "ConversationAnalysis_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "KnowledgeRawArtifact" ADD CONSTRAINT "KnowledgeRawArtifact_rawExternalRecordId_fkey" FOREIGN KEY ("rawExternalRecordId") REFERENCES "RawExternalRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeParsedArtifact" ADD CONSTRAINT "KnowledgeParsedArtifact_rawArtifactId_fkey" FOREIGN KEY ("rawArtifactId") REFERENCES "KnowledgeRawArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_parsedArtifactId_fkey" FOREIGN KEY ("parsedArtifactId") REFERENCES "KnowledgeParsedArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_corpusId_fkey" FOREIGN KEY ("corpusId") REFERENCES "KnowledgeCorpus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeIngestion" ADD CONSTRAINT "KnowledgeIngestion_corpusId_fkey" FOREIGN KEY ("corpusId") REFERENCES "KnowledgeCorpus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeIngestion" ADD CONSTRAINT "KnowledgeIngestion_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeCorpusGeneration" ADD CONSTRAINT "KnowledgeCorpusGeneration_corpusId_fkey" FOREIGN KEY ("corpusId") REFERENCES "KnowledgeCorpus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "EdgeDeviceCredential" ADD CONSTRAINT "EdgeDeviceCredential_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EdgeDeviceCredential" ADD CONSTRAINT "EdgeDeviceCredential_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetExtractionJob" ADD CONSTRAINT "AssetExtractionJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetExtractionJob" ADD CONSTRAINT "AssetExtractionJob_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetExtractionJob" ADD CONSTRAINT "AssetExtractionJob_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "AssetEvidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineOaAccount" ADD CONSTRAINT "LineOaAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineOaAccount" ADD CONSTRAINT "LineOaAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineOaAccount" ADD CONSTRAINT "LineOaAccount_integrationConnectionId_fkey" FOREIGN KEY ("integrationConnectionId") REFERENCES "IntegrationConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineOaRichMenu" ADD CONSTRAINT "LineOaRichMenu_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineOaRichMenu" ADD CONSTRAINT "LineOaRichMenu_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineOaRichMenu" ADD CONSTRAINT "LineOaRichMenu_lineOaAccountId_fkey" FOREIGN KEY ("lineOaAccountId") REFERENCES "LineOaAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineOaRichMenuVersion" ADD CONSTRAINT "LineOaRichMenuVersion_richMenuId_fkey" FOREIGN KEY ("richMenuId") REFERENCES "LineOaRichMenu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineOaRichMenuVersion" ADD CONSTRAINT "LineOaRichMenuVersion_imageFileAssetId_fkey" FOREIGN KEY ("imageFileAssetId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineOaLiffApp" ADD CONSTRAINT "LineOaLiffApp_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineOaLiffApp" ADD CONSTRAINT "LineOaLiffApp_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineOaLiffApp" ADD CONSTRAINT "LineOaLiffApp_lineOaAccountId_fkey" FOREIGN KEY ("lineOaAccountId") REFERENCES "LineOaAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineOaRichMenuJob" ADD CONSTRAINT "LineOaRichMenuJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LineOaAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineOaRichMenuJob" ADD CONSTRAINT "LineOaRichMenuJob_richMenuId_fkey" FOREIGN KEY ("richMenuId") REFERENCES "LineOaRichMenu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineOaRichMenuJob" ADD CONSTRAINT "LineOaRichMenuJob_richMenuVersionId_fkey" FOREIGN KEY ("richMenuVersionId") REFERENCES "LineOaRichMenuVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineConversationJob" ADD CONSTRAINT "LineConversationJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LineOaAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineConversationJob" ADD CONSTRAINT "LineConversationJob_inboundMessageId_fkey" FOREIGN KEY ("inboundMessageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPlan" ADD CONSTRAINT "MarketingPlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPlan" ADD CONSTRAINT "MarketingPlan_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPlanVersion" ADD CONSTRAINT "MarketingPlanVersion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MarketingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingReview" ADD CONSTRAINT "MarketingReview_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MarketingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingReview" ADD CONSTRAINT "MarketingReview_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "MarketingPlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingDecision" ADD CONSTRAINT "MarketingDecision_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MarketingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingDecision" ADD CONSTRAINT "MarketingDecision_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "MarketingPlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingDecision" ADD CONSTRAINT "MarketingDecision_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "MarketingReview"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingHandoff" ADD CONSTRAINT "MarketingHandoff_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MarketingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingHandoff" ADD CONSTRAINT "MarketingHandoff_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "MarketingPlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingHandoff" ADD CONSTRAINT "MarketingHandoff_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingHandoff" ADD CONSTRAINT "MarketingHandoff_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingInitiative" ADD CONSTRAINT "MarketingInitiative_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingInitiative" ADD CONSTRAINT "MarketingInitiative_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingInitiative" ADD CONSTRAINT "MarketingInitiative_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MarketingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingInitiative" ADD CONSTRAINT "MarketingInitiative_handoffId_fkey" FOREIGN KEY ("handoffId") REFERENCES "MarketingHandoff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingContentBrief" ADD CONSTRAINT "MarketingContentBrief_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingContentBrief" ADD CONSTRAINT "MarketingContentBrief_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingContentVersion" ADD CONSTRAINT "MarketingContentVersion_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "MarketingContentBrief"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingContentReview" ADD CONSTRAINT "MarketingContentReview_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "MarketingContentBrief"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingContentReview" ADD CONSTRAINT "MarketingContentReview_contentVersionId_fkey" FOREIGN KEY ("contentVersionId") REFERENCES "MarketingContentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingContentDecision" ADD CONSTRAINT "MarketingContentDecision_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "MarketingContentBrief"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingContentDecision" ADD CONSTRAINT "MarketingContentDecision_contentVersionId_fkey" FOREIGN KEY ("contentVersionId") REFERENCES "MarketingContentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingContentDecision" ADD CONSTRAINT "MarketingContentDecision_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "MarketingContentReview"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingOperationsIntake" ADD CONSTRAINT "MarketingOperationsIntake_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingOperationsIntake" ADD CONSTRAINT "MarketingOperationsIntake_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingBroadcastIntent" ADD CONSTRAINT "MarketingBroadcastIntent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingBroadcastIntent" ADD CONSTRAINT "MarketingBroadcastIntent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingBroadcastIntentVersion" ADD CONSTRAINT "MarketingBroadcastIntentVersion_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "MarketingBroadcastIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCategory" ADD CONSTRAINT "InventoryCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCategory" ADD CONSTRAINT "InventoryCategory_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFamily" ADD CONSTRAINT "ProductFamily_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFamily" ADD CONSTRAINT "ProductFamily_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Factory" ADD CONSTRAINT "Factory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Factory" ADD CONSTRAINT "Factory_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMaster" ADD CONSTRAINT "ProductMaster_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMaster" ADD CONSTRAINT "ProductMaster_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMaster" ADD CONSTRAINT "ProductMaster_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "InventoryCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMaster" ADD CONSTRAINT "ProductMaster_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "ProductFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMaster" ADD CONSTRAINT "ProductMaster_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_productMasterId_fkey" FOREIGN KEY ("productMasterId") REFERENCES "ProductMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductLot" ADD CONSTRAINT "ProductLot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductLot" ADD CONSTRAINT "ProductLot_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductLot" ADD CONSTRAINT "ProductLot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductLot" ADD CONSTRAINT "ProductLot_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialUnit" ADD CONSTRAINT "SerialUnit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialUnit" ADD CONSTRAINT "SerialUnit_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialUnit" ADD CONSTRAINT "SerialUnit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerialUnit" ADD CONSTRAINT "SerialUnit_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "ProductLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBundle" ADD CONSTRAINT "ProductBundle_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBundle" ADD CONSTRAINT "ProductBundle_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBundleItem" ADD CONSTRAINT "ProductBundleItem_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "ProductBundle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductBundleItem" ADD CONSTRAINT "ProductBundleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "ProductLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_serialUnitId_fkey" FOREIGN KEY ("serialUnitId") REFERENCES "SerialUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_sourceLocationId_fkey" FOREIGN KEY ("sourceLocationId") REFERENCES "WarehouseLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_targetLocationId_fkey" FOREIGN KEY ("targetLocationId") REFERENCES "WarehouseLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedgerFence" ADD CONSTRAINT "InventoryLedgerFence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedgerFence" ADD CONSTRAINT "InventoryLedgerFence_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryStocktake" ADD CONSTRAINT "InventoryStocktake_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryStocktake" ADD CONSTRAINT "InventoryStocktake_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRecipe" ADD CONSTRAINT "ProductRecipe_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRecipe" ADD CONSTRAINT "ProductRecipe_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRecipe" ADD CONSTRAINT "ProductRecipe_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRecipeLine" ADD CONSTRAINT "ProductRecipeLine_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "ProductRecipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRecipeLine" ADD CONSTRAINT "ProductRecipeLine_componentProductId_fkey" FOREIGN KEY ("componentProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseLocation" ADD CONSTRAINT "WarehouseLocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseLocation" ADD CONSTRAINT "WarehouseLocation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomizationWorkOrder" ADD CONSTRAINT "CustomizationWorkOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomizationWorkOrder" ADD CONSTRAINT "CustomizationWorkOrder_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomizationWorkOrder" ADD CONSTRAINT "CustomizationWorkOrder_rawProductId_fkey" FOREIGN KEY ("rawProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomizationWorkOrder" ADD CONSTRAINT "CustomizationWorkOrder_outputProductId_fkey" FOREIGN KEY ("outputProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KittingWorkOrder" ADD CONSTRAINT "KittingWorkOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KittingWorkOrder" ADD CONSTRAINT "KittingWorkOrder_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KittingWorkOrder" ADD CONSTRAINT "KittingWorkOrder_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "ProductRecipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KittingWorkOrder" ADD CONSTRAINT "KittingWorkOrder_finishedProductId_fkey" FOREIGN KEY ("finishedProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTask" ADD CONSTRAINT "SalesTask_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTask" ADD CONSTRAINT "SalesTask_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTask" ADD CONSTRAINT "SalesTask_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTask" ADD CONSTRAINT "SalesTask_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTask" ADD CONSTRAINT "SalesTask_assigneePersonId_fkey" FOREIGN KEY ("assigneePersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessBillingProfile" ADD CONSTRAINT "BusinessBillingProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessBillingProfile" ADD CONSTRAINT "BusinessBillingProfile_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceDocumentSequence" ADD CONSTRAINT "CommerceDocumentSequence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceDocumentSequence" ADD CONSTRAINT "CommerceDocumentSequence_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceDocument" ADD CONSTRAINT "CommerceDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceDocument" ADD CONSTRAINT "CommerceDocument_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceDocument" ADD CONSTRAINT "CommerceDocument_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceDocument" ADD CONSTRAINT "CommerceDocument_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_slipFileAssetId_fkey" FOREIGN KEY ("slipFileAssetId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "GoodsReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

