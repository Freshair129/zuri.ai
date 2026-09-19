---
id: ZAI:PM-PHASE-B-W1-RLS-POLICY
title: Project Manager Phase B W1 PostgreSQL scope and RLS handshake
version: "0.2.4b"
status: beta
created_at: "2026-09-17T03:20:52+07:00,Luna Max,61e28ac99de188dbeb072bf023f5acb1dc7f4910"
last_update: "2026-09-17T05:10:00+07:00,RWANG"
superseded_by: null
attributes:
  doc_type: implementation-plan
  domain: project-manager
  scope: "MA-I02 Phase B W1 PostgreSQL RLS and adapter scope handshake"
  complexity: "C-3 / HIGH"
  evidence_level: "LOCAL MIGRATION AND ISOLATED ROLE PROOF; NO PRODUCTION PROOF"
  source_commit: "bd99651f2322e7c15be04a834399dee4d397cbb4"
  authority_source_commit: "f061a113584aa15db68934dc8451f14b9a1011e1"
  canonical_id_status: "FR-252 / ADR-097 registered; B1 and B2 closed"
relations:
  - type: references
    target: ZAI:PM-PHASE-B-FEATURE-IMPLEMENTATION-PLAN
  - type: references
    target: ZAI:FR-252-P1
  - type: references
    target: ZAI:ADR-097
---

# Phase B W1 PostgreSQL security design

**Local W1 database proof passed; adapter and production proof pending.** The owner-approved
Phase B plan delegates this pre-DDL gate to independent Luna Max review and
root. Both accepted the frozen v0.2.1b policy on 2026-09-17 after the exact
nine-operation receipt predicate closed P1-W1-01. Source policy SHA-256:
FF60F6FA9729FD02F0CAA5CBB09FB6F1A170C93BB07A7CC8D71F66A5A547D3B7.
Independent closure report SHA-256:
EC63E7D0E1527191C78D878EB9C5FAE3F909E30ABBDA1A0D49E3A6B917F96CE4.

This document specifies W1 database policy and W2's adapter handshake. It
authorizes bounded local schema/migration authoring and isolated proof only.
It does not establish runtime or production readiness, approve a maintenance
restore capability, or change a live credential. The available isolated
Postgres 17 image supplies the planned proof environment.

Root review additionally found that ProjectFeature's optional snapshot pin
needs the same-scope parent backstop already required by the selected data
contract's snapshotProof invariant. Version 0.2.2b added that predicate and
passed independent delta review at SHA-256
1CC1EC69EEDB90ED5F8A6D67036D10072CCFEDB5CC37783CD1A93548AD3F0142.
Version 0.2.3b makes the bounded grants idempotent by revoking any prior direct
runtime/web grant on these six new tables before applying the selected set.
An isolated negative test proved that GRANT alone retained unintended immutable
UPDATE/DELETE rights. No authority is widened; the root RCA records the failure.

The corrected provider migration SHA-256
9CDC9DEC66A479B55238488E4BC8E14B637BB9CA9AF2E7671AA5A382767D60C3
passed 129 isolated non-bypass-role checks and 11 catalog/grant collision checks.
Independent Luna Max provider implementation review passed at that migration
hash and policy v0.2.3b hash
584B7AB92FC076DEF3BEECFCE4A63AD52AC0433839C02B63A8AC6F6987CD5FA8.
This revision records the review outcome without changing its SQL policy. W2 adapter,
complete recovery, privacy and actual production-role proof are not established
by those database-only tests.

## 1. Security decision

The selected [six-record data contract](contracts/phase-b/data-model.candidate.json)
is a JSON artifact; its machine ID is not a Markdown registry node. The typed
document relationship therefore targets its owning FR-252-P1 phase.

The six new Phase B tables are scoped by their server-derived `tenantId` and
`businessId` columns **and by the complete parent hierarchy of each row**. The
existing PM scope resolver must establish a trusted `ScopeProof` before any
new-table aggregate or receipt query. The adapter then sets two
transaction-local PostgreSQL settings on the **same connection**:

```text
zuri.pm_tenant_id
zuri.pm_business_id
```

Every policy compares both row columns to those settings, requires the row's
same-scope parent joins, and explicitly denies when either setting is missing
or empty. The request path, body, headers, Origin and CSRF token never supply
row scope. A body `tenantId` or `businessId` is ignored/rejected as input data;
only the server-resolved Project hierarchy can produce `ScopeProof`.

`GovernanceSnapshot` and `ProjectFeatureMutationReceipt` are append-only for
the application runtime: runtime grants and RLS policies permit SELECT and
INSERT only. The four mutable authority/relationship tables use scoped
SELECT/INSERT/UPDATE/DELETE policies; the service contract still uses soft
delete and never exposes physical delete as a normal Feature command. No
policy uses role-only `USING (true)` or `WITH CHECK (true)`.

This design changes no existing table, role or credential. It grants the
existing `zuri_app_runtime` role only on the six new tables; the existing
`zuri_web_login` login continues to inherit that role and receives no direct
table grant. It does not create a role, set a password, alter default
privileges, or rewrite policies on existing tables.

## 2. W2 adapter handshake

W2 should expose one internal boundary, conceptually:

```text
withPhaseBScope({ db, viewer, projectId, capability, operation }, callback)
  -> callback({ tx, scopeProof })
```

`ScopeProof` is server memory, not a client DTO:

```text
{
  tenantId, businessId, projectId,
  viewerId, readScope, capability
}
```

The required sequence is:

1. Start a database transaction. For PostgreSQL use the same transaction
   connection for every resolver, setting and Phase B query. For a write use
   the selected serializable transaction/retry boundary.
2. Before setting anything, read the two settings with
   `current_setting(name, true)`. Missing settings return `NULL`; a PostgreSQL
   `RESET` may also leave an empty string. Treat both `NULL` and empty as the
   unbound initial state. If either setting is non-empty at the start, abort
   with an internal scope-context failure. A reused pooled connection must not
   silently carry a prior tenant; the adapter never resets a non-empty value
   and guesses a new scope.
3. Resolve the live viewer/session and the complete
   `Project -> Workspace -> Business -> Tenant` chain through the transaction
   client. Reject missing/deleted/mismatched hierarchy before any Phase B
   aggregate, child, receipt or replay lookup. For writes, require Business
   ownership; for reads preserve the approved TENANT/PORTFOLIO shared-read
   behavior while still binding the Project's trusted Business.
4. For a mutation, lock the existing Project row with `SELECT ... FOR UPDATE`
   before receipt/aggregate work, then re-read the hierarchy and authorization
   under that lock. An ungoverned legacy Project with no trusted Business is
   refused; no Tenant-only Feature authority is invented.
