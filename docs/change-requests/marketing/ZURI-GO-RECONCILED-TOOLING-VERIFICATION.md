---
status: active
superseded_by: null
version: "0.1.0"
date: "2026-10-05"
---

# Reconciled Marketing report tooling verification

Owner approved main-first reconciliation and both physical designs on 2026-10-05. New branch `codex/marketing-report-reconciled` starts from fetched main `077796622233bf9f35905f7eac226f0963760dcb`; the old issued branch remains at `edff9794d779704d0d9acee15c9cdf3aabf77d77`. Main FR-278 remains the executive LINE OA dashboard. This record is tooling evidence, not application/native-runtime acceptance.

| Check | Executed result |
|---|---|
| Canonical registry/projections | PASS: 540 current main records; no fresh report record issued yet |
| Full document migration Node suite | PASS 78/78 after mixed writer, query, reservation deletion/malformed evidence and no-write reapplication regressions |
| Snapshot capture/replay suites | PASS 38/38; all three provenance dialects, historic full-index/FR-FEAT-only blobs, deliberate reviewed approval/base failures and unchanged historical proof versions |
| Full-size snapshot budget | PASS with the unchanged 20-second verification budget: 277 FR and 46 FEAT capture took 17.4 seconds in the final serialized run. An earlier concurrent run exhausted that budget; the final run did not weaken a limit |
| Generated graph/views/corpus | Generated locally; final composed govern is pending fresh issuance and reference rebinding |
| Independent composed review | Findings addressed; sealed candidate review pending |
| Fresh reservation/manifest/issuance | NOT_RUN: exact independent review precedes any write |
| SQLite/PostgreSQL receiver/sender native QA | NOT_RUN: application implementation follows reviewed fresh issuance |
| Live schema, bindings, credentials, sends, deployment | NOT_RUN; outside this approval |

Version diff 0 -> 0.1.0: records executed tooling checks and remaining gates. Existing main records and historical issuance evidence have not been rewritten.
