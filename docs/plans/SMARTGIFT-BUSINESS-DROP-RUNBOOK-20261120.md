---
status: implementation-plan
version: "0.1.0"
source_of_truth: false
---

# SmartGift Business data removal — owner runbook

**Authority.** ADR-119 and the owner decisions of 2026-11-15/16 (relayed by the lead Claude
session; recorded as a delegated product-owner decision, Astra gpt-6-astra, under owner
instruction 2026-11-08 — not human approval). This runbook is a plan for the **owner**. Nothing
in it was run against production, and applying the migration is a separate, owner-instructed
operator step (ADR-057). The change that added the file did not apply it.

**What is removed.** One Business: `834fa869-62f3-431c-a287-e9a95e91175b` (`BUS-SMARTGIFT`),
and every row that belongs to it, in the Prisma `public` schema
([migration](../../apps/server/supabase/migrations/20261120000000_drop_smartgift_business_data.sql)),
plus the `zuri_core.*` LINE-runtime rows of the same Business (Step 6, SQL below).

**What is not removed — read this twice.**

- The tenant `77cdbe70-3111-4a04-922a-8059be99a8b0` is **shared** with ETOH, MUJEEN and EMC. The
  tenant and the portfolio are never touched by anything here. Removing the tenant is a separate
  owner decision and is out of scope.
- `Person` rows are kept (a person is not owned by a Business). `Membership` and `RoleBinding` rows of
  this Business are deleted.
- `AuditEvent` rows are kept (append-only evidence; `AuditEvent.businessId` is a plain column and will
  point at a Business that no longer exists).
- Persisted and operator names are kept on purpose: `SMARTGIFT_*` environment variables,
  `mcp__smartgift__*`, `genesis_smartgift_store_*`, `SMARTGIFT_CATALOG_V1`, `SMARTGIFT_CATALOG`,
  `smartgift-catalog`, provider `SMARTGIFT_DOCUMENT_INTAKE`, `smartgift.document-intake.v1`, worker
  `businessCode 'smartgift'`. Their provider rows (`IntegrationProvider`) are not Business-owned and stay.
- Roles, policies and functions of the LINE runtime are **not** touched by the migration or by Steps 1–8.
  They are Step 9, which must not run until the owner confirms the condition stated there.
- Git history is not purged (owner decision).

## Order of operations

The order is fixed: **backup → dry run → LINE console / channel secret revoke → vault → binding
(`zuri_core`) → migration → verification**. Steps 3–6 destroy things a restore of the database does not bring
back (a revoked LINE secret, a deleted vault secret), so the backup and the dry run come first and the migration
comes last.

### Step 0 — Preconditions

1. Pick a maintenance window and stop every writer for this Business (web recreate with the LINE server
   disabled for this Business, `genesis-worker`, the local device worker that sends `businessCode: smartgift`).
   The migration locks the Business row (`FOR UPDATE`) but does not stop concurrent writers.
2. Use a role that can bypass row-level security (superuser or `BYPASSRLS`). The migration refuses to run
   otherwise (`SMARTGIFT_DROP_REQUIRES_RLS_BYPASS_ROLE`). The Prisma runtime role cannot do this.
3. **Host environment check — `GENESIS_WORKER_BENCHMARK_FIXTURE`.** On the production host read the *name and value
   of this variable only* (never the secrets) in `apps/server/.env.knowledge` and in the `zuri-ai-genesis-worker-1`
   container. Expected: a path on the ki17 state volume
   (`/var/lib/zuri-ki17/state/smartgift-real-benchmark-v1.json`). If it points at
   `/opt/ki17/fixtures/genesisrag17-smartgift-benchmark-v1.json`, change it **before** deploying an image built after the
   removal PRs: that baked default was renamed to `/opt/ki17/fixtures/genesisrag17-structured-benchmark-v1.json`.
   The volume file is host data outside the repository; decide separately whether to keep, rename or delete it
   (it holds real-record gold texts).
4. Record, from the production database, the row counts of every other Business in the tenant (Step 7 compares them).

### Step 1 — Backup and restore rehearsal

```bash
pg_dump --format=custom --no-owner --file=zuri-pre-smartgift-drop.dump "$DATABASE_URL"
pg_restore --list zuri-pre-smartgift-drop.dump > /dev/null && sha256sum zuri-pre-smartgift-drop.dump
```

Restore the dump into a **scratch** database (never over production) and run Step 2 there first.
A dump taken with writers stopped is the only complete rollback for Steps 3–7; see *Rollback*.

### Step 2 — Dry run

`dry-run.sql`:

```sql
SET zuri.smartgift_drop_dry_run = 'on';
\i apps/server/supabase/migrations/20261120000000_drop_smartgift_business_data.sql
```

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f dry-run.sql
```

Expected: one `NOTICE  SMARTGIFT_DROP: <table>: <n> row(s)` per table (176 tables, children first) and a final error
`SMARTGIFT_DROP_DRY_RUN: <n> row(s) would be deleted; everything has been rolled back`. Nothing is committed.
Review the counts with the owner. Any other error is a stop:

| Error | Meaning | Action |
|---|---|---|
| `SMARTGIFT_DROP_TARGET_MISMATCH` | the id exists with a different code or tenant | stop; investigate |
| `SMARTGIFT_DROP_CROSS_BUSINESS_REFERENCES` | rows of this Business reference rows of another Business (or the reverse); the message lists table, column and count | stop; decide per row with the owner — the migration never deletes another Business's data |
| `SMARTGIFT_DROP_BLOCKED_RETAINED_MARKETING_REPORT_EVIDENCE` | `MarketingReportPolicy/Binding/ExternalReport` rows exist; their delete triggers refuse by design | stop; separate owner decision about retained evidence |
| `SMARTGIFT_DROP_REQUIRES_RLS_BYPASS_ROLE` | wrong role | rerun as a bypass role |

Run the same dry run against the scratch restore from Step 1 before running it on production.

### Step 3 — LINE console / channel secret revoke (owner, manual)

In the LINE Developers console and LINE Official Account Manager, for the SmartGift channel: turn the webhook off,
rotate or revoke the channel secret and channel access token (issue none to replace them), remove the webhook URL,
and note the date. This cannot be undone by a database restore.

### Step 4 — Vault

List which vault secrets the Business uses, then remove them (names/ids only — do not print secret values):

```sql
SELECT c.id AS credential_id, c.connection_id, c.secret_ref, c.status
FROM zuri_core.integration_credential c
JOIN zuri_core.integration_connection k ON k.id = c.connection_id
WHERE k.tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0' AND k.business_id = '834fa869-62f3-431c-a287-e9a95e91175b';
```

`secret_ref` has the form `supabase-vault:<uuid>`. Delete exactly those vault entries through the Supabase
dashboard or `DELETE FROM vault.secrets WHERE id IN (<those uuids>)`. Confirm the list contains no secret shared
with another Business before deleting.

### Step 5 — Binding status

Before deleting, set the SmartGift LINE binding inactive so the runtime stops resolving it, and confirm nothing
else changed:

```sql
UPDATE zuri_core.line_channel_binding SET status = 'INACTIVE', updated_at = now(), version = version + 1
WHERE tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0' AND business_id = '834fa869-62f3-431c-a287-e9a95e91175b' AND status <> 'INACTIVE';
```

### Step 6 — `zuri_core` removal (one transaction)

This block is the `zuri_core` mirror of the migration, scoped to the same Business. It asserts first that every
`zuri_core` table with a `business_id` column is covered, so a table added later is never silently skipped.

```sql
BEGIN;
DO $zc$
DECLARE missing text;
BEGIN
  SELECT string_agg(table_name, ', ') INTO missing FROM information_schema.columns
   WHERE table_schema = 'zuri_core' AND column_name = 'business_id'
     AND table_name NOT IN ('customer_import_review_case', 'customer_import_batch', 'customer', 'line_activation_event',
                            'line_channel_binding', 'integration_connection', 'business_knowledge', 'bootstrap_audit_event');
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'ZURI_CORE_UNCOVERED_TABLES: %', missing;
  END IF;
END
$zc$;

-- children first; every statement is scoped to the one Business
DELETE FROM zuri_core.customer_import_review_decision WHERE review_case_id IN
  (SELECT id FROM zuri_core.customer_import_review_case WHERE business_id = '834fa869-62f3-431c-a287-e9a95e91175b');
DELETE FROM zuri_core.customer_import_review_case WHERE business_id = '834fa869-62f3-431c-a287-e9a95e91175b';
DELETE FROM zuri_core.customer_import_provenance WHERE batch_id IN
  (SELECT id FROM zuri_core.customer_import_batch WHERE business_id = '834fa869-62f3-431c-a287-e9a95e91175b');