5. After the guard/recheck succeeds, set both settings locally on that same
   connection. Verify the readback equals the proof exactly. A mismatch or a
   failed `set_config` aborts before a new-table query.
6. Invoke the callback with only `tx` and the server proof. Every new-table
   query, including replay lookup, uses `tx`; a root Prisma client cannot be
   used after the settings are set.
7. Commit or roll back the transaction. `is_local=true` makes both settings
   revert at transaction end. A serialization/deadlock retry starts a fresh
   transaction, repeats the hierarchy guard and sets fresh local values; it
   never reuses a stale proof or connection setting.

The exact PostgreSQL handshake statements are:

```sql
BEGIN;

-- Adapter assertion. NULL or '' means an unbound/reset context; any non-empty
-- value means pool/session contamination and is a fail-closed error.
SELECT current_setting('zuri.pm_tenant_id', true) AS prior_tenant,
       current_setting('zuri.pm_business_id', true) AS prior_business;

-- Full live viewer and Project/Workspace/Business/Tenant guard happens here.
-- For a write, lock and re-read the Project before continuing.

SELECT set_config('zuri.pm_tenant_id', $1, true),
       set_config('zuri.pm_business_id', $2, true);

SELECT current_setting('zuri.pm_tenant_id', true) AS bound_tenant,
       current_setting('zuri.pm_business_id', true) AS bound_business;
-- Adapter compares these values byte-for-byte with the server ScopeProof.

-- All Phase B queries use this transaction connection.
COMMIT;
```

`true` is mandatory on both `set_config` calls. `SET` without `LOCAL`,
`set_config(..., false)`, a process-global variable and a connection-scoped
cache are prohibited. If the initial assertion finds stale settings, the
adapter fails closed rather than resetting and guessing which scope was
intended. If the transaction aborts, PostgreSQL removes the local settings.
A policy treats either `NULL` or `''` as unbound and denies the row; both
non-empty settings are required.

SQLite has no equivalent RLS setting. Its adapter must pass the same proof to
every repository query, add trusted `tenantId`/`businessId` predicates, and
use `BEGIN IMMEDIATE` for Phase B writes. It must not emulate the settings in
module or process state. This keeps provider behavior equivalent and prevents
cross-request scope leakage in the local pool.

## 3. Proposed policy and grant SQL

The two scope columns are necessary but insufficient. A row carrying valid
Business A columns must still be rejected if its Project, Feature, WorkItem,
Repository or AuditEvent parent belongs to Business B. The expressions below
are the selected database backstop. Each named `P_*` block is a documentation
alias for the full expression immediately below it; the W1 migration must
inline that expression into both `USING` and `WITH CHECK` where shown. No
`P_*`, `<table>`, `SCOPE_PREDICATE` or generic role-only token may remain in
the migration.

### 3.1 Roles, RLS and grants

```sql
-- Existing roles only. No CREATE ROLE, password, default privilege or
-- existing-table change belongs here.
ALTER TABLE "ProjectFeature" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectFeature" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FeatureContribution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeatureContribution" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FeatureWorkLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeatureWorkLink" FORCE ROW LEVEL SECURITY;
ALTER TABLE "RequirementBinding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RequirementBinding" FORCE ROW LEVEL SECURITY;
ALTER TABLE "GovernanceSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GovernanceSnapshot" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ProjectFeatureMutationReceipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectFeatureMutationReceipt" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  "ProjectFeature", "FeatureContribution", "FeatureWorkLink",
  "RequirementBinding", "GovernanceSnapshot",
  "ProjectFeatureMutationReceipt"
  FROM public, anon, authenticated, service_role, zuri_app_runtime, zuri_web_login;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "ProjectFeature", "FeatureContribution", "FeatureWorkLink",
  "RequirementBinding"
  TO zuri_app_runtime;
GRANT SELECT, INSERT ON TABLE
  "GovernanceSnapshot", "ProjectFeatureMutationReceipt"
  TO zuri_app_runtime;
```

`zuri_web_login` inherits `zuri_app_runtime`; it receives no direct table
grant. The grants above cover ordinary application operations. A full backup
restore/import maintenance role is a separate root-composed gate and is not
granted here, especially not for the immutable snapshot or receipt tables.

### 3.2 ProjectFeature parent predicate (`P_PF`)

This exact expression binds a Feature to its Project and the live
Project→Workspace→Business→Tenant chain. It preserves the existing
`BUSINESS`, `TENANT` and `PORTFOLIO` Workspace rules; it does not assume that
`Workspace.businessId` is null for the latter two scopes. For a BUSINESS
Workspace, a nullable `Workspace.tenantId` is accepted only when the
Workspace's Business matches the Project; when present it must match the
Business's Tenant. TENANT and PORTFOLIO Workspaces require their tenant (and,
for PORTFOLIO, portfolio) match.

```sql
-- P_PF: outer relation is "ProjectFeature".
NULLIF(current_setting('zuri.pm_tenant_id', true), '') IS NOT NULL
AND NULLIF(current_setting('zuri.pm_business_id', true), '') IS NOT NULL
AND "ProjectFeature"."tenantId" = current_setting('zuri.pm_tenant_id', true)
AND "ProjectFeature"."businessId" = current_setting('zuri.pm_business_id', true)
AND EXISTS (
  SELECT 1
  FROM "Project" p
  JOIN "Workspace" w ON w."id" = p."workspaceId"
  JOIN "Business" b ON b."id" = p."businessId"
  JOIN "Tenant" t ON t."id" = b."tenantId"
  WHERE p."id" = "ProjectFeature"."projectId"
    AND p."businessId" IS NOT NULL
    AND p."businessId" = "ProjectFeature"."businessId"
    AND b."id" = "ProjectFeature"."businessId"
    AND b."tenantId" = "ProjectFeature"."tenantId"
    AND (
      (
        w."scopeType" = 'BUSINESS'
        AND w."businessId" = p."businessId"
        AND (w."tenantId" IS NULL OR w."tenantId" = t."id")
      )
      OR (w."scopeType" = 'TENANT' AND w."tenantId" = t."id")
      OR (
        w."scopeType" = 'PORTFOLIO'
        AND w."tenantId" = t."id"
        AND w."portfolioId" = t."portfolioId"
      )
    )
    AND p."deletedAt" IS NULL
)
AND (
  "ProjectFeature"."governanceSnapshotId" IS NULL
  OR EXISTS (
    SELECT 1
    FROM "GovernanceSnapshot" s
    JOIN "ProjectRepository" spr ON spr."id" = s."projectRepositoryId"
    JOIN "Repository" sr ON sr."id" = s."repositoryId"
    WHERE s."id" = "ProjectFeature"."governanceSnapshotId"
      AND s."tenantId" = "ProjectFeature"."tenantId"
      AND s."businessId" = "ProjectFeature"."businessId"
      AND s."validationStatus" = 'VALID'
      AND s."sourceManifest" IS NOT NULL
      AND spr."projectId" = "ProjectFeature"."projectId"
      AND spr."repoId" = sr."id"
      AND sr."businessId" = "ProjectFeature"."businessId"
  )
);
```

