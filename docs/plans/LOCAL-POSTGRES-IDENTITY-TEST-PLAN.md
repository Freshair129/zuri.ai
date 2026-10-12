---
id: ZAI:PLAN-LOCAL-POSTGRES-IDENTITY-TEST
title: Local PostgreSQL identity migration and test plan
version: "0.1.0"
status: blocked
created_at: "2026-10-12T00:00:00+07:00,Codex"
attributes:
  domain: identity
  doc_type: migration-and-test-plan
  source_of_truth: false
  scope: isolated local PostgreSQL identity testing and migration-path compatibility
relations:
  - type: references
    target: ../DB-MIGRATION-NOTES.md
  - type: references
    target: ../runbooks/production-migration-reconciliation.md
---

# Local PostgreSQL identity migration and test plan

## 1. Status and decision

**BLOCKED for migration replay and Compose-backed tests.** The repository has a
supported PostgreSQL 17 test fixture, but it starts embedded PostgreSQL and
generates a blank schema from Prisma; it does not connect Vitest to Compose or
exercise the identity integration suite on PostgreSQL. A DB-only Compose file is
provided as isolated configuration for a separately admitted harness. This plan
does not authorize starting containers, applying SQL, or changing production.

This plan adds no FR/ADR identity and is not an approval to change the roadmap,
production schema, or runtime database provider.

## 2. Repository evidence and migration authority

At base `18b498138bbc4550b654b1a91982a539d43dcad8`:

- `apps/server/supabase/migrations/*.sql` is the authoritative versioned
  PostgreSQL production lineage. `docs/DB-MIGRATION-NOTES.md` says these files
  are applied by an operator on the owner's instruction; the production
  reconciliation runbook also requires an exact ledger and prohibits `supabase
  db push` while a ledger gap is unresolved.
- `apps/server/prisma/schema.postgres.prisma` is generated from the canonical
  SQLite Prisma schema and is not applied directly. The generated
  `apps/server/prisma/postgres/0001_init.sql` is a schema bootstrap artifact,
  not the ordered production migration lineage.
- `apps/server/prisma/migrations/` is not a PostgreSQL migration chain. For
  example, `20260813070000_add_project_file/migration.sql` uses SQLite
  `DATETIME`/`INTEGER` types and says the local SQLite workflow is `db:push`.
- `apps/server/tests/global-setup-postgres.js` starts an ephemeral embedded
  PostgreSQL 17 cluster, then generates DDL with Prisma
  `migrate diff --from-empty --to-schema-datamodel prisma/schema.postgres.prisma
  --script`. `vitest.postgres.config.js` selects only the WorkToolPort and
  memory-erasure query integration tests. It does not yet select identity tests
  or use the Compose service.
- Existing identity-related integration candidates include
  `password-reset-flow.test.js`, `passkey-lifecycle.test.js`,
  `mfa-totp-lifecycle.test.js`, `fr038-business-membership-add.test.js`,
  `project-authorization.test.js`, and `scope-and-isolation.test.js`. Their
  current presence in the default suite is not evidence they pass on PostgreSQL.

## 3. Why the production migration chain is not vanilla PostgreSQL replay

Do not apply the Supabase migration tree to the Compose PostgreSQL image. The
tree has Supabase-specific role and grant assumptions (`anon`, `authenticated`,
`service_role`, and Zuri runtime roles), and explicit platform prerequisites.
For example, `20260818050000_phase1_line_supabase_vault_resolver.sql` stops unless
the executor can read `vault.decrypted_secrets`; `20260821103000_public_rls_hardening.sql`
revokes access from Supabase API roles; and
`20260914150400_crm_conversation_retention_and_search.sql` creates a PostgreSQL
extension. A vanilla server does not prove those roles, Vault objects, grants,
or extensions match Supabase.

Migration execution also has ordering and state requirements. The versioned
tree contains `CREATE INDEX CONCURRENTLY` migrations
`20260927090100_message_author_channel_identity_index.sql` and
`20260928090000_agent_trace_event_erasure_scan_index.sql`; both cannot run inside
a transaction block. It also contains explicit `DROP INDEX` operations and a
`DROP SCHEMA ... CASCADE` in a verification migration. The exact migration
version, prerequisites, existing objects, and standalone execution requirement
must be retained; do not flatten, skip, reorder, or substitute this chain with
`prisma db push`.

The current repo evidence does not define a supported, vanilla-PostgreSQL
versioned migration path. Until one is approved, use the existing generated
schema fixture only for application-level PostgreSQL tests and label the result
as **schema-fixture coverage**, never migration parity or production readiness.

## 4. Bounded execution plan after a separate G0

1. Add a guarded Compose-backed test harness in a separate work package. It must
   require a caller-generated unique run ID, unused loopback host port, and
   ephemeral password; reject any database target except that run's exact
   `127.0.0.1` address, port, and `zuri_identity_test` database. Do not read
   `.env`, production variables, or an ambient `DATABASE_URL`.
2. Keep Compose DB-only. Apply a schema fixture generated from
   `schema.postgres.prisma` through the same deliberate schema-diff mechanism as
   `global-setup-postgres.js`. Never invoke the Supabase migration tree or
   `prisma db push` from this runner.
3. Extend the PostgreSQL test selection to the existing identity candidates
   after checking their setup/teardown assumptions. Cover credential success
   and rejection, session revocation, MFA/passkey lifecycle where supported,
   membership and role-binding authorization, and tenant/business isolation.
   Require a nonzero executed-test count and prove the runner targeted the
   ephemeral PostgreSQL database rather than SQLite or another service.
4. Tear down only the Compose project and named volume derived from that exact
   run ID, after confirming no other process uses the project. Keep test data
   synthetic; do not seed customer or production records.
5. If migration parity is required, propose a separate Supabase-local-stack
   work package that pins the CLI/runtime versions, starts its own isolated
   project, replays the complete ordered lineage, and checks the migration
   ledger, RLS, policies, grants, roles, and extension/Vault prerequisites.
   A failure stops the run; do not continue from a partially replayed database.

## 5. Compose configuration acceptance

`apps/server/docker-compose.local-pg-identity-test.yml` must satisfy all of the
following before any future runner can use it:

- only one PostgreSQL 17 service, opt-in under `identity-test`;
- project and named-volume identities derive from a required per-run ID;
- required caller password and host port; the published port binds only to
  `127.0.0.1`;
- PostgreSQL readiness health check; no fixed `container_name`;
- no app service, migration runner, Supabase URL, secret file, database push, or
  production/provider integration.

The only validation performed for this packet is
`docker compose --profile identity-test config` with non-secret sentinel
environment values. It parses configuration and does not start or query Docker
containers. Runtime tests, migration replay, `up`, `ps`, build, and teardown are
not part of this work package.

## CHANGELOG

| Version | Date | Status | Summary |
|---|---|---|---|
| 0.1.0 | 2026-10-12 | blocked | Records Supabase migration authority, vanilla PostgreSQL incompatibilities, isolated Compose requirements, and the missing test-harness gate. |
