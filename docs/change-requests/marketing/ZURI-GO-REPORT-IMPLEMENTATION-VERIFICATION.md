---
doc_type: verification-note
title: Marketing report receiver and native paired delivery evidence
status: active
superseded_by: null
version: "0.3.0"
date: "2026-10-06"
complexity: C-3
risk: HIGH
---

# Bounded implementation verification

## Approved Phase B rebind — 2026-10-06

The owner approved the bounded [rebind v0.1.0](ZURI-GO-REPORT-PHASE-B-REBIND.md).
Canonical Phase B decision0.3.14b→0.3.15b preserves all194 prior mappings
(SHA256 of their unchanged JSON array `f170d8b0246546bdf903e7bc4142a85486dc2e20e76e1a532a5fb93a12a98c93`)
and adds only the three public Marketing custody models. The197-model raw LF
Prisma schema hash is `45d7a7001daa7ede78fe911d1752bf237a7c42218a51372ec4bb89bdd704de06`;
canonical inventory hash is `e9f5216b1e9368157dcfd5b926eb3798fac335f45d815615424324fe2909f65e`.
The loader still refuses historical/tampered bindings and modified raw bytes.
Schema content is unchanged; LF checkout materialization follows `.gitattributes`.

Offline runner tests initially reproduced three nonempty custody exports and nine
unsupported-field acceptances through permissive callbacks. Direct census and
field guards now refuse before extraction/insertion/commit. Missing/unreadable
counts, historical bindings and failed privileges/locks refuse; all197 tables
remain in the actual PostgreSQL adapter catalog/privilege/lock/census loops. JSON
inclusion, model order, family delegates and immutable triggers are unchanged.
RCA: `.brain/rca/marketing-report-reconciled-ci-fixtures.md`.

Focused isolated tests PASS57/57 at00:59:17 Asia/Bangkok: Phase B runner38,
Phase B backup14, Marketing wire5. These use fake census/transaction adapters
and a mocked connection on the actual PostgreSQL adapter, with ambient application
database access denied. They are not PostgreSQL restore or production-role proof.
Separate opt-in native receiver/full paired regression PASS18/18 (13 integration,
5 wire),00:58:19,74.67 seconds: fresh test-owned PostgreSQL schema12 and native
SQLite reproduce freeze/Claim/lost committed ACK/explicit same-byte retry/durable
receipt; all legacy backup entry points and receiver contention cases pass again.
No skipped native case. Only guarded QA storage was created/migrated.

Independent reviewer reran the final57-case candidate at01:02:25 (2.88 seconds)
and found no blocker; reviewed test blob is `8ab3cc556d633f4a901e03d34489949bd6f307dc`,
inventory `d1f1c22854b3296d4a2122478b88b450be5ce4c5`, decision
`f8f0e1c7b47b5e5b8ea8edc94b323c099a68d024`. Runner final blob
`378cc20571c6f107c63b950698043d03b3165805` differs from the reviewed `edcd0ac3`
only by removal of a duplicate two-line annotation. Native QA remains executed
by the primary agent. Hosted run37332956011 at13591 passed governance/build and three test
shards; its remaining shard failed only the old Phase B inventory collection
(2006 tests passed). Exact pushed-head hosted CI and final composed-check results
are recorded on PR633; these checkpoint tests do not grant merge authority.

PM rule-check: parent26 defines exact frozen binding/complete census and historical
refusal; approved Marketing physical design requires retained custody refusal.
Document20 §5 requires source-clause applicability and exact revision evidence:
this is the separately approved Marketing compatibility slice, not authority to
dispatch its candidate PM packets or perform live operations. Its §4 separates
verification from release/merge. Current record publication stays planned/partial/
not_ready and receiver PostgreSQL remains disabled/unqualified.

Version diff0.2.0→0.3.0: records the approved197-model compatibility fix and new
isolated verification. Real Local/Production remain schema11; no real backup,
restore, credential/binding, send, deploy or merge is performed.

## Full paired native sender checkpoint — 2026-10-05

Owner chose existing trusted local operator plus the configured non-archived Go Business; the parent keeps its independently approved deny-default machine-ingest policy. Go additive schema 012/CMP-004/API-026 implements bounded Claim/Complete/Settle with current authority, strict durable receipts, DB clock after every lock, five-second SQL waits and a pre-network expired-claim denial. The earlier bounded transport-only evidence below remains historical; full isolated sender acceptance now passes.

Final opt-in runner PASS **18/18** (13 integration + 5 wire), 22:02:49 Asia/Bangkok, 33.06 seconds. The additional guarded paired case uses a fresh, empty test-owned loopback PostgreSQL 18.6 database migrated by the actual Go migrator through 012 and restricted `zuri_go_app` (non-superuser/non-BYPASSRLS), plus native Prisma 5.22.0 SQLite receiver QA. Actual Go prepare/freeze → Claim commit → actual bounded Go HTTP → actual Next route → committed parent receipt → dropped response produces Go UNKNOWN with no local receipt. An explicit eligible identical replay returns the original receipt and Go atomically becomes ACKNOWLEDGED. Exactly two sender attempts, one Go receipt, one parent report and one accepted audit. Frozen report/outbox bytes and all 193 parent preexisting non-Audit tables remain unchanged; valid changed campaign bytes conflict409, and disabled parent policy denies identical replay404.