The optional pin must resolve to the same scoped, valid snapshot chain. The
database pair constraint separately requires both canonicalFeatureKey and
governanceSnapshotId together. Proving that the manifest actually contains the
canonicalFeatureKey remains the verified-source service's responsibility.

The four mutable policies are explicit and use the corresponding complete
predicate in both directions. The following mapping is a reviewable policy
shape; W1 expands each `P_*` alias with the exact block above or below and
performs deterministic definition collision checks:

```sql
CREATE POLICY "phase_b_project_feature"
  ON "ProjectFeature" FOR ALL TO zuri_app_runtime, zuri_web_login
  USING (P_PF)
  WITH CHECK (P_PF);

CREATE POLICY "phase_b_feature_contribution"
  ON "FeatureContribution" FOR ALL TO zuri_app_runtime, zuri_web_login
  USING (P_FC)
  WITH CHECK (P_FC);

CREATE POLICY "phase_b_feature_work_link"
  ON "FeatureWorkLink" FOR ALL TO zuri_app_runtime, zuri_web_login
  USING (P_FWL)
  WITH CHECK (P_FWL);

CREATE POLICY "phase_b_requirement_binding"
  ON "RequirementBinding" FOR ALL TO zuri_app_runtime, zuri_web_login
  USING (P_RB)
  WITH CHECK (P_RB);
```

`FOR ALL` is shorthand for the required SELECT/INSERT/UPDATE/DELETE coverage
on each mutable table; the migration must retain both the old-row `USING`
predicate and the new-row `WITH CHECK` predicate. Normal Feature deletion is
still a service-level soft delete; physical delete remains limited to the
scoped import/maintenance seam.

### 3.3 Child parent predicates (`P_FC`, `P_FWL`, `P_RB`)

Each child first compares its own trusted scope columns, then joins its
Feature by ID **and by the same tenant/business**, and finally repeats the
complete Project hierarchy predicate. This prevents a same-scope child from
pointing at a foreign Feature. Deleted Feature rows remain addressable for
the explicit restore family; the parent Project itself must remain live.

```sql
-- P_FC: outer relation is "FeatureContribution".
NULLIF(current_setting('zuri.pm_tenant_id', true), '') IS NOT NULL
AND NULLIF(current_setting('zuri.pm_business_id', true), '') IS NOT NULL
AND "FeatureContribution"."tenantId" = current_setting('zuri.pm_tenant_id', true)
AND "FeatureContribution"."businessId" = current_setting('zuri.pm_business_id', true)
AND EXISTS (
  SELECT 1
  FROM "ProjectFeature" f
  JOIN "Project" p ON p."id" = f."projectId"
  JOIN "Workspace" w ON w."id" = p."workspaceId"
  JOIN "Business" b ON b."id" = p."businessId"
  JOIN "Tenant" t ON t."id" = b."tenantId"
  WHERE f."id" = "FeatureContribution"."featureId"
    AND f."tenantId" = "FeatureContribution"."tenantId"
    AND f."businessId" = "FeatureContribution"."businessId"
    AND p."businessId" IS NOT NULL
    AND p."businessId" = f."businessId"
    AND b."id" = f."businessId"
    AND b."tenantId" = f."tenantId"
    AND (
      (
        w."scopeType" = 'BUSINESS'
        AND w."businessId" = p."businessId"
        AND (w."tenantId" IS NULL OR w."tenantId" = t."id")
      )
      OR (w."scopeType" = 'TENANT' AND w."tenantId" = t."id")
      OR (
        w."scopeType" = 'PORTFOLIO'
        AND w."tenantId" = t."id"
        AND w."portfolioId" = t."portfolioId"
      )
    )
    AND p."deletedAt" IS NULL
);

-- P_FWL: outer relation is "FeatureWorkLink".
NULLIF(current_setting('zuri.pm_tenant_id', true), '') IS NOT NULL
AND NULLIF(current_setting('zuri.pm_business_id', true), '') IS NOT NULL
AND "FeatureWorkLink"."tenantId" = current_setting('zuri.pm_tenant_id', true)
AND "FeatureWorkLink"."businessId" = current_setting('zuri.pm_business_id', true)
AND EXISTS (
  SELECT 1
  FROM "ProjectFeature" f
  JOIN "Project" p ON p."id" = f."projectId"
  JOIN "Workspace" w ON w."id" = p."workspaceId"
  JOIN "Business" b ON b."id" = p."businessId"
  JOIN "Tenant" t ON t."id" = b."tenantId"
  JOIN "WorkItem" wi ON wi."id" = "FeatureWorkLink"."workItemId"
  JOIN "Workstream" ws ON ws."id" = wi."workstreamId"
  WHERE f."id" = "FeatureWorkLink"."featureId"
    AND f."tenantId" = "FeatureWorkLink"."tenantId"
    AND f."businessId" = "FeatureWorkLink"."businessId"
    AND p."businessId" IS NOT NULL
    AND p."businessId" = f."businessId"
    AND b."id" = f."businessId"
    AND b."tenantId" = f."tenantId"
    AND (
      (
        w."scopeType" = 'BUSINESS'
        AND w."businessId" = p."businessId"
        AND (w."tenantId" IS NULL OR w."tenantId" = t."id")
      )
      OR (w."scopeType" = 'TENANT' AND w."tenantId" = t."id")
      OR (
        w."scopeType" = 'PORTFOLIO'
        AND w."tenantId" = t."id"
        AND w."portfolioId" = t."portfolioId"
      )
    )
    AND p."deletedAt" IS NULL
    AND wi."deletedAt" IS NULL
    AND ws."projectId" = f."projectId"
    AND ws."deletedAt" IS NULL
    AND (
      wi."containerId" IS NULL
      OR EXISTS (
        SELECT 1
        FROM "WorkContainer" c
        WHERE c."id" = wi."containerId"
          AND c."workstreamId" = ws."id"
      )
    )
);

-- P_RB: outer relation is "RequirementBinding".
NULLIF(current_setting('zuri.pm_tenant_id', true), '') IS NOT NULL
AND NULLIF(current_setting('zuri.pm_business_id', true), '') IS NOT NULL
AND "RequirementBinding"."tenantId" = current_setting('zuri.pm_tenant_id', true)
AND "RequirementBinding"."businessId" = current_setting('zuri.pm_business_id', true)
AND EXISTS (
  SELECT 1
  FROM "ProjectFeature" f
  JOIN "Project" p ON p."id" = f."projectId"
  JOIN "Workspace" w ON w."id" = p."workspaceId"
  JOIN "Business" b ON b."id" = p."businessId"
  JOIN "Tenant" t ON t."id" = b."tenantId"
  JOIN "GovernanceSnapshot" s
    ON s."id" = "RequirementBinding"."governanceSnapshotId"
  JOIN "ProjectRepository" spr ON spr."id" = s."projectRepositoryId"
  JOIN "Repository" sr ON sr."id" = s."repositoryId"
  WHERE f."id" = "RequirementBinding"."featureId"
    AND f."tenantId" = "RequirementBinding"."tenantId"
    AND f."businessId" = "RequirementBinding"."businessId"
    AND p."businessId" IS NOT NULL
    AND p."businessId" = f."businessId"
    AND b."id" = f."businessId"
    AND b."tenantId" = f."tenantId"
    AND (
      (
        w."scopeType" = 'BUSINESS'
        AND w."businessId" = p."businessId"
        AND (w."tenantId" IS NULL OR w."tenantId" = t."id")
      )
      OR (w."scopeType" = 'TENANT' AND w."tenantId" = t."id")
      OR (
        w."scopeType" = 'PORTFOLIO'
        AND w."tenantId" = t."id"
        AND w."portfolioId" = t."portfolioId"
      )
    )
    AND p."deletedAt" IS NULL
    AND s."tenantId" = "RequirementBinding"."tenantId"
    AND s."businessId" = "RequirementBinding"."businessId"
    AND s."validationStatus" = 'VALID'
    AND s."sourceManifest" IS NOT NULL
    AND spr."projectId" = f."projectId"
    AND spr."repoId" = sr."id"
    AND sr."businessId" = f."businessId"
);
```

