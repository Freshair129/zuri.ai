---
status: implementation-plan
version: "0.1.0"
source_of_truth: false
---

# Customer.code per-Tenant migration — owner dry-run and apply checklist

**Authority.** [ADR-122](../decisions/ADR-122-HUMAN-CODE-UNIQUENESS-SCOPE.md) (D-D8, a delegated
product-owner decision by Astra, gpt-6-astra, under owner instruction 2026-11-08, relayed by the
lead Claude session; it is not human approval). This checklist is a plan for the **owner**.
Applying the migration is a separate, owner-instructed operator step (ADR-057). The change that
added this file did not apply anything to any real database.

**The migration.**
[`20261125120000_customer_code_tenant_scope.sql`](../../apps/server/supabase/migrations/20261125120000_customer_code_tenant_scope.sql)
holds two statements and no `UPDATE`, `DELETE` or `INSERT`:

```sql
DROP INDEX "Customer_code_key";
CREATE UNIQUE INDEX "Customer_tenantId_code_key" ON "Customer"("tenantId", "code");
```

Run every step in sections 1–3 on a **scratch database restored from a real backup**, never on
production. Do not paste connection strings or secrets into chat.

## What a synthetic dry run already showed (2026-11-25)

A disposable PostgreSQL 16 container, all 136 earlier migrations applied in order, then 200,000
synthetic `Customer` rows across three Tenants (table 60 MB). Supabase-only objects had to be
stubbed (roles `anon`, `authenticated`, `service_role`; schema `vault`; `storage.buckets`); none of
them touch `Customer`.

| Check | Result |
|---|---|
| Before: only `Customer_code_key` exists; NULL `tenantId` 0; duplicate `(tenantId, code)` 0 | pass |
| Apply the migration | 0.43 s |
| After: old index gone, new index present | pass |
| Row count and md5 of `id‖code‖tenantId` before and after | identical (200000, `c9c94b09…`) |
| Same Tenant, repeated code | rejected by `Customer_tenantId_code_key` |
| Different Tenant, same code | accepted |
| Reverse (`DROP` new, `CREATE` old) with no cross-Tenant duplicate | works |
| Reverse after a cross-Tenant duplicate exists | fails: `could not create unique index … duplicated` |

**This does not prove.** Timing on production data, real `tenantId` NULLs, the real table size, or
anything about Supabase itself. The application test suite was not run against that database; CI
(`fresh-postgres` and all test shards on PR #861) covers it. Those are what sections 1–2 below are for.

## 0. Before starting

- [ ] A backup exists that restores into a scratch database. Record its name and time.
- [ ] Earlier migrations are applied, in particular `20261120000000` (SmartGift data drop, see the
  [runbook](SMARTGIFT-BUSINESS-DROP-RUNBOOK-20261120.md)); this file sorts after it.
- [ ] The person who applies it is the owner (ADR-057).

## 1. Pre-checks (read-only, on scratch, then again on production)

- [ ] Only the old index exists:

  ```sql
  SELECT indexname FROM pg_indexes
  WHERE tablename = 'Customer'
    AND indexname IN ('Customer_code_key', 'Customer_tenantId_code_key');
  ```

  Expected: one row, `Customer_code_key`. Any other result: stop; the `DROP INDEX` would fail.
- [ ] No NULL `tenantId` (a NULL would escape the composite constraint):

  ```sql
  SELECT count(*) FROM "Customer" WHERE "tenantId" IS NULL;
  ```

  Expected: 0.
- [ ] No duplicate pair (impossible while the global constraint holds, so a hit means the schema
  is not what ADR-122 assumed):

  ```sql
  SELECT "tenantId", "code", count(*) FROM "Customer"
  GROUP BY 1, 2 HAVING count(*) > 1;
  ```

  Expected: no rows.
- [ ] Row count and size, for the lock estimate:
  `SELECT count(*), pg_size_pretty(pg_total_relation_size('"Customer"')) FROM "Customer";`
- [ ] Snapshot for comparison:
  `SELECT count(*), md5(string_agg(id || code || "tenantId", ',' ORDER BY id)) FROM "Customer";`

## 2. Apply and verify on scratch

- [ ] Apply only this file; time it (`\timing`).
- [ ] No error. `Customer_code_key` is gone and `Customer_tenantId_code_key` exists.
- [ ] The snapshot from section 1 is identical: no code was rewritten.
- [ ] In a transaction you roll back: a repeated code in the same Tenant is rejected; the same code
  in another Tenant is accepted.
- [ ] Optionally run `tests/integration/line-ingest-tenant-isolation.test.js` and
  `tests/unit/application-schema-migration.test.js` from the merged branch against the scratch
  database.

## 3. Deploy order (a recommendation, not in ADR-122; the owner decides)

- [ ] Deploy the application image that contains PR #861 **first**, then apply the migration.
  The new code probes with the composite key and works on both indexes. The old code's
  `findUnique({ where: { code } })` against the new index can read another Tenant's customer.
- [ ] Confirm the running image contains #861 (check its commit).

## 4. Production, before applying

- [ ] Repeat the section 1 checks on production, read-only.
- [ ] Choose a quiet window for writes to `Customer`. A plain `CREATE UNIQUE INDEX` blocks writes to
  the table while it builds; use the scratch timing and size to estimate. The migration does not use
  `CONCURRENTLY`, and Supabase wraps migrations in a transaction, where that is not allowed.
- [ ] Agree the rollback rule first: recreating `Customer_code_key` works **only while no two
  Tenants share a code**. After that it cannot be undone without changing data.

## 5. Production, after applying

- [ ] The new index exists and the old one is gone.
- [ ] The snapshot (count and md5) matches the pre-check.
- [ ] Create one customer through LINE in a test Tenant; it must succeed.
- [ ] Watch logs for `P2002` on `Customer` during the first hour.

## Version history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-11-25 | Claude Sonnet 5.5 | Initial owner checklist and synthetic dry-run evidence for the ADR-122 migration. |