DELETE FROM zuri_core.customer_import_batch WHERE business_id = '834fa869-62f3-431c-a287-e9a95e91175b';
DELETE FROM zuri_core.customer WHERE business_id = '834fa869-62f3-431c-a287-e9a95e91175b';
DELETE FROM zuri_core.line_activation_event WHERE business_id = '834fa869-62f3-431c-a287-e9a95e91175b';
DELETE FROM zuri_core.line_channel_binding WHERE business_id = '834fa869-62f3-431c-a287-e9a95e91175b';
DELETE FROM zuri_core.integration_connection WHERE business_id = '834fa869-62f3-431c-a287-e9a95e91175b'; -- credentials cascade
DELETE FROM zuri_core.business_knowledge WHERE business_id = '834fa869-62f3-431c-a287-e9a95e91175b';
DELETE FROM zuri_core.business WHERE id = '834fa869-62f3-431c-a287-e9a95e91175b' AND tenant_id = '77cdbe70-3111-4a04-922a-8059be99a8b0';
-- zuri_core.bootstrap_audit_event, zuri_core.person, zuri_core.tenant, zuri_core.portfolio are retained.
COMMIT;
```

If any statement fails (for example another table references one of these rows), the transaction rolls back; read
the error and stop. Inspect with `\d+ zuri_core.<table>` before changing the list.

### Step 7 — Apply the migration

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/server/supabase/migrations/20261120000000_drop_smartgift_business_data.sql
```

The migration is one atomic block. Re-running it is a no-op (`Business ... is already absent`). If the project's migration
history table must show it as applied, record that with the project's usual operator procedure after the run.
The file is hash-pinned for Compact (`apps/server/scripts/lib/compact/security.mjs`); a fresh Compact install
executes it as a no-op because the Business does not exist there.

### Step 8 — Verification

```sql
SELECT count(*) FROM "Business" WHERE id = '834fa869-62f3-431c-a287-e9a95e91175b';                     -- 0
SELECT count(*) FROM "Tenant" WHERE id = '77cdbe70-3111-4a04-922a-8059be99a8b0';                        -- 1 (shared, untouched)
SELECT code, status FROM "Business" WHERE "tenantId" = '77cdbe70-3111-4a04-922a-8059be99a8b0';          -- the other businesses only
SELECT count(*) FROM zuri_core.business WHERE id = '834fa869-62f3-431c-a287-e9a95e91175b';              -- 0
```

Compare the per-Business row counts of ETOH, MUJEEN and EMC with the numbers recorded in Step 0: they must be identical.
Then start the writers stopped in Step 0 and confirm the LINE server answers for the remaining Businesses.

### Step 9 — Optional role, policy and function cleanup (NOT part of the migration)

> **DO NOT RUN until the owner has confirmed that no other business's LINE binding uses `zuri_line_runtime`.**
> The role names are historical. `zuri_line_smartgift_login` is a member of `zuri_line_runtime`
> (migration `20260818050000`), which is the LINE runtime role. If the LINE server for ETOH, MUJEEN or EMC connects
> as `zuri_line_smartgift_login`, dropping it takes those channels down. `zuri_line_runtime` itself must never be dropped here.

Read-only checks first:

```sql
SELECT business_id, code, status FROM zuri_core.line_channel_binding;                 -- bindings of every Business
SELECT usename, application_name, count(*) FROM pg_stat_activity
 WHERE usename IN ('zuri_line_smartgift_login', 'zuri_line_smartgift_ro', 'zuri_line_runtime') GROUP BY 1, 2;
SELECT schemaname, tablename, policyname FROM pg_policies WHERE policyname LIKE 'line\_smartgift\_%' ESCAPE '\';
```

Only if the owner confirms that the `zuri_line_smartgift_*` roles serve no other Business: generate the statements,
review them, then run them in this order — policies, then role memberships/grants, then the two roles. `DROP ROLE`
fails if grants or owned objects remain; that failure is the safety net, so resolve it rather than forcing it.
Functions created for the Business-specific resolver are listed by
`SELECT n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'zuri_core';`
and are decided one by one by the owner; none is dropped by this runbook.

## Rollback

- Before Step 3: nothing destructive has run; stop.
- After Step 3 or 4: LINE credentials and vault secrets cannot be restored from the dump. Re-issue credentials in the LINE
  console and re-create the vault entry if the Business is ever to come back.
- After Step 7: restore `zuri-pre-smartgift-drop.dump` into a **new** database, verify, and switch over under an owner-led cutover
  (a restore over the live database loses every write since the dump). For a partial restore, restore into a scratch database and copy
  the rows back in the **reverse** of the migration's order (parents first), then re-run the verification queries.
- The code removal PRs are ordinary revertable commits and do not depend on this migration being applied.

## What was and was not tested (for the reviewer)

Tested on a disposable embedded PostgreSQL 17 (not production), the current generated schema: happy path with
another Business in the same tenant left intact, idempotent rerun, target mismatch, cross-business reference abort, retained
marketing-report abort, dry run roll-back, self-referencing rows, the FK-closure list and order against the real catalog
(`tests/postgres/smartgift-drop-migration.test.js`). **Not tested:** the migration on a real Supabase database with
production data volume and Phase B policies; the `zuri_core` SQL of Step 6 beyond a parse-and-run check on empty tables built from the
repository's DDL; Steps 3, 4 and 9, which are manual operator actions.