`P_FWL` deliberately follows `WorkItem → Workstream`, requires the Workstream
to belong to the Feature's Project and requires an optional WorkContainer to
belong to that same Workstream. It does not invent a `WorkContainer.deletedAt`
column. `P_RB` binds the snapshot's current `ProjectRepository` row to the
Feature's Project and the same-Business Repository. Repository `ACTIVE` is a
service precondition for new capture/binding writes; the SELECT backstop keeps
valid immutable historical evidence addressable when a Repository later
changes status.

### 3.4 Snapshot parent predicate (`P_GS`)

The snapshot must resolve through its `ProjectRepository` and separate
`Repository` reference to the same Project, Business and Tenant. This is the
predicate for both SELECT and INSERT, with the validity terms retained on both
sides:

```sql
-- P_GS: outer relation is "GovernanceSnapshot".
NULLIF(current_setting('zuri.pm_tenant_id', true), '') IS NOT NULL
AND NULLIF(current_setting('zuri.pm_business_id', true), '') IS NOT NULL
AND "GovernanceSnapshot"."tenantId" = current_setting('zuri.pm_tenant_id', true)
AND "GovernanceSnapshot"."businessId" = current_setting('zuri.pm_business_id', true)
AND "GovernanceSnapshot"."validationStatus" = 'VALID'
AND "GovernanceSnapshot"."sourceManifest" IS NOT NULL
AND EXISTS (
  SELECT 1
  FROM "ProjectRepository" pr
  JOIN "Repository" r ON r."id" = pr."repoId"
  JOIN "Project" p ON p."id" = pr."projectId"
  JOIN "Workspace" w ON w."id" = p."workspaceId"
  JOIN "Business" b ON b."id" = p."businessId"
  JOIN "Tenant" t ON t."id" = b."tenantId"
  WHERE pr."id" = "GovernanceSnapshot"."projectRepositoryId"
    AND pr."repoId" = "GovernanceSnapshot"."repositoryId"
    AND p."businessId" IS NOT NULL
    AND p."businessId" = "GovernanceSnapshot"."businessId"
    AND r."businessId" = "GovernanceSnapshot"."businessId"
    AND b."id" = "GovernanceSnapshot"."businessId"
    AND b."tenantId" = "GovernanceSnapshot"."tenantId"
    AND (
      (
        w."scopeType" = 'BUSINESS'
        AND w."businessId" = p."businessId"
        AND (w."tenantId" IS NULL OR w."tenantId" = t."id")
      )
      OR (w."scopeType" = 'TENANT' AND w."tenantId" = t."id")
      OR (
        w."scopeType" = 'PORTFOLIO'
        AND w."tenantId" = t."id"
        AND w."portfolioId" = t."portfolioId"
      )
    )
    AND p."deletedAt" IS NULL
);
```

### 3.5 Typed receipt predicate (`P_RECEIPT`)

Receipts have no universal `resourceId` foreign key. The RLS predicate still
validates the Project and AuditEvent scope and the typed resource branch; the
service repeats the same discriminated check before INSERT. The exact
resource/target mapping is:

