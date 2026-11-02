-- FR-293 target-local transfer job and per-object custody; never snapshot imported.
CREATE TABLE "ManagedBlobBackupTransferJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PREPARED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "generation" INTEGER NOT NULL,
    "sourceGeneration" INTEGER,
    "sourceConfigHash" TEXT,
    "targetConfigHash" TEXT NOT NULL,
    "snapshotSha256" TEXT,
    "packageSha256" TEXT,
    "sourceRevision" TEXT,
    "countsJson" TEXT,
    "admissionJson" TEXT,
    "admissionId" TEXT UNIQUE,
    "outcomeJson" TEXT,
    "resultJson" TEXT,
    "restoreRemountsJson" TEXT,
    "spoolId" TEXT,
    "spoolSha256" TEXT,
    "spoolBytes" INTEGER NOT NULL DEFAULT 0,
    "snapshotSpoolBytes" INTEGER NOT NULL DEFAULT 0,
    "spoolReservedBytes" INTEGER NOT NULL DEFAULT 0,
    "cleanupState" TEXT NOT NULL DEFAULT 'NONE',
    "confirmationDigest" TEXT,
    "restoreAttemptId" TEXT,
    "restoreClaimedAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "byteDeadline" DATETIME NOT NULL,
    "workerId" TEXT,
    "workerStartedAt" DATETIME,
    "epoch" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "unresolved" BOOLEAN NOT NULL DEFAULT true,
    "reservedBytes" INTEGER NOT NULL DEFAULT 49152,
    "auditCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "closedAt" DATETIME
);

CREATE INDEX "ManagedBlobBackupTransferJob_actorId_state_idx" ON "ManagedBlobBackupTransferJob"("actorId", "state");
CREATE INDEX "ManagedBlobBackupTransferJob_kind_state_idx" ON "ManagedBlobBackupTransferJob"("kind", "state");
CREATE INDEX "ManagedBlobBackupTransferJob_state_leaseExpiresAt_idx" ON "ManagedBlobBackupTransferJob"("state", "leaseExpiresAt");
CREATE INDEX "ManagedBlobBackupTransferJob_unresolved_expiresAt_idx" ON "ManagedBlobBackupTransferJob"("unresolved", "expiresAt");

CREATE TABLE "ManagedBlobBackupTransferEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "bindingsJson" TEXT NOT NULL,
    "targetKey" TEXT,
    "targetRef" TEXT,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "workerId" TEXT,
    "epoch" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" DATETIME,
    "receiptJson" TEXT,
    "cleanupState" TEXT NOT NULL DEFAULT 'NONE',
    "unresolved" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "closedAt" DATETIME,
    CONSTRAINT "ManagedBlobBackupTransferEntry_jobId_objectId_key" UNIQUE ("jobId", "objectId")
);

CREATE INDEX "ManagedBlobBackupTransferEntry_jobId_state_idx" ON "ManagedBlobBackupTransferEntry"("jobId", "state");
CREATE INDEX "ManagedBlobBackupTransferEntry_state_leaseExpiresAt_idx" ON "ManagedBlobBackupTransferEntry"("state", "leaseExpiresAt");
