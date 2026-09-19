-- @req FR-193 — Employment: an HR assignment record, separate from
--   Membership's access grant. `people-service.js` used to build the HR
--   roster by reading Membership directly, so "who works here" and "who can
--   log in here" were the same question by construction — a shareholder
--   holding an OWNER Membership appeared as an employee, a suspended staff
--   member vanished from the roster instead of showing suspended, and a
--   LINE-originated Person with no Membership could never appear at all.
-- @req FR-194 — LegalEntity moves under Tenant (it carried only `portfolioId`
--   before this, which put it ABOVE the BR-001 isolation boundary — two
--   Businesses in different Tenants could share one legal entity, and a
--   tenant-scoped RLS policy has no column here to filter on). TaxRegistrationBranch
--   is split out of `Branch.taxBranchCode`: a VAT branch code
--   (ประมวลรัษฎากร ม.86, ภ.พ.20) belongs to the legal entity's tax
--   registration, not to an operating site — a warehouse has no branch code,
--   and one branch code can cover several sites.
-- @spec ADR-078 D1, D2; BR-034; SDD-093; ADR-018 D4; ADR-077 D4 (the
--   `UNIQUE(id, tenantId)` + composite-FK pattern this migration repeats for
--   LegalEntity)
--
-- Ordering inside the transaction: LegalEntity's tenantId lands and is backed
-- by data before Business's FK to it is rebuilt; Employment's backfill runs
-- before Membership.employeeRef/branchId are dropped, so a failure leaves the
-- database on the old shape rather than half-way to the new one.
--
-- Preconditions were checked against this database on 2026-09-12 and are
-- RE-ASSERTED here rather than trusted (ADR-077's own migration does the
-- same), because rows can be written between a check and an apply. This
-- session could not reach the production project directly to re-confirm the
-- "LegalEntity and Branch carry zero rows today" reading recorded in ADR-078;
-- the checks below make that an enforced precondition instead of an assumed
-- one — the migration aborts with the exact offending rows rather than
-- guessing at a backfill for data that turns out to exist.
--
-- NOT APPLIED to production by this change. Applying is an owner-instructed
-- operator step (ADR-057) for the deploy-role session: dry run in a
-- rolled-back transaction, then apply and record the version.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Preconditions
-- ---------------------------------------------------------------------------
DO $$
DECLARE n bigint;
BEGIN
  -- FR-194 assumes zero LegalEntity/Branch rows today (ADR-078). If that has
  -- stopped being true, backfilling tenantId or dropping taxBranchCode by
  -- guesswork would be exactly the "expand a stored grant on the authority of
  -- a migration" move ADR-077 refused — so this aborts instead, and the two
  -- diagnostic queries below run only inside the RAISE, never against a
  -- report nobody reads.
  SELECT count(*) INTO n FROM "LegalEntity";
  IF n > 0 THEN
    -- Ambiguous ancestry is refused; unambiguous ancestry is used. A row with
    -- no linked Business, or linked Businesses spanning more than one Tenant,
    -- has no safe tenantId to assign and stops the migration.
    IF EXISTS (
      SELECT 1 FROM "LegalEntity" le
      WHERE NOT EXISTS (SELECT 1 FROM "Business" b WHERE b."legalEntityId" = le.id)
         OR (SELECT count(DISTINCT b."tenantId") FROM "Business" b WHERE b."legalEntityId" = le.id) > 1
    ) THEN
      RAISE EXCEPTION 'PRECONDITION: % LegalEntity row(s) exist and at least one has no unambiguous Tenant to backfill (no linked Business, or linked Businesses in more than one Tenant). Inspect: SELECT le.id, le.code, (SELECT array_agg(DISTINCT b."tenantId") FROM "Business" b WHERE b."legalEntityId" = le.id) AS tenant_ids FROM "LegalEntity" le;', n;
    END IF;
    RAISE NOTICE '% LegalEntity row(s) found with unambiguous ancestry — backfilling tenantId from their linked Business(es) rather than assuming zero rows.', n;
  END IF;

  SELECT count(*) INTO n FROM "Branch" WHERE "taxBranchCode" IS NOT NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'PRECONDITION: % Branch row(s) carry a taxBranchCode. Create the matching TaxRegistrationBranch row(s) under the correct LegalEntity and re-point taxRegistrationBranchId by hand before this migration drops the column — a migration is not the place to decide which legal entity a stored code belongs to (least privilege, ADR-077 Consequences). Inspect: SELECT id, code, "businessId", "taxBranchCode" FROM "Branch" WHERE "taxBranchCode" IS NOT NULL;', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. FR-194 — LegalEntity moves under Tenant
-- ---------------------------------------------------------------------------
ALTER TABLE "LegalEntity" ADD COLUMN "tenantId" TEXT;
UPDATE "LegalEntity" le
   SET "tenantId" = (SELECT b."tenantId" FROM "Business" b WHERE b."legalEntityId" = le.id LIMIT 1)
 WHERE EXISTS (SELECT 1 FROM "Business" b WHERE b."legalEntityId" = le.id);