```sql
-- P_RECEIPT: outer relation is "ProjectFeatureMutationReceipt".
NULLIF(current_setting('zuri.pm_tenant_id', true), '') IS NOT NULL
AND NULLIF(current_setting('zuri.pm_business_id', true), '') IS NOT NULL
AND "ProjectFeatureMutationReceipt"."tenantId" = current_setting('zuri.pm_tenant_id', true)
AND "ProjectFeatureMutationReceipt"."businessId" = current_setting('zuri.pm_business_id', true)
AND "ProjectFeatureMutationReceipt"."status" = 'COMMITTED'
AND "ProjectFeatureMutationReceipt"."etag" IS NOT NULL
AND EXISTS (
  SELECT 1
  FROM "Project" p
  JOIN "Workspace" w ON w."id" = p."workspaceId"
  JOIN "Business" b ON b."id" = p."businessId"
  JOIN "Tenant" t ON t."id" = b."tenantId"
  WHERE p."id" = "ProjectFeatureMutationReceipt"."projectId"
    AND p."businessId" IS NOT NULL
    AND p."businessId" = "ProjectFeatureMutationReceipt"."businessId"
    AND b."id" = "ProjectFeatureMutationReceipt"."businessId"
    AND b."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
    AND (
      (
        w."scopeType" = 'BUSINESS'
        AND w."businessId" = p."businessId"
        AND (w."tenantId" IS NULL OR w."tenantId" = t."id")
      )
      OR (w."scopeType" = 'TENANT' AND w."tenantId" = t."id")
      OR (
        w."scopeType" = 'PORTFOLIO'
        AND w."tenantId" = t."id"
        AND w."portfolioId" = t."portfolioId"
      )
    )
    AND p."deletedAt" IS NULL
)
AND EXISTS (
  SELECT 1
  FROM "AuditEvent" a
  WHERE a."id" = "ProjectFeatureMutationReceipt"."auditEventId"
    AND a."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
    AND a."businessId" = "ProjectFeatureMutationReceipt"."businessId"
)
AND (
  -- CREATE_FEATURE: Project target, newly created Feature resource/version.
  (
    "ProjectFeatureMutationReceipt"."operation" = 'CREATE_FEATURE'
    AND "ProjectFeatureMutationReceipt"."httpMethod" = 'POST'
    AND "ProjectFeatureMutationReceipt"."targetType" = 'PROJECT'
    AND "ProjectFeatureMutationReceipt"."targetId" = "ProjectFeatureMutationReceipt"."projectId"
    AND "ProjectFeatureMutationReceipt"."resourceType" = 'PROJECT_FEATURE'
    AND "ProjectFeatureMutationReceipt"."resourceId" = "ProjectFeatureMutationReceipt"."featureId"
    AND "ProjectFeatureMutationReceipt"."featureId" IS NOT NULL
    AND "ProjectFeatureMutationReceipt"."version" >= 1
    AND EXISTS (
      SELECT 1
      FROM "ProjectFeature" f
      WHERE f."id" = "ProjectFeatureMutationReceipt"."resourceId"
        AND f."projectId" = "ProjectFeatureMutationReceipt"."projectId"
        AND f."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
        AND f."businessId" = "ProjectFeatureMutationReceipt"."businessId"
    )
  )
  -- UPDATE_FEATURE: Feature target and Feature resource/version.
  OR (
    "ProjectFeatureMutationReceipt"."operation" = 'UPDATE_FEATURE'
    AND "ProjectFeatureMutationReceipt"."httpMethod" = 'PATCH'
    AND "ProjectFeatureMutationReceipt"."targetType" = 'FEATURE'
    AND "ProjectFeatureMutationReceipt"."targetId" = "ProjectFeatureMutationReceipt"."featureId"
    AND "ProjectFeatureMutationReceipt"."resourceType" = 'PROJECT_FEATURE'
    AND "ProjectFeatureMutationReceipt"."resourceId" = "ProjectFeatureMutationReceipt"."featureId"
    AND "ProjectFeatureMutationReceipt"."featureId" IS NOT NULL
    AND "ProjectFeatureMutationReceipt"."version" >= 1
    AND EXISTS (
      SELECT 1
      FROM "ProjectFeature" f
      WHERE f."id" = "ProjectFeatureMutationReceipt"."resourceId"
        AND f."projectId" = "ProjectFeatureMutationReceipt"."projectId"
        AND f."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
        AND f."businessId" = "ProjectFeatureMutationReceipt"."businessId"
    )
  )
  -- Child-set replacement operations share the Feature tuple with PUT.
  OR (
    "ProjectFeatureMutationReceipt"."operation" = 'REPLACE_CONTRIBUTIONS'
    AND "ProjectFeatureMutationReceipt"."httpMethod" = 'PUT'
    AND "ProjectFeatureMutationReceipt"."targetType" = 'FEATURE'
    AND "ProjectFeatureMutationReceipt"."targetId" = "ProjectFeatureMutationReceipt"."featureId"
    AND "ProjectFeatureMutationReceipt"."resourceType" = 'PROJECT_FEATURE'
    AND "ProjectFeatureMutationReceipt"."resourceId" = "ProjectFeatureMutationReceipt"."featureId"
    AND "ProjectFeatureMutationReceipt"."featureId" IS NOT NULL
    AND "ProjectFeatureMutationReceipt"."version" >= 1
    AND EXISTS (
      SELECT 1
      FROM "ProjectFeature" f
      WHERE f."id" = "ProjectFeatureMutationReceipt"."resourceId"
        AND f."projectId" = "ProjectFeatureMutationReceipt"."projectId"
        AND f."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
        AND f."businessId" = "ProjectFeatureMutationReceipt"."businessId"
    )
  )
  OR (
    "ProjectFeatureMutationReceipt"."operation" = 'REPLACE_WORK_LINKS'
    AND "ProjectFeatureMutationReceipt"."httpMethod" = 'PUT'
    AND "ProjectFeatureMutationReceipt"."targetType" = 'FEATURE'
    AND "ProjectFeatureMutationReceipt"."targetId" = "ProjectFeatureMutationReceipt"."featureId"
    AND "ProjectFeatureMutationReceipt"."resourceType" = 'PROJECT_FEATURE'
    AND "ProjectFeatureMutationReceipt"."resourceId" = "ProjectFeatureMutationReceipt"."featureId"
    AND "ProjectFeatureMutationReceipt"."featureId" IS NOT NULL
    AND "ProjectFeatureMutationReceipt"."version" >= 1
    AND EXISTS (
      SELECT 1
      FROM "ProjectFeature" f
      WHERE f."id" = "ProjectFeatureMutationReceipt"."resourceId"
        AND f."projectId" = "ProjectFeatureMutationReceipt"."projectId"
        AND f."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
        AND f."businessId" = "ProjectFeatureMutationReceipt"."businessId"
    )
  )
  OR (
    "ProjectFeatureMutationReceipt"."operation" = 'REPLACE_REQUIREMENT_BINDINGS'
    AND "ProjectFeatureMutationReceipt"."httpMethod" = 'PUT'
    AND "ProjectFeatureMutationReceipt"."targetType" = 'FEATURE'
    AND "ProjectFeatureMutationReceipt"."targetId" = "ProjectFeatureMutationReceipt"."featureId"
    AND "ProjectFeatureMutationReceipt"."resourceType" = 'PROJECT_FEATURE'
    AND "ProjectFeatureMutationReceipt"."resourceId" = "ProjectFeatureMutationReceipt"."featureId"
    AND "ProjectFeatureMutationReceipt"."featureId" IS NOT NULL
    AND "ProjectFeatureMutationReceipt"."version" >= 1
    AND EXISTS (
      SELECT 1
      FROM "ProjectFeature" f
      WHERE f."id" = "ProjectFeatureMutationReceipt"."resourceId"
        AND f."projectId" = "ProjectFeatureMutationReceipt"."projectId"
        AND f."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
        AND f."businessId" = "ProjectFeatureMutationReceipt"."businessId"
    )
  )
  -- REPLACE_FEATURE_WORK_GRAPH: Project graph resource, null Feature/version.
  OR (
    "ProjectFeatureMutationReceipt"."operation" = 'REPLACE_FEATURE_WORK_GRAPH'
    AND "ProjectFeatureMutationReceipt"."httpMethod" = 'PUT'
    AND "ProjectFeatureMutationReceipt"."targetType" = 'PROJECT'
    AND "ProjectFeatureMutationReceipt"."targetId" = "ProjectFeatureMutationReceipt"."projectId"
    AND "ProjectFeatureMutationReceipt"."resourceType" = 'PROJECT_FEATURE_GRAPH'
    AND "ProjectFeatureMutationReceipt"."resourceId" = "ProjectFeatureMutationReceipt"."projectId"
    AND "ProjectFeatureMutationReceipt"."featureId" IS NULL
    AND "ProjectFeatureMutationReceipt"."version" IS NULL
  )
  -- DELETE_FEATURE: Feature target and Feature tombstone resource/version.
  OR (
    "ProjectFeatureMutationReceipt"."operation" = 'DELETE_FEATURE'
    AND "ProjectFeatureMutationReceipt"."httpMethod" = 'DELETE'
    AND "ProjectFeatureMutationReceipt"."targetType" = 'FEATURE'
    AND "ProjectFeatureMutationReceipt"."targetId" = "ProjectFeatureMutationReceipt"."featureId"
    AND "ProjectFeatureMutationReceipt"."resourceType" = 'PROJECT_FEATURE'
    AND "ProjectFeatureMutationReceipt"."resourceId" = "ProjectFeatureMutationReceipt"."featureId"
    AND "ProjectFeatureMutationReceipt"."featureId" IS NOT NULL
    AND "ProjectFeatureMutationReceipt"."version" >= 1
    AND EXISTS (
      SELECT 1
      FROM "ProjectFeature" f
      WHERE f."id" = "ProjectFeatureMutationReceipt"."resourceId"
        AND f."projectId" = "ProjectFeatureMutationReceipt"."projectId"
        AND f."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
        AND f."businessId" = "ProjectFeatureMutationReceipt"."businessId"
    )
  )
  -- RESTORE_FEATURE: Feature target and restored Feature resource/version.
  OR (
    "ProjectFeatureMutationReceipt"."operation" = 'RESTORE_FEATURE'
    AND "ProjectFeatureMutationReceipt"."httpMethod" = 'POST'
    AND "ProjectFeatureMutationReceipt"."targetType" = 'FEATURE'
    AND "ProjectFeatureMutationReceipt"."targetId" = "ProjectFeatureMutationReceipt"."featureId"
    AND "ProjectFeatureMutationReceipt"."resourceType" = 'PROJECT_FEATURE'
    AND "ProjectFeatureMutationReceipt"."resourceId" = "ProjectFeatureMutationReceipt"."featureId"
    AND "ProjectFeatureMutationReceipt"."featureId" IS NOT NULL
    AND "ProjectFeatureMutationReceipt"."version" >= 1
    AND EXISTS (
      SELECT 1
      FROM "ProjectFeature" f
      WHERE f."id" = "ProjectFeatureMutationReceipt"."resourceId"
        AND f."projectId" = "ProjectFeatureMutationReceipt"."projectId"
        AND f."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
        AND f."businessId" = "ProjectFeatureMutationReceipt"."businessId"
    )
  )
  -- CAPTURE_GOVERNANCE_SNAPSHOT: Project target, immutable snapshot resource.
  OR (
    "ProjectFeatureMutationReceipt"."operation" = 'CAPTURE_GOVERNANCE_SNAPSHOT'
    AND "ProjectFeatureMutationReceipt"."httpMethod" = 'POST'
    AND "ProjectFeatureMutationReceipt"."targetType" = 'PROJECT'
    AND "ProjectFeatureMutationReceipt"."targetId" = "ProjectFeatureMutationReceipt"."projectId"
    AND "ProjectFeatureMutationReceipt"."resourceType" = 'GOVERNANCE_SNAPSHOT'
    AND "ProjectFeatureMutationReceipt"."featureId" IS NULL
    AND "ProjectFeatureMutationReceipt"."version" IS NULL
    AND EXISTS (
      SELECT 1
      FROM "GovernanceSnapshot" s
      JOIN "ProjectRepository" pr ON pr."id" = s."projectRepositoryId"
      JOIN "Repository" r ON r."id" = s."repositoryId"
      WHERE s."id" = "ProjectFeatureMutationReceipt"."resourceId"
        AND s."tenantId" = "ProjectFeatureMutationReceipt"."tenantId"
        AND s."businessId" = "ProjectFeatureMutationReceipt"."businessId"
        AND s."validationStatus" = 'VALID'
        AND s."sourceManifest" IS NOT NULL
        AND pr."id" = s."projectRepositoryId"
        AND pr."repoId" = r."id"
        AND pr."projectId" = "ProjectFeatureMutationReceipt"."projectId"
        AND r."businessId" = "ProjectFeatureMutationReceipt"."businessId"
    )
  )
);
```

