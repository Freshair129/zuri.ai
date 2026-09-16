-- @req FR-195, FR-196, FR-197 — AccessInvite replaces WorkspaceInvite;
--   segregation of duties gets a writer (role conflicts + a transaction rule);
--   operator access becomes time-boxed, issuable and its use recorded.
-- @spec ADR-079, BR-035, SEC-027, SDD-094
--
-- Preconditions are re-asserted at apply time rather than trusted, the same
-- discipline 20260912120000_access_grant_lifecycle.sql uses: rows can be
-- written between a check and an apply. `WorkspaceInvite` and
-- `WorkspaceMembership` were independently confirmed to hold zero rows on
-- 2026-09-12, which is what makes the AccessInvite generalisation a pure DDL
-- change rather than a data migration; the DO block below re-confirms it
-- rather than assuming it is still true when this file is applied.
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Preconditions
-- ---------------------------------------------------------------------------
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM "WorkspaceInvite";
  IF n > 0 THEN
    RAISE EXCEPTION 'PRECONDITION: % WorkspaceInvite row(s) exist. This migration renames the table on the assumption of zero rows (2026-09-12); a live row needs a data-carrying migration instead.', n;
  END IF;

  SELECT count(*) INTO n FROM "RoleBinding" WHERE "businessId" IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'PRECONDITION: % RoleBinding row(s) already have a NULL businessId before this migration made the column nullable — investigate before proceeding.', n;
  END IF;

  SELECT count(*) INTO n FROM (
    SELECT "personId", "capability" FROM "PlatformGrant" GROUP BY 1,2 HAVING count(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'PRECONDITION: % (personId, capability) pair(s) already hold more than one PlatformGrant row — the old @@unique should have prevented this.', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. FR-195 — WorkspaceInvite generalises into AccessInvite
-- ---------------------------------------------------------------------------
ALTER TABLE "WorkspaceInvite" RENAME TO "AccessInvite";
ALTER TABLE "AccessInvite" RENAME CONSTRAINT "WorkspaceInvite_pkey" TO "AccessInvite_pkey";

-- Every existing row is PORTFOLIO scope (the only scope WorkspaceInvite ever
-- had); the column is added NOT NULL with that default so the backfill and
-- the constraint are the same statement.
ALTER TABLE "AccessInvite" ADD COLUMN "scopeType" TEXT NOT NULL DEFAULT 'PORTFOLIO';
ALTER TABLE "AccessInvite" ALTER COLUMN "portfolioId" DROP NOT NULL;
ALTER TABLE "AccessInvite"
  ADD COLUMN "tenantId"             TEXT,
  ADD COLUMN "businessId"           TEXT,
  ADD COLUMN "invitedLineUserId"    TEXT,
  ADD COLUMN "domainKeysJson"       TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN "reason"               TEXT,
  ADD COLUMN "acceptedMembershipId" TEXT,
  ADD COLUMN "revokedByPersonId"    TEXT;

ALTER TABLE "AccessInvite"
  ADD CONSTRAINT "AccessInvite_revokedBy_fkey" FOREIGN KEY ("revokedByPersonId")
    REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- EXPIRED and DECLINED are not new persisted states beyond what WorkspaceInvite
-- already had for the first (PENDING/ACCEPTED/REVOKED); DECLINED is genuinely
-- new (FR-195) — a targeted invite the addressee actively turns down.
ALTER TABLE "AccessInvite" ADD CONSTRAINT "AccessInvite_status_check"
  CHECK (status IN ('PENDING','ACCEPTED','DECLINED','REVOKED'));
ALTER TABLE "AccessInvite" ADD CONSTRAINT "AccessInvite_role_check"
  CHECK (role IN ('OWNER','ADMIN','MEMBER'));
-- OWNER is refused at the application boundary (mint never accepts it); this
-- CHECK is the second layer, matching the discipline `Membership_role_check`
-- already applies to the grant this invite can become.

ALTER TABLE "AccessInvite" ADD CONSTRAINT "AccessInvite_scope_shape_check" CHECK (
  ("scopeType" = 'PORTFOLIO' AND "portfolioId" IS NOT NULL AND "tenantId" IS NULL     AND "businessId" IS NULL) OR
  ("scopeType" = 'TENANT'    AND "portfolioId" IS NULL     AND "tenantId" IS NOT NULL AND "businessId" IS NULL) OR
  ("scopeType" = 'BUSINESS'  AND "portfolioId" IS NULL     AND "tenantId" IS NOT NULL AND "businessId" IS NOT NULL));
ALTER TABLE "AccessInvite" ADD CONSTRAINT "AccessInvite_addressee_check" CHECK (
  num_nonnulls("targetPersonId","invitedEmail","invitedLineUserId") >= 1);

ALTER TABLE "AccessInvite"
  ADD CONSTRAINT "AccessInvite_tenantId_fkey" FOREIGN KEY ("tenantId")
    REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AccessInvite_businessId_fkey" FOREIGN KEY ("businessId")
    REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "AccessInvite_tenantId_status_idx"   ON "AccessInvite" ("tenantId", status);
CREATE INDEX "AccessInvite_businessId_status_idx" ON "AccessInvite" ("businessId", status);

-- Only one PENDING invite per (Business, lower(email)) — the FR-067 discipline
-- ("mint refuses a duplicate pending invite") extended to the new scopes it
-- did not have before. PORTFOLIO scope keeps its own behaviour unchanged: it
-- has no businessId, so this partial index never matches a PORTFOLIO row.
CREATE UNIQUE INDEX "AccessInvite_pending_email_key" ON "AccessInvite" ("businessId", lower("invitedEmail"))
  WHERE status = 'PENDING' AND "invitedEmail" IS NOT NULL;

COMMENT ON TABLE "AccessInvite" IS
  'FR-195 — a scoped, expiring, single-use invitation that becomes a real grant on acceptance: PORTFOLIO scope creates a WorkspaceMembership (BR-016, unchanged from FR-067); TENANT/BUSINESS scope creates a Membership via grantBusinessMembership (ADR-077 D8). Stores only the SHA-256 token digest (SEC-014); the raw token is returned exactly once at mint and never persisted or logged. Renamed from WorkspaceInvite 2026-09-12 (ADR-079) — its indexes and RLS policy carry the old table name and were not renamed, which is cosmetic only (Postgres tracks both by OID, not name).';

COMMENT ON COLUMN "AccessInvite"."acceptedMembershipId" IS
  'FR-195 — the Membership this invite became on acceptance (TENANT/BUSINESS scope only). Not a foreign key: identity''s Membership writer (ADR-077 D8) is the row''s only creator, and this column only records which one it produced.';

-- ---------------------------------------------------------------------------
-- 2. FR-192/ADR-077 D3 — RoleBinding learns the TENANT scope at the write side
-- ---------------------------------------------------------------------------
-- `businessId` becomes nullable so a TENANT-scoped row can exist at all.
-- Postgres treats NULLs as distinct under a plain UNIQUE index, so the old
-- constraint would not have deduplicated a TENANT row anyway — the two
-- partial indexes below replace it with the ADR-077 D4 pattern.
DROP INDEX "RoleBinding_personId_businessId_roleKey_key";
ALTER TABLE "RoleBinding" ALTER COLUMN "businessId" DROP NOT NULL;
ALTER TABLE "RoleBinding" ADD COLUMN "sodOverrideReason" TEXT;

ALTER TABLE "RoleBinding" DROP CONSTRAINT "RoleBinding_businessId_fkey";
ALTER TABLE "RoleBinding" ADD CONSTRAINT "RoleBinding_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RoleBinding" ADD CONSTRAINT "RoleBinding_scope_shape_check" CHECK (
  ("scopeType" = 'BUSINESS' AND "businessId" IS NOT NULL) OR
  ("scopeType" = 'TENANT'   AND "businessId" IS NULL) OR
  ("scopeType" = 'BRANCH'));
-- BRANCH is declared in ROLE_BINDING_SCOPE_TYPES (ADR-077 D3) and resolved by
-- nothing yet — its shape is deliberately unconstrained here rather than
-- guessed at, the same "additive, does not resolve to anything" reasoning
-- that let TENANT sit inert until this change taught the resolver to expand it.

CREATE UNIQUE INDEX "RoleBinding_person_business_role_key"
  ON "RoleBinding" ("personId","businessId","roleKey")
  WHERE "scopeType" = 'BUSINESS';
CREATE UNIQUE INDEX "RoleBinding_person_tenant_role_key"
  ON "RoleBinding" ("personId","tenantId","roleKey")
  WHERE "scopeType" = 'TENANT';

-- ---------------------------------------------------------------------------
-- 3. FR-197 — operator access is time-boxed, issuable, and a fresh grant
-- ---------------------------------------------------------------------------
DROP INDEX "PlatformGrant_personId_capability_key";
ALTER TABLE "PlatformGrant"
  ADD COLUMN "grantReason" TEXT,
  ADD COLUMN "expiresAt"   TIMESTAMP(3),
  ADD COLUMN "standing"    BOOLEAN NOT NULL DEFAULT false;

-- Every grant that exists today predates FR-197 and was minted by
-- `bootstrapOperator` (the only writer before this change) — flagged standing
-- so `issueOperatorGrant`'s 90-day cap and mandatory expiry are read correctly
-- as applying only to what it issues from here on.
UPDATE "PlatformGrant" SET "standing" = true;

CREATE UNIQUE INDEX "PlatformGrant_person_capability_active_key"
  ON "PlatformGrant" ("personId","capability")
  WHERE status = 'ACTIVE';

COMMIT;
