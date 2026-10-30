-- CreateTable
CREATE TABLE "ManagedBlobRecoveryInstallationFence" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'NEEDS_ADMISSION',
    "generation" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "retainedBytes" INTEGER NOT NULL DEFAULT 0,
    "restoreAttemptId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedBlobRecoveryInstallationFence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagedBlobRecoveryOperation" (
    "id" TEXT NOT NULL,
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
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "byteDeadline" TIMESTAMP(3) NOT NULL,
    "spoolId" TEXT,
    "spoolBytes" INTEGER NOT NULL DEFAULT 0,
    "workerId" TEXT,
    "epoch" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "receiptJson" TEXT,
    "resultVersion" INTEGER,
    "availability" TEXT NOT NULL DEFAULT 'NOT_CHECKED',
    "cleanupState" TEXT NOT NULL DEFAULT 'NONE',
    "unresolved" BOOLEAN NOT NULL DEFAULT true,
    "reservedBytes" INTEGER NOT NULL DEFAULT 49152,
    "auditCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ManagedBlobRecoveryOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManagedBlobRecoveryOperation_actorId_unresolved_idx" ON "ManagedBlobRecoveryOperation"("actorId", "unresolved");

-- CreateIndex
CREATE INDEX "ManagedBlobRecoveryOperation_businessId_unresolved_idx" ON "ManagedBlobRecoveryOperation"("businessId", "unresolved");

-- CreateIndex
CREATE INDEX "ManagedBlobRecoveryOperation_state_leaseExpiresAt_idx" ON "ManagedBlobRecoveryOperation"("state", "leaseExpiresAt");


-- Private installation-local control state. No migration is applied here.
ALTER TABLE "ManagedBlobRecoveryInstallationFence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ManagedBlobRecoveryInstallationFence" FORCE ROW LEVEL SECURITY;
CREATE POLICY zuri_app_runtime_all ON "ManagedBlobRecoveryInstallationFence" FOR ALL TO zuri_app_runtime,zuri_web_login USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE "ManagedBlobRecoveryInstallationFence" FROM public,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE "ManagedBlobRecoveryInstallationFence" TO zuri_app_runtime,zuri_web_login;
ALTER TABLE "ManagedBlobRecoveryOperation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ManagedBlobRecoveryOperation" FORCE ROW LEVEL SECURITY;
CREATE POLICY zuri_app_runtime_all ON "ManagedBlobRecoveryOperation" FOR ALL TO zuri_app_runtime,zuri_web_login USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE "ManagedBlobRecoveryOperation" FROM public,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE "ManagedBlobRecoveryOperation" TO zuri_app_runtime,zuri_web_login;