`P_RECEIPT` is used for SELECT and INSERT; `status='COMMITTED'` is retained
in the INSERT `WITH CHECK`, and no UPDATE or DELETE policy/grant exists. The
single OR-of-tuples above couples every operation, method, target, resource,
ID relationship, Feature-ID presence and version nullability. It therefore
cannot accept a valid graph resource for `CREATE_FEATURE`, or a Feature
resource for snapshot capture. The `resourceId` relationship remains
polymorphic by design, with the explicit RLS/service branches above and the
`auditEventId` ordinary FK.

The immutable policy declarations are therefore:

```sql
CREATE POLICY "phase_b_governance_snapshot_select"
  ON "GovernanceSnapshot" FOR SELECT TO zuri_app_runtime, zuri_web_login
  USING (P_GS);
CREATE POLICY "phase_b_governance_snapshot_insert"
  ON "GovernanceSnapshot" FOR INSERT TO zuri_app_runtime, zuri_web_login
  WITH CHECK (P_GS);

CREATE POLICY "phase_b_mutation_receipt_select"
  ON "ProjectFeatureMutationReceipt" FOR SELECT TO zuri_app_runtime, zuri_web_login
  USING (P_RECEIPT);
CREATE POLICY "phase_b_mutation_receipt_insert"
  ON "ProjectFeatureMutationReceipt" FOR INSERT TO zuri_app_runtime, zuri_web_login
  WITH CHECK (P_RECEIPT);
```

The migration must expand every alias with the exact expression and perform
deterministic name/definition collision checks. It must not silently accept a
different role list, command or predicate. No sequence grant is needed: all
six selected IDs are UUIDs, not serial values.

## 4. Append-only and scope invariants

The policy is one layer of the contract; W2/W4 must also enforce these in the
same transaction:

* `GovernanceSnapshot.validationStatus` is exactly `VALID`,
  `sourceManifest` is non-null and bounded, and only the server-local verifier
  can produce the stored proof. Invalid/unverifiable capture creates no
  snapshot, receipt or successful-capture audit event.