-- No row should remain unassigned after the precondition above (it aborted
-- otherwise), but the NOT NULL below is what actually enforces it rather than
-- this comment.
ALTER TABLE "LegalEntity" ALTER COLUMN "tenantId" SET NOT NULL;

ALTER TABLE "LegalEntity" DROP CONSTRAINT IF EXISTS "LegalEntity_portfolioId_fkey";
ALTER TABLE "LegalEntity" DROP COLUMN "portfolioId";

ALTER TABLE "LegalEntity" ADD CONSTRAINT "LegalEntity_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "LegalEntity_tenantId_idx" ON "LegalEntity"("tenantId");

ALTER TABLE "LegalEntity" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "LegalEntity" ADD CONSTRAINT "LegalEntity_status_check"
  CHECK (status IN ('ACTIVE', 'ARCHIVED'));

-- The composite unique a child's ancestry FK needs (ADR-077 D4's own pattern
-- for Business(id, tenantId)).
ALTER TABLE "LegalEntity" ADD CONSTRAINT "LegalEntity_id_tenantId_key" UNIQUE ("id", "tenantId");

-- A Business may only reference a LegalEntity in its OWN Tenant. Before this,
-- `Business_legalEntityId_fkey` pointed at a bare `LegalEntity.id` with no
-- Tenant check at all, which is what let two Businesses in different Tenants
-- share one legal entity — `billing-invoice-service.js` compensated with an
-- application-code portfolio comparison that this constraint retires.
ALTER TABLE "Business" DROP CONSTRAINT IF EXISTS "Business_legalEntityId_fkey";
ALTER TABLE "Business" ADD CONSTRAINT "Business_legalEntity_tenant_fkey"
  FOREIGN KEY ("legalEntityId", "tenantId") REFERENCES "LegalEntity"("id", "tenantId")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. FR-194 — TaxRegistrationBranch: the legal entity's own VAT registrations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "TaxRegistrationBranch" (
  "id"            TEXT PRIMARY KEY,
  "legalEntityId" TEXT NOT NULL REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "branchCode"    TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "address"       TEXT NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'ACTIVE',
  "verifiedAt"    TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT now()
);
ALTER TABLE "TaxRegistrationBranch" ADD CONSTRAINT "TaxRegistrationBranch_branchCode_check"
  CHECK ("branchCode" ~ '^[0-9]{5}$');
ALTER TABLE "TaxRegistrationBranch" ADD CONSTRAINT "TaxRegistrationBranch_status_check"
  CHECK (status IN ('ACTIVE', 'ARCHIVED'));
CREATE UNIQUE INDEX IF NOT EXISTS "TaxRegistrationBranch_legalEntityId_branchCode_key"
  ON "TaxRegistrationBranch"("legalEntityId", "branchCode");
CREATE INDEX IF NOT EXISTS "TaxRegistrationBranch_legalEntityId_idx" ON "TaxRegistrationBranch"("legalEntityId");

-- ---------------------------------------------------------------------------
-- 3. FR-194 — Branch: a site, optionally pointed at its legal tax branch
-- ---------------------------------------------------------------------------
ALTER TABLE "Branch" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'SITE';
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_kind_check"
  CHECK (kind IN ('SITE', 'WAREHOUSE', 'KITCHEN', 'OFFICE'));

ALTER TABLE "Branch" ADD COLUMN "taxRegistrationBranchId" TEXT;
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_taxRegistrationBranchId_fkey"
  FOREIGN KEY ("taxRegistrationBranchId") REFERENCES "TaxRegistrationBranch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Branch_taxRegistrationBranchId_idx" ON "Branch"("taxRegistrationBranchId");

-- Precondition 0 already refused if any row still needed this column; safe to
-- drop outright rather than migrate values nobody holds.
ALTER TABLE "Branch" DROP COLUMN "taxBranchCode";

-- ---------------------------------------------------------------------------
-- 4. FR-193 — Employment: the HR assignment record
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Employment" (
  "id"             TEXT PRIMARY KEY,
  "personId"       TEXT NOT NULL REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "tenantId"       TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "businessId"     TEXT NOT NULL REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "branchId"       TEXT REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "employeeNo"     TEXT,
  "title"          TEXT,
  "employmentType" TEXT NOT NULL DEFAULT 'EMPLOYEE',
  "status"         TEXT NOT NULL DEFAULT 'ACTIVE',
  "startAt"        TIMESTAMP(3),
  "endAt"          TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT now(),
  "version"        INTEGER NOT NULL DEFAULT 1
);
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_employmentType_check"
  CHECK ("employmentType" IN ('EMPLOYEE', 'CONTRACTOR', 'INTERN', 'OWNER_OPERATOR'));
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_status_check"
  CHECK (status IN ('ACTIVE', 'ON_LEAVE', 'ENDED'));

