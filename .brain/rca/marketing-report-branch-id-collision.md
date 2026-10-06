---
status: active
superseded_by: null
version: "0.1.0"
date: "2026-10-05"
---

# Concurrent branch issuance of the same Marketing requirement ID

## Symptom

Final remote-main inspection prevents integrating the latest parent into the report-exchange branch: both branches contain ZAI:FR-278 with different subjects and pinned digests. No conflicting merge or identity rewrite was attempted.

## Evidence

- Task issuance commit `cdb9518bc50019e876c15c6b1f6c1c98af84f65a` (2026-10-05 16:43:23 +07:00) declares FR-278 report-only machine credential. Its ledger statement digest is `0b36af840091a0a7f648874b568856cced18c980fba187d5b6b9c898266ee0ab`; its immutable manifest/receipt are under `docs/migrations/document-reintegration/record-migrations/marketing-report-receiver-20261005.*`.
- Main `077796622233bf9f35905f7eac226f0963760dcb`, PR #632 merged at 16:50:58 +07:00, declares FR-278 executive LINE OA sales dashboard. Its ledger digest is `99302e073b8e2b43f914ec057cdc97ddd22a6a05b36af277955693dc0740640f`, subject anchor `executive line oa sales dashboard`.
- `git show origin/main:docs/requirements/FR-278.md` and the task-branch record prove different canonical rows. `git diff 3506129f origin/main` also shows registry/format/parser/writer changes; this is not a documentation-only main update that can be ignored.
- Task writer `tools/document-record-migration.mjs` checks manifest HEAD/base/index/ledger and IDs reserved in its working tree (lines 119–141). The upstream `--register-reviewed` writer likewise checks its own registry/ledger. Neither inspected issuance path reserves an ID across independent unpublished Git branches.
- Integration of earlier main `3506129f` as `fcb7ade3` passed local migration 73/73, snapshot 32/32, projection 9/9 and full govern. Those checks do not prove uniqueness against a subsequently published competing branch.

## Root cause

Two concurrent authorized issuance workflows allocate against separate branch-local ID ledgers without a shared issuance reservation/serialization point. Both can see the same next ID as unused. A fresh-main check before either branch lands cannot reserve that identity against the other branch. This is an allocation coordination gap; no evidence supports blaming a corrupt row, fabricated approval or failed hash check.

## Why the issue escaped detection

Tests cover collisions inside a composed repository/base and preserve its pinned rows. They do not model two independent branch writers assigning the same ID and then publishing one to main. The earlier remote-main inspections preceded the dashboard merge. Final inspection caught the conflict before this branch merged; local PASS remains valid for its inspected composition only.

## Proposed prevention

Use one owner-controlled issuance lane/reservation before concurrent branches publish canonical IDs. Recheck freshly published main before final record issuance/merge; preserve all issued history and stop on divergent subjects. Qualify branch-only historical references by exact revision until reconciliation is approved. Add a competing-base/branch fixture to future reviewed tooling qualification; do not mistake a local collision check for distributed exclusion. The [reconciliation proposal](../../docs/change-requests/marketing/ZURI-GO-REPORT-MAIN-RECONCILIATION.md) gives the bounded recovery; no implementation/identity migration is performed by this RCA.
