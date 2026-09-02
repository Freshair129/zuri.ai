---
version: "0.1.0b"
created_at: "2026-09-02T00:00:00+07:00,CLAUDE"
last_update: "2026-09-02T00:00:00+07:00,CLAUDE"
status: "beta"
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
forbids. Writes were fixed to use the shared `LINE_OA_PROVIDER_CODE` constant;
reads still tolerate the legacy code (`LEGACY_LINE_OA_PROVIDER_CODE`) so rows
written before that fix stay visible. This runbook retires those rows.

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
```

The first (default) command prints a `DRY_RUN` summary — `wouldRepoint`,
`wouldDisable`, `unresolvedCollisions` — and exits non-zero if any collision is
unresolved (its metadata does not parse as a JSON object). Fix the offending
row before applying. `--apply` performs the merge in one transaction and
prints the outcome, including whether the legacy provider row was deleted.

## 4. Apply — production (Supabase/Postgres)

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
| _pending_ | production | | | | |

Once this row is filled in for production, the read tolerance in
`line-registry-service.js` (`LEGACY_LINE_OA_PROVIDER_CODE`,
`READABLE_LINE_OA_PROVIDER_CODES`) may be removed — no row can carry the
legacy code again.

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
