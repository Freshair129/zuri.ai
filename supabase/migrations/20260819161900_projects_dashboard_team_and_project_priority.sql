-- @req FR-087, FR-088, FR-089 — project priority, the accountable Person (PIC), and
-- Team / TeamMembership / ProjectTeam as an organisational grouping.
-- @spec BR-018, ADR-036, ADR-037 — a Team groups people and grants nothing: no scope,
-- no role, no domain visibility. Every column here is additive and nullable or new.
-- @tested tests/unit/projects-dashboard-schema-migration.test.js
--
-- Applies to the application schema provisioned by
-- supabase/migrations/20260818084011_application_schema.sql. Generated from
-- prisma/schema.prisma; regenerate that canonical model before changing this file.
--
-- RECORDED AFTER THE FACT. This change was applied to production on 2026-08-19 by a
-- direct additive push whose SQL text was never captured. The statements below were
-- reconstructed from the live schema (pg_indexes.indexdef, pg_get_constraintdef,
-- information_schema.columns) and reproduce those objects exactly; the matching ledger
-- row is supabase_migrations.schema_migrations version 20260819161900. Replaying this
-- file against production would fail on the existing objects, and that is correct — it
-- exists so a database rebuilt from this lineage reaches the same shape.
--
-- Nothing here is destructive: two nullable columns on Project and three new tables.
-- `Project.priority` holds the PROJECT_PRIORITIES strings from
-- src/lib/validation/enums.js (FR-087); the database stores the value, the enum module
-- remains the single source of truth (SDD-008).

ALTER TABLE "Project" ADD COLUMN "priority" TEXT;
ALTER TABLE "Project" ADD COLUMN "picPersonId" TEXT;

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

CREATE TABLE "TeamMembership" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectTeam" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectTeam_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Team_code_key" ON "Team"("code");
CREATE INDEX "Team_businessId_idx" ON "Team"("businessId");
CREATE INDEX "TeamMembership_teamId_idx" ON "TeamMembership"("teamId");
CREATE INDEX "TeamMembership_personId_idx" ON "TeamMembership"("personId");
CREATE UNIQUE INDEX "TeamMembership_teamId_personId_key" ON "TeamMembership"("teamId", "personId");
CREATE INDEX "ProjectTeam_projectId_idx" ON "ProjectTeam"("projectId");
CREATE INDEX "ProjectTeam_teamId_idx" ON "ProjectTeam"("teamId");
CREATE UNIQUE INDEX "ProjectTeam_projectId_teamId_key" ON "ProjectTeam"("projectId", "teamId");
CREATE INDEX "Project_picPersonId_idx" ON "Project"("picPersonId");

-- A Project keeps its PIC nullable and survives the Person going away (SET NULL); a
-- Team may not be orphaned from its Business (RESTRICT); join rows follow their parents.
ALTER TABLE "Project" ADD CONSTRAINT "Project_picPersonId_fkey" FOREIGN KEY ("picPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Team" ADD CONSTRAINT "Team_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectTeam" ADD CONSTRAINT "ProjectTeam_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectTeam" ADD CONSTRAINT "ProjectTeam_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
