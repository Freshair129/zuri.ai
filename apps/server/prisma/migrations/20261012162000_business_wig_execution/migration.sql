-- @req FR-270, ADR-101 D1/D5 — 4DX lead measures, weekly commitments,
-- WIG sessions, and the Key Result lag-measure marker.
-- Additive local migration. Production application remains a separate
-- operator/owner gate.

ALTER TABLE "BusinessKeyResult"
ADD COLUMN "isLagMeasure" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "BusinessLeadMeasure" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "weeklyTarget" REAL NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'UP',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "BusinessLeadMeasure_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BusinessLeadMeasure_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "BusinessGoal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "BusinessLeadMeasureValue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadMeasureId" TEXT NOT NULL,
    "weekStartAt" DATETIME NOT NULL,
    "value" REAL NOT NULL,
    "actorPersonId" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessLeadMeasureValue_leadMeasureId_fkey" FOREIGN KEY ("leadMeasureId") REFERENCES "BusinessLeadMeasure" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BusinessLeadMeasureValue_actorPersonId_fkey" FOREIGN KEY ("actorPersonId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "BusinessWeeklyCommitment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "weekStartAt" DATETIME NOT NULL,
    "ownerPersonId" TEXT,
    "leadMeasureId" TEXT,
    "title" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "BusinessWeeklyCommitment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BusinessWeeklyCommitment_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BusinessWeeklyCommitment_leadMeasureId_fkey" FOREIGN KEY ("leadMeasureId") REFERENCES "BusinessLeadMeasure" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "BusinessWigSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "weekStartAt" DATETIME NOT NULL,
    "reportCompletedAt" DATETIME,
    "scoreboardCompletedAt" DATETIME,
    "planCompletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "BusinessWigSession_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "BusinessLeadMeasure_businessId_status_idx" ON "BusinessLeadMeasure"("businessId", "status");
CREATE INDEX "BusinessLeadMeasure_goalId_status_idx" ON "BusinessLeadMeasure"("goalId", "status");
CREATE INDEX "BusinessLeadMeasureValue_leadMeasureId_weekStartAt_createdAt_idx" ON "BusinessLeadMeasureValue"("leadMeasureId", "weekStartAt", "createdAt");
CREATE INDEX "BusinessWeeklyCommitment_businessId_weekStartAt_done_idx" ON "BusinessWeeklyCommitment"("businessId", "weekStartAt", "done");
CREATE INDEX "BusinessWeeklyCommitment_ownerPersonId_weekStartAt_idx" ON "BusinessWeeklyCommitment"("ownerPersonId", "weekStartAt");
CREATE INDEX "BusinessWeeklyCommitment_leadMeasureId_idx" ON "BusinessWeeklyCommitment"("leadMeasureId");
CREATE UNIQUE INDEX "BusinessWigSession_businessId_weekStartAt_key" ON "BusinessWigSession"("businessId", "weekStartAt");
CREATE INDEX "BusinessWigSession_businessId_weekStartAt_idx" ON "BusinessWigSession"("businessId", "weekStartAt");