* Snapshot repository, ProjectRepository, Project, Business and Tenant links
  are independently resolved and same-Business. `P_GS` repeats that chain in
  both the SELECT and INSERT policy; W2 still resolves it before the query so
  an authorization failure is redacted rather than disclosed by RLS.
* Receipt `status` is exactly `COMMITTED`; its typed `resourceType`, Project
  and AuditEvent branches are checked by the service and the `P_RECEIPT`
  policy because `resourceId` has no universal FK. Replay reads occur only
  after the full scope guard and return fresh request correlation IDs without
  a second receipt effect.
* Feature/child updates preserve trusted scope in both old-row `USING` and
  new-row `WITH CHECK`; a request cannot move a row between Business values.
* A failed scope-setting/readback check rolls back before any new-table query.
  A failed viewer/hierarchy check is a redacted refusal and never falls back to
  a body/header scope. RLS parent joins remain the database backstop for a
  same-scope row carrying a foreign parent ID.

## 5. Composite FK and trigger decision

**Selected minimum: individual FKs plus transactional scope checks and RLS
parent joins; no new composite parent keys and no W1 trigger.**

Every selected record still gets ordinary existence FKs to its declared
`Tenant`, `Business`, `Project`, `Repository`, `ProjectRepository`,
`WorkItem`, `ProjectFeature` and `AuditEvent` parents. Those FKs alone cannot
prove that independently valid IDs share a Business or Project:

* existing `Project.businessId` and `Repository.businessId` are nullable legacy
  columns;
* `WorkItem` reaches Project only through `Workstream` and has no `projectId`;
* `GovernanceSnapshot` reaches Project through `ProjectRepository`; and
* the receipt's `resourceId` is intentionally polymorphic.

Composite FKs are not the portable minimum because the existing parents do not
expose matching `(id, tenantId, businessId)` unique keys. Adding those keys
would alter existing tables and widen W1. Provider-specific triggers would
also require parallel PostgreSQL/SQLite trigger code that Prisma does not
represent. The selected database backstop is therefore the explicit RLS
parent join in each `USING` and `WITH CHECK` expression above. The trusted W2
scope adapter/service transaction remains the normative same-hierarchy and
same-Project guard and provides the redacted application error contract.

No trigger is required for the selected graph: the parent predicates do not
form a policy cycle (`ProjectFeature` reaches only Project/Workspace/Business/
Tenant; child predicates reach Feature and their own parents; snapshots do not
reach receipts). A later owner review may add provider-specific triggers only
as a separately approved change if a new cyclic parent rule makes the RLS
backstop insufficient; it cannot silently replace these predicates.

## 6. Verification plan

The original design packet had no execution proof. Root/W1 subsequently ran
the bounded isolated PostgreSQL and SQLite/schema checks recorded above;
the application-adapter and production checks below remain pending. No
production credentials were used in those commands or fixtures.

### 6.1 Static migration proof

The focused W1 migration test should assert, for all six named tables:

1. `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` are present.
2. `REVOKE ALL ... FROM public, anon, authenticated, service_role` is scoped
   to those tables only.
3. Grants are least-privilege: four mutable tables receive the required
   runtime DML; snapshots/receipts receive SELECT/INSERT only; no
   `service_role` grant appears.
4. Every policy has the two `current_setting(..., true)` comparisons and
   explicit non-null guards; no `USING (true)` or `WITH CHECK (true)` appears.
   The four mutable policies include the full ProjectFeature/Project hierarchy
   or child-parent joins in both `USING` and `WITH CHECK`; the WorkLink check
   includes active WorkItem→Workstream plus optional Container ownership, the
   Binding check includes the same-Business current ProjectRepository snapshot,
   and the receipt check includes typed resource, Project and AuditEvent joins.
   Cross-scope fixtures with matching row columns but foreign parent IDs are
   denied. Missing and empty initial settings are both denied for row access;
   a non-empty stale setting is rejected by the adapter before a query.
5. Snapshot SELECT and INSERT require `validationStatus='VALID'`, non-null
   `sourceManifest` and the ProjectRepository→Repository→Project chain; no
   invalid capture storage allowance remains.
6. No `CREATE ROLE`, password, `ALTER DEFAULT PRIVILEGES`, existing-table
   policy rewrite or credential reference was added.
7. The local and production migration twins retain the same six tables,
   ordinary FKs, checks and indexes, with only provider SQL syntax differing.
8. `P_RECEIPT` contains one coupled OR-of-tuples for all nine approved
   operations; no independent resource and target disjunction remains. The
   static check rejects every adjacent-resource, adjacent-target, method,
   Feature-ID and version-nullability cross-pair in section 6.2.

### 6.2 Receipt compatibility proof (P1-W1-01)

The isolated policy test must insert one scope-valid receipt for every row in
this exact positive matrix. `targetId`, `resourceId`, `featureId` and
`version` are relations to the same fixture rows, not caller-controlled text:

| Operation | HTTP | targetType / targetId | resourceType / resourceId | featureId | version |
| --- | --- | --- | --- | --- | --- |
| `CREATE_FEATURE` | `POST` | `PROJECT / projectId` | `PROJECT_FEATURE / featureId` | `featureId` | integer `>=1` |
| `UPDATE_FEATURE` | `PATCH` | `FEATURE / featureId` | `PROJECT_FEATURE / featureId` | `featureId` | integer `>=1` |
| `REPLACE_CONTRIBUTIONS` | `PUT` | `FEATURE / featureId` | `PROJECT_FEATURE / featureId` | `featureId` | integer `>=1` |
| `REPLACE_WORK_LINKS` | `PUT` | `FEATURE / featureId` | `PROJECT_FEATURE / featureId` | `featureId` | integer `>=1` |
| `REPLACE_REQUIREMENT_BINDINGS` | `PUT` | `FEATURE / featureId` | `PROJECT_FEATURE / featureId` | `featureId` | integer `>=1` |
| `REPLACE_FEATURE_WORK_GRAPH` | `PUT` | `PROJECT / projectId` | `PROJECT_FEATURE_GRAPH / projectId` | `NULL` | `NULL` |
| `DELETE_FEATURE` | `DELETE` | `FEATURE / featureId` | `PROJECT_FEATURE / featureId` | `featureId` | integer `>=1` |
| `RESTORE_FEATURE` | `POST` | `FEATURE / featureId` | `PROJECT_FEATURE / featureId` | `featureId` | integer `>=1` |
| `CAPTURE_GOVERNANCE_SNAPSHOT` | `POST` | `PROJECT / projectId` | `GOVERNANCE_SNAPSHOT / snapshotId` | `NULL` | `NULL` |

