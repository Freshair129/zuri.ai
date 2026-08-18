-- @req FR-076, FR-078 — project the verified customer-owned scope into the
-- application RBAC database and grant only the separate review capability.
-- @spec ADR-033 D8, CDC-SG-CUSTOMER-DATA-001 v0.3.0B.
-- @tested tests/unit/application-identity-bootstrap-migration.test.js
--
-- This is an approved bootstrap projection, not a copy of zuri_core and not a
-- Product Owner/OWNER grant. The user remains a tenant employee (MEMBER) and
-- receives one Business-scoped CUSTOMER_DATA_REVIEWER binding for SmartGift.

BEGIN;

INSERT INTO "Portfolio" ("id", "code", "name", "createdAt", "updatedAt", "version")
VALUES (
  '5c621811-7e7a-42dd-ac39-ea9e8416ba98',
  'PF-WANNAPA-WORKSPACE',
  'Wannapa Workspace',
  now(), now(), 1
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Tenant" ("id", "code", "portfolioId", "name", "status", "createdAt", "updatedAt", "version")
VALUES (
  '77cdbe70-3111-4a04-922a-8059be99a8b0',
  'TNT-ETOHGROUP',
  '5c621811-7e7a-42dd-ac39-ea9e8416ba98',
  'TNT-EtohGroup',
  'ACTIVE',
  now(), now(), 1
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Business" ("id", "code", "tenantId", "name", "status", "createdAt", "updatedAt", "version")
VALUES
  ('834fa869-62f3-431c-a287-e9a95e91175b', 'BUS-SMARTGIFT', '77cdbe70-3111-4a04-922a-8059be99a8b0', 'SmartGift', 'ACTIVE', now(), now(), 1),
  ('ad6627eb-cc3c-4465-8d55-10ef68786fa3', 'BUS-ETOH-MUKU', '77cdbe70-3111-4a04-922a-8059be99a8b0', 'Etoh-Muku', 'ACTIVE', now(), now(), 1),
  ('dc84f828-df37-4417-84e0-63b863bedb34', 'BUS-MUJEEN', '77cdbe70-3111-4a04-922a-8059be99a8b0', 'Mujeen', 'ACTIVE', now(), now(), 1),
  ('161c1acf-7c0a-44bc-875c-39bee1628685', 'BUS-EMC', '77cdbe70-3111-4a04-922a-8059be99a8b0', 'EMC', 'ACTIVE', now(), now(), 1)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Person" ("id", "code", "displayName", "email", "createdAt", "updatedAt")
VALUES (
  'c82690eb-84e8-48a8-8a28-fe3d839c2276',
  'PER-BOSS',
  'Boss (บอส)',
  NULL,
  now(), now()
)
ON CONFLICT ("id") DO NOTHING;

-- Tenant employment is separate from the review capability. It grants no
-- Business ownership; the tenant-wide MEMBER row only establishes employee
-- scope for the RoleBinding ancestry check.
INSERT INTO "Membership" (
  "id", "personId", "tenantId", "businessId", "branchId", "employeeRef",
  "role", "domainKeysJson", "createdAt"
)
SELECT
  'c5c8c5d2-2bb2-5746-a999-9a13155287f2',
  'c82690eb-84e8-48a8-8a28-fe3d839c2276',
  '77cdbe70-3111-4a04-922a-8059be99a8b0',
  NULL,
  NULL,
  'PER-BOSS',
  'MEMBER',
  '["crm"]',
  now()
WHERE NOT EXISTS (
  SELECT 1
  FROM "Membership"
  WHERE "personId" = 'c82690eb-84e8-48a8-8a28-fe3d839c2276'
    AND "tenantId" = '77cdbe70-3111-4a04-922a-8059be99a8b0'
    AND "businessId" IS NULL
);

-- Initial binding is recorded against the approved migration actor. Normal
-- lifecycle assignment still goes through the Business-owner-authorized RBAC
-- service; this one row is the explicitly approved production bootstrap.
INSERT INTO "RoleBinding" (
  "id", "personId", "tenantId", "businessId", "roleKey", "scopeType",
  "status", "assignedBy", "version", "createdAt", "updatedAt", "revokedAt"
)
VALUES (
  '3771f8fb-bef9-5e54-a4e9-e816a28e9d83',
  'c82690eb-84e8-48a8-8a28-fe3d839c2276',
  '77cdbe70-3111-4a04-922a-8059be99a8b0',
  '834fa869-62f3-431c-a287-e9a95e91175b',
  'CUSTOMER_DATA_REVIEWER',
  'BUSINESS',
  'ACTIVE',
  'c82690eb-84e8-48a8-8a28-fe3d839c2276',
  1,
  now(), now(), NULL
)
ON CONFLICT ("personId", "businessId", "roleKey") DO NOTHING;

INSERT INTO "AuditEvent" (
  "id", "entityType", "entityId", "action", "payloadJson", "actorType", "actorId", "occurredAt"
)
VALUES (
  '8d392803-cbab-51b8-9962-203b0cd41868',
  'ROLE_BINDING',
  '3771f8fb-bef9-5e54-a4e9-e816a28e9d83',
  'ROLE_BINDING_ASSIGNED',
  '{"tenantId":"77cdbe70-3111-4a04-922a-8059be99a8b0","businessId":"834fa869-62f3-431c-a287-e9a95e91175b","personId":"c82690eb-84e8-48a8-8a28-fe3d839c2276","roleKey":"CUSTOMER_DATA_REVIEWER","scopeType":"BUSINESS","status":"ACTIVE","missionId":"MIS-SG-CUSTOMER-DATA-BACKFILL-001","contractId":"CDC-SG-CUSTOMER-DATA-001","versionId":"VER-SG-CUSTOMER-DATA-CONTRACT-0.3.0B"}',
  'PLATFORM_APPROVER',
  'c82690eb-84e8-48a8-8a28-fe3d839c2276',
  now()
)
ON CONFLICT ("id") DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Portfolio"
    WHERE "id" = '5c621811-7e7a-42dd-ac39-ea9e8416ba98'
      AND "code" = 'PF-WANNAPA-WORKSPACE'
      AND "name" = 'Wannapa Workspace'
  ) THEN
    RAISE EXCEPTION 'APPLICATION_IDENTITY_PORTFOLIO_MISMATCH';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "Tenant"
    WHERE "id" = '77cdbe70-3111-4a04-922a-8059be99a8b0'
      AND "code" = 'TNT-ETOHGROUP'
      AND "portfolioId" = '5c621811-7e7a-42dd-ac39-ea9e8416ba98'
      AND "status" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'APPLICATION_IDENTITY_TENANT_MISMATCH';
  END IF;

  IF (
    SELECT count(*) FROM "Business"
    WHERE "tenantId" = '77cdbe70-3111-4a04-922a-8059be99a8b0'
      AND "status" = 'ACTIVE'
      AND "code" IN ('BUS-SMARTGIFT', 'BUS-ETOH-MUKU', 'BUS-MUJEEN', 'BUS-EMC')
  ) <> 4 THEN
    RAISE EXCEPTION 'APPLICATION_IDENTITY_BUSINESS_MISMATCH';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "Person"
    WHERE "id" = 'c82690eb-84e8-48a8-8a28-fe3d839c2276'
      AND "code" = 'PER-BOSS'
      AND "displayName" = 'Boss (บอส)'
  ) THEN
    RAISE EXCEPTION 'APPLICATION_IDENTITY_PERSON_MISMATCH';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "Membership"
    WHERE "personId" = 'c82690eb-84e8-48a8-8a28-fe3d839c2276'
      AND "tenantId" = '77cdbe70-3111-4a04-922a-8059be99a8b0'
      AND "businessId" IS NULL
      AND "role" = 'MEMBER'
      AND "domainKeysJson" = '["crm"]'
  ) THEN
    RAISE EXCEPTION 'APPLICATION_IDENTITY_MEMBERSHIP_MISMATCH';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "RoleBinding"
    WHERE "id" = '3771f8fb-bef9-5e54-a4e9-e816a28e9d83'
      AND "personId" = 'c82690eb-84e8-48a8-8a28-fe3d839c2276'
      AND "tenantId" = '77cdbe70-3111-4a04-922a-8059be99a8b0'
      AND "businessId" = '834fa869-62f3-431c-a287-e9a95e91175b'
      AND "roleKey" = 'CUSTOMER_DATA_REVIEWER'
      AND "scopeType" = 'BUSINESS'
      AND "status" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'APPLICATION_REVIEW_BINDING_MISMATCH';
  END IF;
END $$;

COMMIT;
