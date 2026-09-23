-- @req FR-268 — Business Key Results (OKR): a measurable child of
-- BusinessGoal, with append-only weekly check-ins. BusinessGoal gains
-- `perspective` (nullable Balanced Scorecard tag) and `isWig` (4DX flag,
-- default false, unused until FR-270/Phase 3) — ADR-101 D1.
-- No stored progress/status column on BusinessKeyResult: both are pure
-- functions of (baseline, target, direction, latest check-in), computed on
-- every read (SDD-107) — see project-manager/progress/key-result-progress.js.
-- Additive local twin of the Supabase migration with the same timestamp.

ALTER TABLE "BusinessGoal" ADD COLUMN "perspective" TEXT;
ALTER TABLE "BusinessGoal" ADD COLUMN "isWig" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "BusinessKeyResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "baseline" REAL NOT NULL,
    "target" REAL NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'UP',
    "dueAt" DATETIME,
    "ownerPersonId" TEXT,
    "confidence" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "BusinessKeyResult_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BusinessKeyResult_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "BusinessGoal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BusinessKeyResult_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "BusinessKeyResultCheckIn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "keyResultId" TEXT NOT NULL,
    "weekStartAt" DATETIME NOT NULL,
    "value" REAL NOT NULL,
    "confidence" INTEGER NOT NULL,
    "note" TEXT,
    "source" TEXT,
    "actorPersonId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessKeyResultCheckIn_keyResultId_fkey" FOREIGN KEY ("keyResultId") REFERENCES "BusinessKeyResult" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BusinessKeyResultCheckIn_actorPersonId_fkey" FOREIGN KEY ("actorPersonId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BusinessKeyResult_code_key" ON "BusinessKeyResult"("code");
CREATE INDEX "BusinessKeyResult_businessId_status_idx" ON "BusinessKeyResult"("businessId", "status");
CREATE INDEX "BusinessKeyResult_goalId_idx" ON "BusinessKeyResult"("goalId");

CREATE UNIQUE INDEX "BusinessKeyResultCheckIn_keyResultId_weekStartAt_key" ON "BusinessKeyResultCheckIn"("keyResultId", "weekStartAt");
CREATE INDEX "BusinessKeyResultCheckIn_keyResultId_idx" ON "BusinessKeyResultCheckIn"("keyResultId");
