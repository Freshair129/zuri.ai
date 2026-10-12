-- @req FR-269, ADR-101 D1 — Business-owned Balanced Scorecard KPIs and their
-- append-only manual observation history. Status is derived by application
-- code from target, warningThreshold, direction, and the latest observation.
--
-- Additive local migration. It is not applied to production by this change;
-- any production migration remains a separate operator/owner gate.

CREATE TABLE "BusinessKpi" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "perspective" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "target" REAL NOT NULL,
    "warningThreshold" REAL NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'UP',
    "cadence" TEXT NOT NULL DEFAULT 'MONTHLY',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "BusinessKpi_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BusinessKpi_perspective_check" CHECK ("perspective" IN ('FINANCIAL', 'CUSTOMER', 'INTERNAL_PROCESS', 'LEARNING_GROWTH')),
    CONSTRAINT "BusinessKpi_direction_check" CHECK ("direction" IN ('UP', 'DOWN')),
    CONSTRAINT "BusinessKpi_cadence_check" CHECK ("cadence" IN ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY')),
    CONSTRAINT "BusinessKpi_status_check" CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
    CONSTRAINT "BusinessKpi_warningThreshold_check" CHECK (("direction" = 'UP' AND "warningThreshold" < "target") OR ("direction" = 'DOWN' AND "warningThreshold" > "target"))
);

CREATE TABLE "BusinessKpiObservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kpiId" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "observedAt" DATETIME NOT NULL,
    "actorPersonId" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessKpiObservation_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "BusinessKpi" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BusinessKpiObservation_actorPersonId_fkey" FOREIGN KEY ("actorPersonId") REFERENCES "Person" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "BusinessKpi_businessId_status_perspective_idx" ON "BusinessKpi"("businessId", "status", "perspective");
CREATE INDEX "BusinessKpiObservation_kpiId_observedAt_idx" ON "BusinessKpiObservation"("kpiId", "observedAt");
