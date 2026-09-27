-- @req FR-190 — durable scheduling checkpoint for the stateless LINE worker.
-- @spec ADR-105 D1/D3
-- Additive SQLite migration. The checkpoint coordinates an advisory health
-- sweep only; it is not account state and carries no provider secret.

CREATE TABLE "LineOaWorkerCheckpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "lastCompletedAt" DATETIME,
    "nextDueAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimantId" TEXT,
    "leaseExpiresAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "LineOaWorkerCheckpoint_kind_key" ON "LineOaWorkerCheckpoint"("kind");
CREATE INDEX "LineOaWorkerCheckpoint_kind_nextDueAt_leaseExpiresAt_idx"
  ON "LineOaWorkerCheckpoint"("kind", "nextDueAt", "leaseExpiresAt");
