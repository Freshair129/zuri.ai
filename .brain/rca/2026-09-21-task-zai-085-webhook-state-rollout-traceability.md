---
title: TASK-ZAI-085 webhook-state rollout traceability gap
version: "0.1.0b"
status: under review
created_at: "2026-09-21T00:00:00+07:00,RWANG"
last_update: "2026-09-21T00:00:00+07:00,RWANG"
attributes:
  domain: line-oa-platform
  scope: TASK-ZAI-085 migration receipt and webhook-state contract
---

# TASK-ZAI-085 webhook-state rollout traceability gap

## Symptom

The canonical task container links its migration evidence to
`docs/DB-MIGRATION-NOTES.md`, but that file has no entry for
`20260914150300_line_oa_webhook_state.sql`. The repository therefore has the
implementation and a recorded rollout narrative, but not in the document named
by the task's own evidence link.

## Evidence

- `apps/server/supabase/migrations/20260914150300_line_oa_webhook_state.sql`
  exists and adds `LineOaAccount.webhookStateJson` as nullable `TEXT`.
- Both `apps/server/prisma/schema.prisma` and
  `apps/server/prisma/schema.postgres.prisma` declare the same field.
- `docs/roadmap/ROADMAP-zuri-ai-24w-program.md` records the operator evidence
  in the `TC-TASK-ZAI-085` changelog: the migration was applied on 2026-09-14,
  the column was verified, and a `release-538c1958` redeploy retained the
  ADR-061 overlay and passed health/log checks. This audit did not access
  production or re-run those checks.
- The same task container leaves its vault-role success criterion unchecked
  because the recorded runtime still used `postgres`/`service_role` for the
  stock Supabase Vault view privilege boundary. That is an owner/operator
  runtime-role gate, not a safe local code fix in this audit.
- `docs/DB-MIGRATION-NOTES.md` has sections for later TASK-ZAI-099 and
  TASK-ZAI-108 applies, but no `20260914150300`, `webhookStateJson`, or
  TASK-ZAI-085 migration receipt section.

## Root Cause

The rollout evidence was appended to the programme task changelog, while the
task's designated migration-notes artifact was not updated. The existing
schema-migration preflight checks that a production column has a migration, but
does not check that a task-linked operator receipt is present or that the
webhook-state migration remains additive and idempotent.

## Why the issue escaped detection

The webhook feature tests exercise the SQLite-backed runtime path and the
generic preflight sees the column/migration pair. Neither test enumerates the
task's linked migration-notes document or asserts the exact production DDL
contract. The roadmap changelog consequently looked complete while the
operator-facing migration ledger remained silent.

## Proposed prevention

Record the existing, explicitly bounded operator evidence in
`docs/DB-MIGRATION-NOTES.md` without claiming new live verification. Add a
static contract test that requires the webhook-state migration to be the unique
production migration for the field, use `ADD COLUMN IF NOT EXISTS`, remain
transaction-wrapped and contain no destructive or privilege-changing SQL.
Keep the vault runtime-role privilege issue separate and owner-gated; do not
apply a migration, change credentials, or mark TASK-ZAI-085 done from this
audit.
