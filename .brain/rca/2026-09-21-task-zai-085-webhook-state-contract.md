---
title: "TASK-ZAI-085 webhook-state consumer contract fails open"
date: 2026-09-21
status: candidate
scope: "TASK-ZAI-085 / FR-227 / SEC-030"
---

## Symptom

`LineOaAccount.webhookStateJson` is documented and produced as a five-field
webhook-health object, but the account read model can return arbitrary keys that
are present in the persisted JSON text.

## Evidence

- `apps/server/supabase/migrations/20260914150300_line_oa_webhook_state.sql`
  creates a nullable `TEXT` column and documents only `endpoint`, `active`,
  `lastTestAt`, `lastTestReason`, and `lastTestStatusCode` as its contract.
- `apps/server/src/modules/line-oa-studio/application/line-oa-account-service.js`
  currently accepts any parsed object in `parseWebhookState()` and places that
  object directly in `health.webhook`.
- `REGISTER_WEBHOOK` writes the expected fields on the normal path, but the
  column has no database check constraint and can also be populated by a restore
  or a separately repaired row.
- Existing FR-227 coverage checks normal provider outcomes and credential leak
  scans, but does not assert that a tainted persisted state is rejected before it
  reaches the DTO.

## Root Cause

The JSON-text boundary is enforced by producer convention and comments rather
than by a consumer-side schema boundary. `parseWebhookState()` fails open for
unknown keys and type changes, so a later write/restore with a sensitive or
untrusted field can cross the read-model boundary.

## Why the issue escaped detection

The integration suite uses trusted `lineAdmin` stubs and only exercises the
fields selected by `registerWebhookOutcome()`. It does not seed malformed or
tainted persisted JSON, so the producer's safe shape looked equivalent to the
consumer's contract.

## Proposed prevention

Make the consumer parser fail closed: accept only the five documented fields,
reject arrays, unknown keys, and wrong field types, and return `null` for an
invalid state. Add a regression that seeds a state containing a secret-like
unknown field and proves the account DTO exposes neither that field nor its
value. This is local code/test/RCA only; it does not apply or alter migrations,
credentials, provider state, production data, or roadmap files.
