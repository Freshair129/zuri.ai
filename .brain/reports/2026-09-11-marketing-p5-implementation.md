---
version: "1.0.1b"
status: beta
created_at: "2026-09-11T04:17:00+07:00,RWANG"
last_update: "2026-09-11T04:41:13+07:00,RWANG"
---

# Marketing P5 bounded implementation report

This report records the implementation of the owner-approved bounded slice in
`2026-09-11-marketing-p5-audit.md` after PR319 (`196e4a9a`) merged. The slice
uses FR-185 only. It adds Business-scoped planning identity and immutable
revisions, truthful owner read projections and a read-only UI. It does not add
provider metrics, audience expansion, consent snapshots, publication, spend,
LINE sends, delivery workers or CRM writes.

## Implemented contract

- `MarketingBroadcastIntent` and append-only
  `MarketingBroadcastIntentVersion` are persisted in the canonical Prisma
  schema and additive SQLite/PostgreSQL migrations.
- Create is Business-scoped, owner-authorized, strict and hash-bound. Replays
  compare the immutable revision 1 request identity, so a later revision does
  not turn a retry into a false idempotency conflict. Revisions use CAS and
  archive is the only lifecycle close operation.
- Content and LINE account references are re-read through their owner services;
  invalid or revoked references are `UNAVAILABLE` and failed owner reads are
  `UNKNOWN`. CRM inbox/thread readers are inspected boundary evidence only and
  are never called.
- Paid Media and AskMarketing compose existing Marketing, Integration and
  Commerce read DTOs. Paid metrics remain `UNAVAILABLE` with null values; no
  provider/LLM/attribution fixture is used.
- Snapshot export includes parent-before-child rows and a versioned recovery
  manifest. Preview/import rejects malformed references before deletion and
  refuses legacy snapshots without the manifest when live broadcast rows exist.
- Pages `/growth/paid-media`, `/growth/broadcast` and
  `/growth/ask-marketing` bind to the active Business and render explicit
  unavailable/unknown states at mobile width. The Broadcast page has no send
  control or delivery receipt.

## Evidence

The schema/migration milestone is `72e5c644`; root integration reported
SQLite/PostgreSQL catalog, index, FK, RLS and runtime/web grant probes passing
against that SQL snapshot. The implementation tree independently passed:

- focused Vitest: 25 files, 93 tests;
- real SQLite owner integration: 5 tests covering Content and LINE OA DTO
  validation, scoped create/read, CAS/revision, replay and hidden/cross-
  Business refusal;
- production build: `npm --prefix apps/server run build`;
- independent Server and Edge installs with `npm ci`.

The isolated browser command
`npm run test:e2e -- --project=e2e tests/e2e/marketing-p5.spec.js` reached the
repository-wide route warmup on its disposable `:3151`/`e2e-3151.db` target;
it was interrupted before the Marketing specs ran so the `.next` tree could be
handed off without another concurrent process. It is not browser-pass evidence.

The current Broadcast page is a backend/current-UI milestone, not the final
usable picker acceptance. Its form still exposes internal idempotency,
content-version/hash and LINE account id/version fields, and it has no saved
detail/revise/archive controls. Root integration should finish this same FR-185
UI seam by reading the owner DTOs below, choosing by human-readable title/code,
capturing immutable references internally, generating and retaining an
idempotency key across an unknown response, and adding the saved-intent
actions:

- `GET /api/growth/content?businessId=...` → `briefs[]`, each with `id`,
  `code`, `title`, `status`, `currentRevision`, and `currentVersion.id`,
  `currentVersion.revision`, `currentVersion.payloadHash`;
- `GET /api/line-oa/accounts?businessId=...` → `accounts[]`, each with `id`,
  `code`, `displayName`, `status`, `effectiveStatus`, and `version`;
- `GET /api/growth/broadcast-intents/[id]?businessId=...` → the saved intent,
  current revision and append-only revision history; `PATCH` performs the
  approved `revise`/`archive` CAS actions.

The latest isolated browser attempt therefore records a product acceptance
gap rather than a runtime failure. Root owns the picker/detail follow-up and
the final combined browser run.

The initial all-unit baseline ran 415 files and 3,444 tests, with 413 files /
3,442 tests passing. Two failures remain recorded for root review: the existing
ID-ledger baseline expectation and the repository service-role grant guard,
which flags the required runtime-role grant migration. The Marketing focused
tests pass; root owns the shared guard reconciliation.

## Remaining owner phases

The following remain future and are not counted as local completion: Integration
paid-media measurement adapters; CRM audience and consent-snapshot resolver;
LINE OA dispatch/request receipt and delivery reconciliation; controlled
publication/spend/canary policy; and their owning-domain UI actions and workers.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.1b | 2026-09-11 | beta | FR-185 backend/current-UI milestone evidence; records owner-picker/detail follow-up and isolated browser handoff status | See git history | RWANG |
