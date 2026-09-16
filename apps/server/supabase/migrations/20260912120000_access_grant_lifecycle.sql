-- @req FR-191, FR-192 — Membership becomes a grant with provenance, an explicit
--   scope and a withdrawable lifecycle.
-- @spec ADR-077 D1-D5, ADR-045 D3, BR-033, SDD-092, SEC-008
-- Root cause: .brain/rca/2026-09-12-a-grant-that-cannot-be-withdrawn.md
--
-- Preconditions were verified against this database on 2026-09-12 and are
-- RE-ASSERTED here rather than trusted, because rows can be written between a
-- check and an apply. Each RAISE below aborts the transaction with the exact
-- query an operator needs to see the offending rows.
--
-- Ordering inside the transaction is not cosmetic: every backfill runs before
-- the constraint that depends on it, and the `domainKeysJson` repair runs
-- before anything reads that column, so a failure leaves the database on the
-- old shape rather than half-way to the new one.
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Preconditions
-- ---------------------------------------------------------------------------
DO $$
DECLARE n bigint;
BEGIN
  -- One live grant per person per scope. Duplicates would make the partial
  -- unique indexes below unbuildable, and mean `resolveViewer` has been reading
  -- two rows for one grant.
  SELECT count(*) INTO n FROM (
    SELECT "personId", "businessId" FROM "Membership"
     WHERE "businessId" IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'PRECONDITION: % duplicate per-Business grants. Inspect: SELECT "personId","businessId",count(*) FROM "Membership" WHERE "businessId" IS NOT NULL GROUP BY 1,2 HAVING count(*)>1;', n;
  END IF;

  SELECT count(*) INTO n FROM (
    SELECT "personId", "tenantId" FROM "Membership"
     WHERE "businessId" IS NULL GROUP BY 1,2 HAVING count(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'PRECONDITION: % duplicate tenant-wide grants.', n;
  END IF;

  -- Tenant ancestry. The composite foreign key below makes this a database
  -- invariant; a violating row today would make the ALTER fail with a less
  -- legible message.
  SELECT count(*) INTO n
    FROM "Membership" m JOIN "Business" b ON b.id = m."businessId"
   WHERE m."tenantId" <> b."tenantId";
  IF n > 0 THEN
    RAISE EXCEPTION 'PRECONDITION: % Membership rows whose Business belongs to another Tenant.', n;
  END IF;

  SELECT count(*) INTO n FROM "Membership" WHERE status NOT IN ('PENDING','ACTIVE','SUSPENDED','REVOKED');
  IF n > 0 THEN
    RAISE EXCEPTION 'PRECONDITION: % Membership rows with a status outside the ADR-045 D3 vocabulary.', n;
  END IF;

  SELECT count(*) INTO n FROM "Membership" WHERE role NOT IN ('OWNER','MEMBER');
  IF n > 0 THEN
    RAISE EXCEPTION 'PRECONDITION: % Membership rows with a role outside MEMBERSHIP_ROLES.', n;
  END IF;

  SELECT count(*) INTO n FROM (
    SELECT lower(email) FROM "Person" WHERE email IS NOT NULL GROUP BY 1 HAVING count(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'PRECONDITION: % duplicate lowercased Person emails — resolve before email becomes an identifier.', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. FR-192 — scope is a declared value
-- ---------------------------------------------------------------------------
ALTER TABLE "Membership" ADD COLUMN "scopeType" TEXT;
UPDATE "Membership"
   SET "scopeType" = CASE WHEN "businessId" IS NULL THEN 'TENANT' ELSE 'BUSINESS' END;
ALTER TABLE "Membership" ALTER COLUMN "scopeType" SET NOT NULL;
ALTER TABLE "Membership" ALTER COLUMN "scopeType" SET DEFAULT 'BUSINESS';

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_scope_shape_check" CHECK (
  ("scopeType" = 'TENANT'   AND "businessId" IS NULL) OR
  ("scopeType" = 'BUSINESS' AND "businessId" IS NOT NULL));
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_status_check"
  CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','REVOKED'));
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_role_check"
  CHECK (role IN ('OWNER','MEMBER'));

-- Default deny (ADR-077 D5). Existing rows all carry an explicit role.
ALTER TABLE "Membership" ALTER COLUMN "role" SET DEFAULT 'MEMBER';

-- ---------------------------------------------------------------------------
-- 2. FR-191 — provenance and an end, on the row
-- ---------------------------------------------------------------------------
ALTER TABLE "Membership"
  ADD COLUMN "grantedByPersonId" TEXT,
  ADD COLUMN "grantReason"       TEXT,
  ADD COLUMN "grantSource"       TEXT NOT NULL DEFAULT 'ADMIN',
  ADD COLUMN "expiresAt"         TIMESTAMP(3),
  ADD COLUMN "suspendedAt"       TIMESTAMP(3),
  ADD COLUMN "revokedAt"         TIMESTAMP(3),
  ADD COLUMN "revokedByPersonId" TEXT,
  ADD COLUMN "revokeReason"      TEXT;

ALTER TABLE "Membership"
  ADD CONSTRAINT "Membership_grantedBy_fkey" FOREIGN KEY ("grantedByPersonId")
    REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Membership_revokedBy_fkey" FOREIGN KEY ("revokedByPersonId")
    REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_grantSource_check"
  CHECK ("grantSource" IN ('ADMIN','INVITE','SELF_PROVISION','SEED','MIGRATION'));

-- A revoked grant carries its timestamp and nothing else does; a suspended one
-- likewise. Without these the status column and the timestamps could disagree,
-- and an access review would have two answers.
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_revoked_shape_check"
  CHECK ((status = 'REVOKED') = ("revokedAt" IS NOT NULL));
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_suspended_shape_check"
  CHECK (status <> 'SUSPENDED' OR "suspendedAt" IS NOT NULL);

-- Existing rows: author recoverable only where a MEMBERSHIP_ADDED event names
-- one. Everything else is MIGRATION, which states "predates ADR-077 and the
-- author is unrecoverable" rather than "nobody granted it".
UPDATE "Membership" SET "grantSource" = 'MIGRATION';
UPDATE "Membership" m
   SET "grantedByPersonId" = a."actorId", "grantSource" = 'ADMIN'
  FROM "AuditEvent" a
 WHERE a."entityType" = 'MEMBERSHIP'
   AND a.action = 'MEMBERSHIP_ADDED'
   AND a."entityId" = m.id
   AND a."actorId" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. FR-192 — invariants the database holds, not application convention
-- ---------------------------------------------------------------------------
ALTER TABLE "Business" ADD CONSTRAINT "Business_id_tenantId_key" UNIQUE ("id","tenantId");

-- Restrict, not SetNull. The null that cascade wrote was the tenant-wide
-- wildcard: deleting one Business promoted its members to the whole group and
-- its owners to ownsTenant (FR-074(b)).
ALTER TABLE "Membership" DROP CONSTRAINT "Membership_businessId_fkey";
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_business_tenant_fkey"
  FOREIGN KEY ("businessId","tenantId") REFERENCES "Business"("id","tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Workspace" DROP CONSTRAINT "Workspace_businessId_fkey";
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Project" DROP CONSTRAINT "Project_businessId_fkey";
ALTER TABLE "Project" ADD CONSTRAINT "Project_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- One LIVE grant per person per scope. REVOKED is excluded so a revoked grant
-- stays as evidence while the same scope can be granted again as a new row.
CREATE UNIQUE INDEX "Membership_person_tenant_scope_key"
  ON "Membership" ("personId","tenantId")
  WHERE "scopeType" = 'TENANT' AND status <> 'REVOKED';
CREATE UNIQUE INDEX "Membership_person_business_scope_key"
  ON "Membership" ("personId","businessId")
  WHERE "scopeType" = 'BUSINESS' AND status <> 'REVOKED';

CREATE INDEX "Membership_businessId_status_idx" ON "Membership" ("businessId", status);
CREATE INDEX "Membership_expiresAt_status_idx"  ON "Membership" ("expiresAt", status);

-- ---------------------------------------------------------------------------
-- 3b. FR-191 — why a RoleBinding is not active
-- ---------------------------------------------------------------------------
-- Set when a Membership suspension or revocation cascaded to this binding, so
-- reinstating that Membership restores exactly what it took down and leaves
-- alone a binding somebody suspended deliberately.
ALTER TABLE "RoleBinding" ADD COLUMN "cascadeOfMembershipId" TEXT;
CREATE INDEX "RoleBinding_cascadeOfMembershipId_idx" ON "RoleBinding" ("cascadeOfMembershipId");

-- ---------------------------------------------------------------------------
-- 4. SEC-026 — an account that can be closed
-- ---------------------------------------------------------------------------
ALTER TABLE "Person"
  ADD COLUMN "accessDisabledAt"     TIMESTAMP(3),
  ADD COLUMN "accessDisabledReason" TEXT;

-- email becomes the identifier a person is addressed by (FR-120's recorded gap).
CREATE UNIQUE INDEX "Person_email_lower_key" ON "Person" (lower(email)) WHERE email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Repair: a stored domain key that is not a grantable domain
-- ---------------------------------------------------------------------------
-- `crm` and `scm` are DOMAIN_GROUPS keys, not DOMAINS keys. `buildDomainsByBusiness`
-- filters an unknown key out at READ time, so a row holding one reads as a grant
-- in the database and resolves to nothing in the application, with no report
-- either way. One production row holds `["crm"]`.
--
-- **Repaired by dropping the key, never by expanding it to the group's
-- children.** Expanding would be a guess at intent that GRANTS ACCESS THE
-- PERSON DOES NOT HAVE TODAY: `crm` already resolves to zero domains, so
-- dropping it makes the stored value agree with the effective one, while
-- expanding it would hand out `customer` and `market` on the authority of a
-- migration — which has no authorizer, cannot be reviewed, and is exactly what
-- least privilege forbids. A grant needs a person who granted it; that path now
-- exists (FR-191), and an owner who wants this person to have CRM can say so
-- there, with a reason and an audit trail.
--
-- The previous value is recorded so the decision is recoverable rather than
-- merely reversible.
DO $$
DECLARE r record; repaired int := 0;
BEGIN
  FOR r IN SELECT id, "domainKeysJson" FROM "Membership"
            WHERE "domainKeysJson" LIKE '%"crm"%' OR "domainKeysJson" LIKE '%"scm"%'
  LOOP
    UPDATE "Membership"
       SET "domainKeysJson" = (
         SELECT coalesce(jsonb_agg(DISTINCT e), '[]'::jsonb)::text
           FROM jsonb_array_elements_text(r."domainKeysJson"::jsonb) e
          WHERE e IN ('business-home','commerce','customer','market','growth','operations',
                      'people','projects','assets','line-oa','inventory','warehouse',
                      'procurement','platform'))
     WHERE id = r.id;
    INSERT INTO "AuditEvent" (id, "entityType", "entityId", action, "payloadJson", "actorType", "actorId", "occurredAt")
    VALUES (gen_random_uuid()::text, 'MEMBERSHIP', r.id, 'DOMAIN_KEYS_REPAIRED',
            json_build_object(
              'from', r."domainKeysJson",
              'reason', 'group key stored as a grant; dropped rather than expanded (ADR-077, FR-192) — it granted nothing before this migration and grants nothing after it',
              'reGrantVia', 'PATCH /api/platform/users')::text,
            'PIPELINE_OPERATOR', NULL, now());
    repaired := repaired + 1;
  END LOOP;
  RAISE NOTICE 'domainKeysJson repaired on % row(s) — group keys dropped, effective access unchanged', repaired;
END $$;

COMMIT;
