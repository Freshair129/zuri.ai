---
version: "0.2.0b"
created_at: "2026-09-22T00:00:00+07:00,Codex"
last_update: "2026-09-22T05:30:00+07:00,Codex"
status: "under review"
superseded_by: null
attributes:
  domain: "identity"
  doc_type: "root-cause-analysis"
  scope: "TASK-ZAI-001 production IAM runtime RLS"
---

# RCA — Person force-RLS drift in the production IAM boundary

## Complexity and risk

- **Complexity:** C-3 — documentation-driven production security remediation
- **Risk:** HIGH — changes a live database authorization boundary

## Symptom

The production runtime-role receipt showed that `public.Person` had RLS enabled
but `FORCE ROW LEVEL SECURITY` disabled, while `Membership` and `Session` were
forced. This left the canonical principal table outside the uniform forced-RLS
contract required by the IAM production plan.

## Evidence

- The live catalog reported `Person: relrowsecurity=true, relforcerowsecurity=false`.
- The same catalog reported runtime identity `zuri_web_login`, no superuser,
  no role/database creation privilege, no `BYPASSRLS`, and no `public CREATE`.
- `20260822195424_canonical_iam_phase0.sql` forces RLS on `Membership`, `Session`
  and `ChannelIdentity`, but not on the pre-existing `Person` table.
- `20260821103000_public_rls_hardening.sql` loops over public tables and enables
  RLS, but does not force it.

## Root Cause

The production hardening migration treated `ENABLE ROW LEVEL SECURITY` as
sufficient for all existing public tables. The later canonical IAM migration
added explicit forced-RLS statements only for newly introduced IAM tables and
did not add the existing `Person` principal to that explicit repair set.

## Why the issue escaped detection

The historical production receipt checked the IAM migration's intended table
set, while the current closeout checked the actual per-table catalog. The
repository had no regression test requiring a force-RLS migration for the
pre-existing `Person` table.

## Proposed prevention

1. Apply an idempotent migration that enables and forces RLS on `Person` and
   revokes Data API/service-role table grants without touching rows.
2. Add a migration contract test for the exact hardening statements.
3. Keep the production closeout receipt per-table and fail the gate when any
   canonical identity table has `relforcerowsecurity=false`.

## Resolution state

The migration and regression test were applied through the production migration
connection. The receipt was recorded in `supabase_migrations.schema_migrations`
as `20260922100000 / force_person_rls`. Post-apply catalog verification reports
`Person` RLS and forced RLS enabled, runtime access retained for
`zuri_web_login`, and no table SELECT access for `anon`, `authenticated` or
`service_role`. No Person rows were rewritten.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.2.0b | 2026-09-22 | under review | Applied and verified the Person force-RLS repair | working-tree | Codex |
| 0.1.0b | 2026-09-22 | under review | Recorded Person force-RLS drift and prepared idempotent repair | working-tree | Codex |
