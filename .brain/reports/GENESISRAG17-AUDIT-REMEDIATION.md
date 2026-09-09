---
version: "1.0.0b"
created_at: "2026-09-08T04:00:00+07:00,RWANG"
last_update: "2026-09-08T04:59:00+07:00,RWANG"
status: beta
attributes:
  domain: knowledge
  doc_type: remediation-report
  scope: user-approved isolated GenesisRAG17 audit repairs
---

# GenesisRAG17 code-audit remediation

The user approved "Fix it all" against the
[code-flow audit](GENESISRAG17-CODE-FLOW-AUDIT.md) and its
[RCA](../rca/2026-09-08-genesisrag17-code-flow-audit.md). This is a C-3 / HIGH
repair of the isolated profile, not production deployment or an expansion to
LLM extraction, OCR, PII classification or general six-lane query planning.

## Contract and ownership

The [wire contract 1.3.0b](../../docs/plans/GENESISRAG17-CONTRACT.md) freezes
source intent before Stage1, typed identity, conservative extraction, distinct
temporal states, measured input counts, exact transaction retries and PASS-only
atomic publication. The wire remains `genesisrag17.v1`; native engine and model
pins remain unchanged. Root owns cross-repository integration and governance;
three user-requested Luna 5.6 Max agents own zuri, GKS and worker repairs.

Base revisions for the uncommitted repair:

| Repository | Base head |
|---|---|
| zuri | `436022a798c8bd46b9dd73904b9572790a9a8945` |
| MSP | `4707912583b800ecaa353162a1e5da7d2db7278a` |
| GKS | `373fd8d6ca09221e171e98e855fe5f519236eff7` |
| GenesisBlock | `022ad3d3144d40f1f33f80b53ec555bb40584799` |

Runtime: Node `24.18.0`, native engine
`e15e35b0093394e0a8880af7f4e6f63cf81223b7`, local CPU
`intfloat/multilingual-e5-small` revision
`614241f622f53c4eeff9890bdc4f31cfecc418b3` (384 dimensions, cosine;
pinned artifact hashes verified by the worker, no revision fallback).
Wire `genesisrag17.v1`; additive source schema migration
`20260908040000_genesisrag17_audit_remediation`.
Temporal parity retains MSP fixture revision
`8b8667dadf01fd7f421260af8b8b260f6cac267f`.

## Repair coverage

| Boundary | Implemented repair | Regression evidence |
|---|---|---|
| Source 1–8 | Durable ingestion intent before receipt, immutable derivation configuration and source occurrences, automatic exact-attempt resume | Actual source process termination after stages 3 and 8; unchanged earlier terminal rows |
| Admission and failed receipt | Atomic run/intent admission and central finish from current Stage1 failure evidence | Process death between run and intent; failed receipt has zero batch and no invented downstream evidence |
| Stage 8–10 | Typed resolution keys, retained repeated occurrences, coordinated subjects, conservative negation/ambiguity handling | Raw multi-chunk semantic fixture through source and GKS; Person/Product name collision |
| Stage 12 | Reversed intervals are HELD without throwing; unmapped temporal language is HELD; undated and open-ended remain distinct | GKS contract cases and actual raw-to-gate rejection |
| Stage 13 | Persist exact native transaction intent/frontier before commit; retain accepted enrichment before clearing outbox | Actual graph commit and graph-receipt process crashes |
| Stage 15–16 | Checkpoint vector collection metadata before vector commit; move lexical writes to Stage16 | Actual final-commit process crash and native reopen regression |
| Stage 17 | PASS-only permission; atomic pointer replacement preserves prior snapshot on failure | Gate contracts, actual pointer-boundary crashes and historical citation queries |
| Evidence and recovery | Measured inputs, Stage9 lookup included in duration, pending acknowledgement retains batch/key, new source tables included in backup | Unit/contract coverage and native six-metric/backup checks |

The final-commit fault injection exposed an additional native recovery cause:
collection creation is initially memory-only, so WAL replay without its checkpoint
reconstructed an incompatible L2 collection. The worker now saves the declaration
before its first vector transaction; strict model/dimension/metric validation is
unchanged. See the [collection recovery RCA](../rca/2026-09-08-genesisrag17-vector-collection-recovery.md).
The separate [source admission RCA](../rca/2026-09-08-genesisrag17-source-admission-recovery.md)
records the pre-intent crash window and why legacy finish excluded receipt failure.

## Verification record

- Before implementation, the new MSP PASS-only gate regression failed because
  WARN/FAIL with `allowPublication: true` was accepted. After the guard change,
  the full MSP suite passed: 186 contract/integration tests and 45 security
  tests, no skips. Client packaging dry-run also passed.