Paired case requires `ZURI_REPORT_GO_SOURCE`, both `ZURI_GO_MARKETING_QA_ADMIN_URL`/`ZURI_GO_MARKETING_QA_RUNTIME_URL`, same loopback `zuri_go_marketing_qa_*` target, initially empty and schema 12. Without these, it reports NOT_RUN/skipped rather than opening application configuration. Go separate sender suite PASS **16/16** (10 native, 3 pure transport, 3 orchestration); P1/P2 native regression PASS6/6 and disposable PGlite regression PASS8/8 on schema-12 QA. Source review PASS pins sender `452ce105`, migration `c4ef2ea6`, native Go tests `12bb9b0b`, orchestration `7488aa6b`, parent paired test `1fd049b6`; reviewer did not independently rerun databases. The primary agent executed these native checks.

The first paired run failed its conflict fixture: changing a target while retaining missing-field codes was invalid422. Final test changes existing `campaign.code`, recomputes the hash and proves409. Subsequent source review also corrected a before-final-lock DB clock in Go; short-lease held-attempt-row ACK/UNKNOWN regressions pass. Go RCA records all lease-boundary findings. No parent runtime implementation, historical record issuance or receipt was rewritten by this checkpoint.

Version diff 0.1.0 → 0.2.0: adds reproducible full paired native sender/receiver and independent review evidence. Parent candidate remains planned/partial/not_ready; Go remains building. Real Local and Production schema11, real credentials/bindings, live sends, parent PostgreSQL receiver qualification, new migration, deployment and merge remain unperformed. This is candidate qualification, not operational release.

Hosted CI at5958b38 exposed two stale reconciliation fixtures (748 versus752 identities, old receiver IDs278–280). These exact assertions are corrected to the reviewed752 identities and FR281–283 without changing historical issuance. A separate Phase B collection failure remains: the frozen194-model schema binding refuses the additive197-model schema. The fail-closed loader and frozen inventory remain untouched. [Phase B compatibility proposal](ZURI-GO-REPORT-PHASE-B-REBIND.md) and `.brain/rca/marketing-report-reconciled-ci-fixtures.md` record the new parent/peer gate. No full hosted-CI PASS or merge readiness is claimed.

Focused reconciled governance/fixture suite PASS55/55 after correcting the planned/partial80% projection assertion. The full registry snapshot completes in14.787 seconds inside its unchanged20-second test budget. Identity publication assertions are separated from receiver runtime coverage. Generated graph/views/corpus must be refreshed after these source changes; an earlier mid-edit graph check correctly reported stale output and is not a final PASS. Go sealed/pushed sender candidate is `caaf942a5f69a620da6c1073f88cf2e10eae3646` (paired documentation checkpoint73a450f).

This candidate implements the approved [receiver physical design](ZURI-GO-REPORT-PHYSICAL-DESIGN.md) against fresh FR-281–283/SDD-112 issued at `d08f08a8f2604bd9657360d37f7c135d636189b7`. The paired Go contract/physical approval is pinned at `4faf6334ce1eadcd291958606b70b94e2ab6b658`. It does not complete the PostgreSQL sender or authorize a live migration, binding, credential, send or deployment. Remote main was rechecked at `077796622233bf9f35905f7eac226f0963760dcb`; the primary parent checkout/runtime is unchanged.

The candidate adds deny-default Business policy, hash-only report binding, immutable reported evidence/receipt and linked audit custody, a dedicated POST receiver, private human read, internal trusted-operator commands and fail-closed legacy backup guards. The SQLite writer gate precedes authorization reads; each bounded contention retry reauthorizes. Receipts leave the service only after the outer commit. PostgreSQL receiver runtime is disabled and unqualified.

