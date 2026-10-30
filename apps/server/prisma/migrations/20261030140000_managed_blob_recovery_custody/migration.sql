-- CreateTable
CREATE TABLE "ManagedBlobRecoveryInstallationFence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL DEFAULT 'NEEDS_ADMISSION',
    "generation" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "retainedBytes" INTEGER NOT NULL DEFAULT 0,
    "restoreAttemptId" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ManagedBlobRecoveryOperation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "expectedJson" TEXT NOT NULL,
    "configHash" TEXT NOT NULL,
    "spoolRootHash" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "destinationKey" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PREPARED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "confirmationDigest" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "byteDeadline" DATETIME NOT NULL,
    "spoolId" TEXT,
    "spoolBytes" INTEGER NOT NULL DEFAULT 0,
    "workerId" TEXT,
    "epoch" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "receiptJson" TEXT,
    "resultVersion" INTEGER,
    "availability" TEXT NOT NULL DEFAULT 'NOT_CHECKED',
    "cleanupState" TEXT NOT NULL DEFAULT 'NONE',
    "unresolved" BOOLEAN NOT NULL DEFAULT true,
    "reservedBytes" INTEGER NOT NULL DEFAULT 49152,
    "auditCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "closedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "ManagedBlobRecoveryOperation_actorId_unresolved_idx" ON "ManagedBlobRecoveryOperation"("actorId", "unresolved");

-- CreateIndex
CREATE INDEX "ManagedBlobRecoveryOperation_businessId_unresolved_idx" ON "ManagedBlobRecoveryOperation"("businessId", "unresolved");

-- CreateIndex
CREATE INDEX "ManagedBlobRecoveryOperation_state_leaseExpiresAt_idx" ON "ManagedBlobRecoveryOperation"("state", "leaseExpiresAt");
