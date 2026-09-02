---
version: "0.2.1b"
created_at: "2026-09-02T00:00:00+07:00,CLAUDE"
last_update: "2026-09-03T05:00:00+07:00,CLAUDE"
status: "applied"
superseded_by: null
attributes:
  domain: "integration"
  doc_type: "runbook"
  scope: "Operator procedure for merging the legacy line-oa IntegrationProvider code into LINE_OA"
---

# LINE_OA provider merge runbook

## Purpose and stop condition

`src/modules/integration/application/line-registry-service.js` once upserted its
own lowercase `line-oa` provider row while the rest of the lane addressed the
same channel as `LINE_OA` — two identities for one provider, which BR-002
forbids. Writes were fixed to use the shared `LINE_OA_PROVIDER_CODE` constant; reads
tolerated the legacy code (`LEGACY_LINE_OA_PROVIDER_CODE`) only until the
production merge recorded in §5 was applied on 2026-09-03, after which that
tolerance was retired (PR #208) — a `line-oa` row is no longer part of the
registry read model anywhere. This runbook retires those rows.

This procedure only re-points `IntegrationConnection` rows and disables
unresolved duplicates. It never deletes a connection, never touches
`IntegrationCredential`, and never widens any `purpose` or `status` value the
application does not already write. Stop immediately if the pre-apply
inventory (§2) shows a connection under `line-oa` this runbook's collision
rule does not account for, or if any collision is reported unresolved.

## 1. What ships

- `supabase/migrations/20260902110000_merge_line_oa_provider_code.sql` —
  the production migration. Idempotent: every step is a conditional
  INSERT/UPDATE/DELETE, safe to run more than once.
- `scripts/migrate-line-oa-provider.mjs` — the same logic through Prisma
  against the SQLite dev database, `--dry-run` by default.

Both apply the same rule: a legacy connection collides with a canonical
`LINE_OA` connection when they share `(tenantId, externalAccountId)` — the
granularity of `@@unique([tenantId, providerId, externalAccountId])`, which is
what would be violated by pointing both rows at the same `providerId`.

| Case | Outcome |
|---|---|
| No canonical row shares `(tenantId, externalAccountId)` | Legacy connection's `providerId` is re-pointed to `LINE_OA`. |
| A canonical row already shares it | The canonical row is kept; the legacy duplicate's `status` is set to `DISABLED` and `metadataJson` gains `{"mergedInto": "<canonical connection id>", "reason": "LINE_OA_PROVIDER_MERGE"}` (existing metadata fields are preserved, never overwritten). |
| `externalAccountId` is `NULL` | Never collides (`NULL` is distinct from `NULL` under the unique index) — always re-pointed. |
| Legacy provider row (`line-oa`) has zero remaining references | Deleted. A disabled duplicate still references it, so it survives until every duplicate under it is cleaned up by hand or a later pass. |

## 2. Pre-apply inventory (read-only)

Run against the target database before applying anything:

```sql
select c.id, c."tenantId", c."businessId", c."externalAccountId", c."purpose", c."status"
from "IntegrationConnection" c
join "IntegrationProvider" p on p.id = c."providerId"
where p.code = 'line-oa'
order by c."tenantId", c."externalAccountId";
```

Cross-check for collisions the migration will disable rather than merge:

```sql
select legacy.id as legacy_id, canonical.id as canonical_id, legacy."tenantId", legacy."externalAccountId"
from "IntegrationConnection" legacy
join "IntegrationProvider" legacy_provider on legacy_provider.id = legacy."providerId" and legacy_provider.code = 'line-oa'
join "IntegrationConnection" canonical on canonical."tenantId" = legacy."tenantId"
  and canonical."externalAccountId" = legacy."externalAccountId"
join "IntegrationProvider" canonical_provider on canonical_provider.id = canonical."providerId" and canonical_provider.code = 'LINE_OA'
where legacy."externalAccountId" is not null;
```

Record the row counts from both queries in the apply ledger (§5) before
proceeding.

## 3. Apply — SQLite dev database

```powershell
node scripts/migrate-line-oa-provider.mjs
node scripts/migrate-line-oa-provider.mjs --apply
node scripts/migrate-line-oa-provider.mjs --tenant <tenantId> --tenant <tenantId> --dry-run
```

The first (default) command prints a `DRY_RUN` summary — `wouldRepoint`,
`wouldDisable`, `unresolvedCollisions` — and exits non-zero if any collision is
unresolved (its metadata does not parse as a JSON object). Fix the offending
row before applying. `--tenant <tenantId>` (repeatable) limits both the plan and the apply to those tenants — the whole installation is in scope without it, which is what a production run wants and what the integration test deliberately does not (its per-run database is shared with the LINE registry suites). `--apply` performs the merge in one transaction and
prints the outcome, including whether the legacy provider row was deleted.

## 4. Apply — production (Supabase/Postgres)

> **How it was actually applied on 2026-09-03.** `supabase db push --linked` was
> not used: the linked history on production stopped at `20260829120000`, so a
> push would also have applied four unrelated pending migrations (plugin_auth,
> conversation_analysis, asset_management_foundation,
> asset_evidence_intake_execution) whose own gates are still open. The migration
> file was run as one statement batch over the repo's `DIRECT_URL` (the `pg`
> client, same as `scripts/readonly-supabase-preflight.mjs`), after a dry run in
> a rolled-back transaction, and its version was then inserted into
> `supabase_migrations.schema_migrations` so a later `db push` will not re-run it
> (it is idempotent either way). The affected provider/connection rows were
> exported to `C:\Users\pc\zuri-ai-supabase-backups\<ref>\20260903-040137-line-oa-merge\`
> (SHA-256 `74dc282c…dce2cc`) before apply. The first attempt failed and rolled
> back with `42P01`: Step 2 referenced the UPDATE target inside a `JOIN … ON` in
> the FROM list, which Postgres forbids; the shipped SQL now uses a comma-join
> with the correlations in `WHERE` — the SQLite script never had the bug because
> Prisma builds that step from two queries.

Follow this repository's standard migration apply procedure (see
`docs/runbooks/ASSET-EVIDENCE-PRODUCTION-ACTIVATION.md` §§1–4 for the target
identity, backup and environment gate steps that apply the same way here).
Migration-specific steps:

```powershell
npx supabase@2.114.0 db push --linked --dry-run
npx supabase@2.114.0 db push --linked
npx supabase@2.114.0 migration list --linked
```

Confirm `20260902110000` is the only new migration version in this window.

## 5. Verification query

Run after apply, in both databases:

```sql
select p.code, count(*) as connection_count
from "IntegrationConnection" c
join "IntegrationProvider" p on p.id = c."providerId"
where p.code in ('LINE_OA', 'line-oa')
group by p.code;
```

Expected: either no `line-oa` row at all (fully merged, no unresolved
duplicates left over), or a `line-oa` count equal to the number of `DISABLED`
duplicates from §2's collision query — never more. Every one of those rows
must have `"status" = 'DISABLED'` and a `metadataJson.reason` of
`"LINE_OA_PROVIDER_MERGE"`:

```sql
select id, status, "metadataJson"
from "IntegrationConnection" c
join "IntegrationProvider" p on p.id = c."providerId"
where p.code = 'line-oa';
```

Record the apply timestamp, environment, and both query results here once run
against production:

| Date | Environment | Pre-apply `line-oa` rows | Collisions | Post-apply `line-oa` rows | Operator |
|---|---|---|---|---|---|
| 2026-09-03 04:0x UTC+7 | production (`qcnm…orzc`, Postgres 17.6) | 1 (`LINE_GROUP`, ACTIVE, one tenant) | 0 | 0 — `LINE_OA` now holds the 1 connection; the `line-oa` provider row was deleted (no references left); `supabase_migrations.schema_migrations` records `20260902110000 merge_line_oa_provider_code` | Claude Code (session zuri-ai-1c), owner-instructed |

The production row above is filled in, so the read tolerance in
`line-registry-service.js` (`LEGACY_LINE_OA_PROVIDER_CODE`,
`READABLE_LINE_OA_PROVIDER_CODES`) was removed in the same change — no row can
carry the legacy code again. A developer SQLite database that still holds a
`line-oa` row is migrated by §3's script, which stays.

## 6. Rollback

The migration only re-points `providerId`, flips `status` to `DISABLED`, and
merges JSON fields into `metadataJson` — it never deletes a connection. To
undo a specific row: restore its `providerId` to the legacy provider's id and
its prior `status`/`metadataJson` from the pre-apply inventory (§2) or a
logical backup taken before apply. Re-creating the `line-oa` `IntegrationProvider`
row itself (if Step 4 deleted it) only requires re-inserting it with its
original `code`; provider rows are addressed by code, never by id, everywhere
in application code.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-02 | beta | Initial runbook for the line-oa → LINE_OA provider merge | working-tree | Claude |
| 0.2.0b | 2026-09-03 | applied | Production apply recorded (1 legacy row re-pointed, 0 collisions, legacy provider deleted); Step 2 SQL corrected after the 42P01 rollback; read tolerance retired | working-tree | Claude Code |
| 0.2.1b | 2026-09-03 | applied | Purpose paragraph no longer says reads still tolerate the legacy code — the tolerance was retired with the production apply | working-tree | Claude Code |
