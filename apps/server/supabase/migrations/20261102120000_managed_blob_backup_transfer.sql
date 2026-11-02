BEGIN;

-- FR-293 installation-local transfer custody. Source migration only; do not
-- apply until the target's separate release gates authorize it.
CREATE TABLE "ManagedBlobBackupTransferJob" (
    "id" TEXT NOT NULL,
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
    "admissionId" TEXT,
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
    "restoreClaimedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "byteDeadline" TIMESTAMP(3) NOT NULL,
    "workerId" TEXT,
    "workerStartedAt" TIMESTAMP(3),
    "epoch" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "unresolved" BOOLEAN NOT NULL DEFAULT true,
    "reservedBytes" INTEGER NOT NULL DEFAULT 49152,
    "auditCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ManagedBlobBackupTransferJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ManagedBlobBackupTransferJob_actorId_state_idx" ON "ManagedBlobBackupTransferJob"("actorId", "state");
CREATE INDEX "ManagedBlobBackupTransferJob_kind_state_idx" ON "ManagedBlobBackupTransferJob"("kind", "state");
CREATE INDEX "ManagedBlobBackupTransferJob_state_leaseExpiresAt_idx" ON "ManagedBlobBackupTransferJob"("state", "leaseExpiresAt");
CREATE INDEX "ManagedBlobBackupTransferJob_unresolved_expiresAt_idx" ON "ManagedBlobBackupTransferJob"("unresolved", "expiresAt");
CREATE UNIQUE INDEX "ManagedBlobBackupTransferJob_admissionId_key" ON "ManagedBlobBackupTransferJob"("admissionId");

CREATE TABLE "ManagedBlobBackupTransferEntry" (
    "id" TEXT NOT NULL,
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
    "leaseExpiresAt" TIMESTAMP(3),
    "receiptJson" TEXT,
    "cleanupState" TEXT NOT NULL DEFAULT 'NONE',
    "unresolved" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ManagedBlobBackupTransferEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ManagedBlobBackupTransferEntry_jobId_state_idx" ON "ManagedBlobBackupTransferEntry"("jobId", "state");
CREATE INDEX "ManagedBlobBackupTransferEntry_state_leaseExpiresAt_idx" ON "ManagedBlobBackupTransferEntry"("state", "leaseExpiresAt");
CREATE UNIQUE INDEX "ManagedBlobBackupTransferEntry_jobId_objectId_key" ON "ManagedBlobBackupTransferEntry"("jobId", "objectId");

ALTER TABLE "ManagedBlobBackupTransferJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ManagedBlobBackupTransferJob" FORCE ROW LEVEL SECURITY;
CREATE POLICY zuri_app_runtime_all ON "ManagedBlobBackupTransferJob" FOR ALL TO zuri_app_runtime,zuri_web_login USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE "ManagedBlobBackupTransferJob" FROM public,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE "ManagedBlobBackupTransferJob" TO zuri_app_runtime,zuri_web_login;

ALTER TABLE "ManagedBlobBackupTransferEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ManagedBlobBackupTransferEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY zuri_app_runtime_all ON "ManagedBlobBackupTransferEntry" FOR ALL TO zuri_app_runtime,zuri_web_login USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE "ManagedBlobBackupTransferEntry" FROM public,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE "ManagedBlobBackupTransferEntry" TO zuri_app_runtime,zuri_web_login;

COMMIT;