For each positive row, the test must then attempt the following exact negative
mutations and require RLS rejection with no receipt effect: (a) replace its
`resourceType/resourceId` with the resource pair from either adjacent tuple;
(b) replace its `targetType/targetId` with the target pair from either adjacent
tuple; (c) change `httpMethod` to another allowed method; (d) set a Feature
tuple's `featureId` or `version` to `NULL`; and (e) set a graph/snapshot tuple's
`featureId` or `version` to a non-null value. The operation itself must also be
swapped once with each resource family: the seven Feature-resource operations
must reject graph and snapshot resources, graph allocation must reject Feature
and snapshot resources, and snapshot capture must reject Feature and graph
resources. A scope-valid row with a foreign ProjectFeature, Project,
GovernanceSnapshot or AuditEvent must fail the existing parent joins as well.

This matrix specifically closes the former independent-OR gap: a row is valid
only when one complete nine-field compatibility tuple matches. Receipt status
remains `COMMITTED` on both first commit and same-hash replay; replay returns
HTTP 200 with a fresh request ID and appends no second receipt or AuditEvent.

### 6.3 Isolated Postgres proof

After the owner applies the candidate migration to an empty isolated
`postgres:17-alpine` database:

1. Query `pg_roles` and prove `zuri_app_runtime` is non-login,
   non-superuser and `rolbypassrls=false`; prove `zuri_web_login` is login,
   inherits the runtime role and also has `rolbypassrls=false`. A session as
   `postgres` is never runtime evidence.
2. As the runtime path, begin a transaction with no settings. SELECT on each
   new table returns no rows and an INSERT is rejected by RLS. A missing
   setting must never expose rows.
3. Set valid scope A through the adapter handshake; prove only A rows are
   visible and valid A inserts work. Try a wrong tenant or business insert,
   update and delete; each is rejected or returns no target according to the
   operation contract. Explicitly reject a same-scope ProjectFeature whose
   optional pin points at another Business's or Project's snapshot; accept the
   matching valid pin and a Feature with no pin. The optional pin joins introduce
   no policy cycle: snapshot policies reach the Project, never ProjectFeature.
4. Attempt direct snapshot/receipt UPDATE and DELETE; they fail because the
   runtime has neither grant nor policy. Valid scoped SELECT/INSERT succeeds;
   invalid snapshot status or null manifest fails.
5. Commit scope A, reuse the same pooled connection for scope B, and prove the
   initial settings are `NULL` or `''` (both accepted as unbound) before B
   binds. A deliberately stale non-empty setting is rejected. After B commits,
   a transaction with no settings again sees no rows. This is the concrete
   pool-leak proof.
6. Execute the same-scope and cross-scope Project/Work/receipt fixtures through
   W2's resolver. Confirm the resolver runs before any new-table query and a
   scope mismatch does not append a receipt or audit row.
7. Run the DB-MIGRATION-NOTES catalog query for every new table and require
   `rls=t forced=t policies>=1 service_role_privs=0`.

Production remains blocked until the real runtime connection is proven
non-privileged and non-BYPASSRLS. A previous observation found `postgres`
with BYPASSRLS; this was not reverified after the concurrent release and is
not repaired by this design.

### 6.4 SQLite/provider parity proof

With `PRAGMA foreign_keys=ON`, the focused local test should prove ordinary
parent FKs, range/lifecycle/pair checks, same-Project service rejection,
`BEGIN IMMEDIATE` write serialization and no process-global scope state. It
must use the sanctioned scope/viewer factories and clean fixtures in dependency
order. SQLite passing does not close the PostgreSQL RLS/grant or production
runtime-role gate.

## 7. Handoff and limits

| Item | Status |
| --- | --- |
| Contract correction to `VALID`-only snapshot persistence | Applied to the W1 dispatch; aligned with data candidate v0.2.3b, plan 24 and ADR-097. |
| RLS policy text and adapter handshake | Database policy implemented and isolated-tested; W2 transaction adapter remains NOT_IMPLEMENTED. Full parent joins are required in both `USING` and `WITH CHECK`. |
| Receipt compatibility correction | Applied in v0.2.1b; one coupled OR-of-tuples covers all nine operations, with positive/negative proof required in section 6.2. |
| Composite FK/trigger decision | No composite FK or trigger in portable W1 minimum; transactional service guard plus explicit RLS parent joins selected. |
| Isolated PostgreSQL 17 proof | PASS: 129 actual-role checks and 11 catalog/grant collision checks; synthetic records, no application adapter or production connection. |
| Independent provider implementation review | PASS at migration 9CDC9DEC and policy v0.2.3b; no remaining P0/P1 finding in this bounded source/proof review. |
| Production RLS/grant/runtime role proof | NOT_REVERIFIED after the concurrent release; the previously observed PostgreSQL BYPASSRLS finding is still an open rollout gate. |
| Full backup restore/import privilege | DEFERRED; separate root-composed maintenance gate, not an ordinary runtime grant. |
| Existing tables, roles and credentials | Unchanged by this worker. |

Root owns this canonical policy, shared contracts and generated governance.
W1 owns only the two provider schemas, one additive migration pair and its
focused verification. W2 full restore/privacy and production runtime identity
remain separate gates. No worker may apply this migration to production.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
| --- | --- | --- | --- | --- | --- |
| 0.2.4b | 2026-09-17 | beta | Record independent provider implementation PASS and distinguish completed isolated checks from pending adapter/production proof | bd99651f | RWANG |
| 0.2.3b | 2026-09-17 | beta | Revoke prior new-table runtime grants before bounded grants; record 129 isolated role checks and 11 definition/grant checks | bd99651f | RWANG |
| 0.2.2b | 2026-09-17 | beta | Add the approved optional Feature snapshot parent backstop and its isolated negative proof; independent delta closure required before SQL freeze | bd99651f | RWANG |
| 0.1.0b | 2026-09-17 | candidate | Proposed exact transaction-local scope settings, least-privilege forced-RLS policies, append-only runtime rules, portable FK/trigger choice and verification plan. | 61e28ac99de188dbeb072bf023f5acb1dc7f4910 | Luna Max |
| 0.2.0b | 2026-09-17 | candidate | Added exact same-hierarchy parent joins for every table's RLS `USING`/`WITH CHECK`, typed receipt/resource/audit checks, null-or-empty reset semantics, and the separate full-restore maintenance gate. | bd99651f2322e7c15be04a834399dee4d397cbb4 | Luna Max |
| 0.2.1b | 2026-09-17 | candidate | Closed P1-W1-01 by coupling operation, method, target, resource, ID, Feature-ID and version compatibility into one nine-operation receipt predicate and adding its positive/negative verification matrix. | bd99651f2322e7c15be04a834399dee4d397cbb4 | Luna Max |
