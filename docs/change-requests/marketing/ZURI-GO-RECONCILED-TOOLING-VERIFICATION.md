---
status: active
superseded_by: null
version: "0.2.0"
date: "2026-10-05"
---

# Reconciled Marketing report tooling verification

Owner approved main-first reconciliation and both physical designs on 2026-10-05. New branch `codex/marketing-report-reconciled` starts from fetched main `077796622233bf9f35905f7eac226f0963760dcb`; the old issued branch remains at `edff9794d779704d0d9acee15c9cdf3aabf77d77`. Main FR-278 remains the executive LINE OA dashboard. This record is tooling evidence, not application/native-runtime acceptance.

| Check | Executed result |
|---|---|
| Canonical registry/projections | PASS: 544 records/752 pins after issuance; all 540 main entries and all 748 main pin metadata preserved |
| Full document migration Node suite | PASS 78/78 after mixed writer, query, reservation deletion/malformed evidence and no-write reapplication regressions |
| Snapshot capture/replay suites | PASS 38/38; all three provenance dialects, historic full-index/FR-FEAT-only blobs, deliberate reviewed approval/base failures and unchanged historical proof versions |
| Full-size snapshot budget | PASS with the unchanged 20-second verification budget: 277 FR and 46 FEAT capture took 17.4 seconds in the final serialized run. An earlier concurrent run exhausted that budget; the final run did not weaken a limit |
| Generated graph/views/corpus | Regenerated for fresh issuance/reference rebinding; final composed govern status accompanies the published candidate. Initial stale-view/inventory failures and their narrow repair are recorded in bounded implementation evidence |
| Independent composed review | PASS at sealed tooling commit 4bd9ebc7821faafa1685a3c4892300ca3b843dae |
| Fresh reservation/manifest/issuance | PASS: exact manifest independently reviewed; applied at d08f08a8, immediate no-write reapplication ALREADY_APPLIED; historical non-reuse reservations preserve main FR-278 |
| SQLite/PostgreSQL receiver/sender native QA | PARTIAL: [bounded candidate evidence](ZURI-GO-REPORT-IMPLEMENTATION-VERIFICATION.md) records 17/17 SQLite/wire checks and structural PostgreSQL DDL; PostgreSQL sender and parent PostgreSQL receiver qualification remain NOT_RUN |
| Live schema, bindings, credentials, sends, deployment | NOT_RUN; outside this approval |

Version diff 0 -> 0.1.0: records executed tooling checks and remaining gates. Existing main records and historical issuance evidence have not been rewritten.

Version diff 0.1.0 → 0.2.0: records independent tooling/reservation/manifest PASS and fresh issuance/no-write replay. Application/native acceptance remains pending.