- The initial expanded native suite ran 19 actual scenarios: 18 passed and the
  new raw semantic/temporal case failed at GKS submit with
  `predicate is not defined`, matching the audit. This is red regression
  evidence, not a successful final gate.
- The two-populated-tenant scenario passed in that initial run: both tenants
  have actual persisted chunks, native embeddings and published snapshots.
  They share GKS while each native worker retains its required scope-owned
  store. Queries and historical snapshot IDs cannot cross those scopes. This
  does not claim mixed-tenant native storage support.
- The final repaired native suite passed **25/25, zero skips**, including the
  new backup compatibility code. The complete frozen-tree regression also passed.

Intermediate verification: GKS passed 156 contract/integration and 10 security
tests; worker passed 13 native tests. Zuri build passed against an isolated test
database. Browser regression passed 112 tests with no flaky results; four
pre-existing superseded smoke cases remain explicitly skipped. The first full
zuri unit/integration run passed 4,210 and failed one stale null-acknowledgement
assertion, with 14 environment-gated cases excluded. These intermediate counts
do not replace the final repaired suite below.

## Final checks

| Check | Result |
|---|---|
| MSP contract/integration + security | 186 + 45 passed; zero skips; client pack dry-run passed |
| GKS contract/integration + security | 156 + 10 passed; zero skips; package syntax and client pack dry-run passed |
| GenesisBlock worker native | 13 passed; strict model metadata and actual native reopen covered |
| zuri build | Passed on final runtime code using an isolated SQLite database |
| zuri browser regression | 112 passed, zero flaky; 4 existing superseded smoke tests skipped |
| zuri unit/integration | 4,217 passed, zero failures; 14 explicit environment exclusions |
| Native four-process acceptance | 25 passed, zero failures/skips; final run 291.53 seconds |
| Governance | Passed after final reconciliation; zero duplicate IDs, dangling edges or link findings |
| Cross-repo source-document links | 547 checked, zero missing |

The general zuri suite has 14 pre-existing environment exclusions: nine
Postgres activation/isolation tests and five LINE cross-repo round-trip tests.
They are outside this isolated GenesisRAG profile and are not counted as passing.
The GenesisRAG native suite itself must run every case without exclusions.

Commands used: `npm test` and `npm run pack:client` in MSP/GKS (GKS names the
local MSP checkout with `MSP_REPO_ROOT`); `npm test --prefix genesisrag17-worker`
with the pinned model directory in GenesisBlock; `npm test`, `npm run build`
and `npm run test:e2e` in `apps/server`; root `npm run govern`. Native acceptance
uses `node scripts/run-genesisrag17-acceptance.mjs` from Server, with
`KI17_MSP_ROOT`, `KI17_GKS_ROOT`, `KI17_GENESIS_ROOT` and `KI17_MODEL_DIR` naming
the isolated checkouts/model. The general suite additionally names sibling
checkouts using `ZURI_MSP_REPO_ROOT` and `ZURI_GKS_REPO_ROOT`.

The tests use disposable databases and synthetic documents. The benchmark is
`ki17-corpus-v1` with five queries; its raw-chain proof records Recall@5 = 1.00,
MRR = 1.00, citation correctness = 1.00 and cross-tenant leakage = 0. These are
fixture measurements, not production retrieval claims.

Historical acceptance files remain unchanged. The native suite writes its new
raw-to-published proof to [genesisrag17-repaired-native-chain.json](genesisrag17-repaired-native-chain.json).
The [verification manifest](genesisrag17-remediation-verification.json) records
final test counts and hashes of changed implementation/test/schema files.
All changes remain uncommitted in the four isolated worktrees; no push,
production deployment or production database migration was performed.

## Version diff

| Document | Previous | New |
|---|---|---|
| Shared contract | 1.2.1b | 1.3.0b |
| Stage spec | 1.1.0b | 1.2.0b |
| Stage flow | 1.0.0b | 1.1.0b |
| MSP relay | 1.3.0b | 1.4.0b |
| Knowledge charter | 1.1.0b | 1.2.0b |
| DB appendix | 1.28.0b | 1.29.0b |
| Worker flow / ADR / extension map | 1.0.0b | 1.0.1b |
| GKS GenesisRAG17 ADR | 0.3.0b | 0.4.0b |
| GKS extraction / temporal ADRs | 0.3.0b | 0.3.1b |
| GKS data model | 0.6.0b | 0.7.0b |
| GKS integration flow | 0.3.2b | 0.3.3b |
| GKS tier boundary | 0.1.14b | 0.1.15b |

Requirement IDs, original stage numbering and historical snapshots remain
stable. Additive test-system migrations are not applied to production.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0b | 2026-09-08 | beta | User-approved audit repairs verified across four repositories | base revisions above; working tree | RWANG |
