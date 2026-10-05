---
doc_type: verification-note
title: Marketing report receiver and pure transport — bounded implementation evidence
status: active
superseded_by: null
version: "0.1.0"
date: "2026-10-05"
complexity: C-3
risk: HIGH
---

# Bounded implementation verification

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