| Executed check | Result and boundary |
|---|---|
| Opt-in native runner | PASS 17/17 (12 integration, 5 wire), final run 19:25 Asia/Bangkok, 28.92 seconds. `node apps/server/scripts/run-marketing-report-native.mjs` with private pinned Prisma/Vitest/Go-source overrides; Prisma 5.22.0, engine `605197351a3c8bdd595af2d2a9bc3025bca48ea2`. Each run generates a private client and fresh isolated SQLite databases, with no ambient configuration access. |
| Migration exercised | Baseline Prisma schema pinned at d08f08a8, generated baseline DDL plus the actual candidate additive SQLite migration. This is not a replay of the full historical migration chain or a live schema operation. |
| Authority and preservation | Deny-default, operator CAS, invalid/disabled/revoked and crossed scope denial; actual Next route and Enterprise/session reverse credential isolation; sanctioned viewer fixtures with same-database foreign Tenant/Business/initiative; all 193 preexisting non-Audit tables preserve row contents across intake/replay. Native plan/review/decision behavior remains unchanged. |
| Atomicity and contention | Separate native-client same/different-byte races; audit/report failure and actual deferred outer-commit FK failure roll back with no receipt; observed native P1008 retries see revocation between attempts; write-ahead policy disable and bounded lock exhaustion. |
| Cross-repository transport | Actual Go pure transport → loopback HTTP → actual Next route/native SQLite; committed response loss yields UNKNOWN, explicit same-byte replay validates the original receipt and leaves one report/audit. Frozen synthetic fixture comes from Go's actual envelope builder. No PostgreSQL Claim/Complete/Settle or durable Go ACK is exercised. |
| Custody and restore | Native immutable/scope/linked-audit guards; every legacy backup entry point refuses nonempty machine custody without mutation; whole-database SQLite VACUUM INTO backup restores exact bytes, timestamps and audit link, with immutability/current-target replay checks. |
| Go pure transport tests | PASS 3/3: bounded strict receipt/private config, actual HTTP response bounds/body timeout, fixed-origin no-redirect/single-send behavior. No real target or credential is configured. |
| PostgreSQL artifact portability | PASS structural baseline + candidate apply and identical reapply in a separate synthetic loopback QA database, seven guards, three forced-RLS tables with no policies/client/runtime grants. Actual anonymous read fails 42501 despite simulated default grants. CLI 2.119.0 created `apps/server/supabase/migrations/20261005124416_marketing_external_report.sql`; it is the single PostgreSQL mirror, not the removed private candidate path under prisma/postgres. No receiver PostgreSQL transaction/auth/concurrency qualification is claimed. |
| PostgreSQL native compatibility | Initial independent review/probe reproduced unrelated audit redaction failing 42501. After the narrow trigger-authority fix, restricted zuri_app_runtime unrelated audit redaction, Business/Plan title and Initiative lifecycle edits PASS; linked audit and Business/Plan/Initiative scope mutations fail the intended custody guard. Both narrow definer trigger functions deny direct EXECUTE, pin search_path and require a BYPASSRLS/superuser migration owner; no direct custody access is granted. |
| OpenAPI contract/inventory | PASS 19/19, including exact route-tree inventory and dedicated report bearer/status documentation. Generic object schemas explicitly do not replace the paired strict wire validator. Initial test collection lacked private generated Prisma imports; genuine private SQLite and PostgreSQL clients corrected the environment. No ambient database was queried. |
| Governance snapshot suites | PASS 38/38, full 277-FR/46-FEAT snapshot within the unchanged 20-second budget. Fresh record identity/history remains governed by the separate reconciled tooling evidence. |
| Independent source/test review | PASS after resolving enum coercion, an unapproved CTR bound and missing same-database foreign-scope coverage. Reviewer did not rerun native databases. Reviewed receiver blob `d9a107ffdcc7b536c9210128194a48d11c6837d7`, wire `d7539b687c6ba57e3010f67a9bd42e7d9004ff64`, tests `b7a227e37827aebdda3902d53ac7aae25ab39888`, runner `d08ea63e8caa721bda5c60d11d8970701913de0e`; Go transport `85e2b0e2322a1459352ad70037fa1b0a4bf4fb5e`. |

Earlier runs exposed enum coercion and an unsupported CTR cap; RCA records are `.brain/rca/marketing-report-enum-coercion.md` and `.brain/rca/marketing-report-unapproved-ratio-bound.md`. A new preservation test initially assumed more than 300 native tables and failed before intake; the assertion now derives the exact 193-table inventory from pinned baseline DDL. The final 17/17 result follows these corrections; failures are not discarded as runtime acceptance.

Initial composed governance refused a stale generated view and then four critical inventory/migration bindings; `.brain/rca/marketing-report-governance-bindings.md` records their cause and repair without widening ratchet baselines. Appendix A/B, dedicated OpenAPI documentation, planned roadmap rows and the standard PostgreSQL migration path now bind the candidate. The restricted-role PostgreSQL regression and narrow fix are recorded in `.brain/rca/marketing-report-pg-guard-authority.md`. Final composed governance status accompanies the published candidate commit; an earlier failed run is not a PASS. Supabase live advisor/migration-ledger checks remain NOT_RUN, as no Supabase instance was configured or accessed by this task.

## Remaining gates

Go sender authority clarification is pending: reuse the existing trusted local operator plus non-archived configured Business, or add a separate deny-default sender policy. Migration 012, Claim/Complete/Settle, delivery route, worker/lease/attempt limits and full freeze-to-durable-ACK PostgreSQL concurrency tests remain NOT_IMPLEMENTED/NOT_RUN. Parent internal provisioning commands are not a new operator CLI or a browser UI. Full application build/E2E, hosted API/browser, production and complete historical migration-chain acceptance remain NOT_RUN. Fresh requirements retain planned readiness until complete acceptance; this bounded candidate does not promote them to delivered.

Version diff 0 → 0.1.0: records implemented candidate paths, executed isolated checks, independent review and explicit remaining gates. Application versions and live databases/deployments remain unchanged.