CREATE UNIQUE INDEX IF NOT EXISTS "Employment_business_employeeNo_key"
  ON "Employment" ("businessId", "employeeNo") WHERE "employeeNo" IS NOT NULL;
-- One OPEN employment per person per Business — a person may be re-hired
-- later as a new row, never by reopening the old one (same discipline
-- ADR-077 D2's partial unique indexes apply to a revoked Membership).
CREATE UNIQUE INDEX IF NOT EXISTS "Employment_person_business_open_key"
  ON "Employment" ("personId", "businessId") WHERE "endAt" IS NULL;
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_dates_check"
  CHECK ("endAt" IS NULL OR "startAt" IS NULL OR "endAt" >= "startAt");
-- Composite ancestry FK (ADR-077 D4 pattern): Business(id, tenantId) already
-- carries this UNIQUE from the access-grant-lifecycle migration — verified,
-- not re-created.
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_business_tenant_fkey"
  FOREIGN KEY ("businessId", "tenantId") REFERENCES "Business"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Employment_personId_idx" ON "Employment"("personId");
CREATE INDEX IF NOT EXISTS "Employment_tenantId_idx" ON "Employment"("tenantId");
CREATE INDEX IF NOT EXISTS "Employment_businessId_status_idx" ON "Employment"("businessId", status);
CREATE INDEX IF NOT EXISTS "Employment_branchId_idx" ON "Employment"("branchId");

-- ---------------------------------------------------------------------------
-- 5. FR-193 — backfill from Membership, then retire the columns it backfilled
-- ---------------------------------------------------------------------------
-- Only Business-scoped rows: standard HR has no "group-level employment", and
-- a tenant-wide row (`businessId IS NULL`) has no single Business to assign an
-- Employment to. ADR-078 records that production's one `employeeRef` row today
-- is exactly this shape (`PER-BOSS`, tenant-wide) — guessing a Business for it
-- here would be the same move ADR-077 refused for the `domainKeysJson` repair.
INSERT INTO "Employment" ("id", "personId", "tenantId", "businessId", "branchId", "employeeNo", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, m."personId", m."tenantId", m."businessId", m."branchId", m."employeeRef", now(), now()
  FROM "Membership" m
 WHERE m."employeeRef" IS NOT NULL AND m."businessId" IS NOT NULL;

DO $$
DECLARE r record; skipped int := 0;
BEGIN
  FOR r IN SELECT id, "personId", "employeeRef" FROM "Membership"
            WHERE "employeeRef" IS NOT NULL AND "businessId" IS NULL
  LOOP
    RAISE NOTICE 'Membership % (personId=%, employeeRef=%) is a tenant-wide grant and was NOT backfilled into Employment — standard HR has no group-level employment; an operator must place this person''s Employment at a specific Business deliberately.', r.id, r."personId", r."employeeRef";
    skipped := skipped + 1;
  END LOOP;
  RAISE NOTICE '% tenant-wide Membership row(s) with an employeeRef were skipped (see notices above); backfill matched the reviewed production shape (PER-BOSS) if this count is 1.', skipped;
END $$;

ALTER TABLE "Membership" DROP CONSTRAINT IF EXISTS "Membership_branchId_fkey";
ALTER TABLE "Membership" DROP COLUMN "branchId";
ALTER TABLE "Membership" DROP COLUMN "employeeRef";

-- ---------------------------------------------------------------------------
-- 6. RLS and grants — private application tables (new tables only)
-- ---------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['TaxRegistrationBranch', 'Employment'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = 'zuri_app_runtime_all'
    ) THEN
      EXECUTE format('CREATE POLICY zuri_app_runtime_all ON %I FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)', t);
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE %I FROM public, anon, authenticated, service_role', t);
  END LOOP;
END $$;

COMMENT ON TABLE "Employment" IS
  'FR-193 — an HR assignment: who works here, with what title/type, from when to when. Distinct from Membership (who may log in); resolveViewer never reads this table (ADR-078 D1, BR-034).';
COMMENT ON TABLE "TaxRegistrationBranch" IS
  'FR-194 — a LegalEntity''s VAT branch registration (ประมวลรัษฎากร ม.86, ภ.พ.20). ''00000'' is head office. A Branch (operating site) optionally points at one of these; it never carries its own tax branch code (ADR-078 D2).';
COMMENT ON COLUMN "Branch"."kind" IS
  'FR-194 — SITE | WAREHOUSE | KITCHEN | OFFICE. What this Branch IS, independent of whether it has a tax registration.';
COMMENT ON COLUMN "LegalEntity"."tenantId" IS
  'FR-194 — moved from portfolioId (ADR-078 D1): a LegalEntity sits inside the Tenant isolation boundary, not above it (ADR-018 D4).';

COMMIT;
