---
id: ZAI:PLAN-BRANCH-COMPLETION-2026-09-10
title: Complete the retained branch work after the September cleanup
version: "0.6.0b"
created_at: "2026-09-10T23:45:58+07:00,RWANG,base f320e888"
last_update: "2026-09-11T03:45:00+07:00,RWANG"
status: beta
superseded_by: null
attributes:
  domain: delivery-governance
  doc_type: implementation-tracking-plan
  scope: Existing retained branch work; isolated implementation and integration
relations:
  - type: references
    target: ZAI:ADR-025
  - type: references
    target: ZAI:ADR-039
  - type: references
    target: ZAI:ADR-061
  - type: references
    target: ZAI:ADR-074
---

# Retained branch completion

The owner requested parallel GPT-5.6 Luna workers at maximum reasoning effort
to inspect and finish the work identified by the retained-branch audit. This
tracking plan records that continuation request. It does not turn old prototype
annotations into new requirement declarations, approve external sending or
spending, or certify deployment.

The initial integration base is `f320e888` (PR #316). The shared primary checkout
is not modified by this integration lane. Other sessions may advance it.
Existing worktrees and their uncommitted files remain source
evidence; each implementation lane works on an independent sibling worktree.

## Ownership and order

### Owner approval and merged baseline — 2026-09-11

The owner's instruction **"merge and approve"** authorizes merging PR #319 and
implementing all three contracts linked in the preceding completion report:
primary-worker memory composition, Inventory stocktake, and Marketing P5 read/planning.
PR #319 merged at `196e4a9ab4ee3b2b73f76e55e744e39e6f0c364a` after all seven
hosted checks passed on `b03f9751`; the hosted Server result is 4,619 passed / 15
skipped and browser result is 154 passed / 4 skipped, without flaky failures.
The merged base additionally includes PR #317's documentation-only `llms.txt`.

Implementation proceeds in three independent worktrees with the existing
GPT-5.6 Luna Max agents. Root owns integration, shared schema/backup reconciliation,
canonical identity reconciliation and combined validation. Stocktake reserves
FR-184; Marketing planning reserves FR-185; existing subjects remain unchanged.
Each lane records this approval in its contract and completes its specified
tests, build and governance before integration. This is C-3 / HIGH work because
it changes durable recovery and authorization-sensitive state. Production
deployment, production migrations, activation, messaging and ad spend remain
outside the approved implementation scope.

The historical candidate statements below describe the PR #319 cutoff; these
three contracts are now approved and in implementation, not completed features.

| Lane | Existing source | Contract authority | Completion evidence |
|---|---|---|---|
| LINE OA reliability | `codex/line-oa-audit-20260910` plus its uncommitted remediation | Approved LINE OA reliability review; account, rich-menu and Edge lifecycle contracts | Reconciled fixes, regressions, browser and native lifecycle evidence with unavailable gates explicit |
| Trace and thread memory | PR #292 and `codex/line-onboarding-memory-flow` | FR-171 / ADR-070 plus the approved thread-memory plan and actual MSP API contract | Incremental linkage, scope/receipt correctness, composed adapter tests, current build and governance |
| Billing/POS | `feat/p3-commerce-billing-pos` | Commerce charter and ADR-065; missing fiscal-document requirements need a separate concrete declaration | Authoritative seller/payment data, exact money, existing order/payment invariants, reviewed document boundary |
| Warehouse console | `feat/p4-inventory-warehouse` | FR-155, FR-174..FR-180 and ADR-074; stocktake campaign scope is separate | Located ledger reads and authorized atomic writes, no location encoded only in free text |
| Goods Receipts | `feat/procurement-goods-receipts` | FR-164/FR-165 and current Inventory export contract | Dedicated workstation using the existing receipt/ledger transaction and both authority ladders |
| Marketing P5 | `feat/p5-marketing-parallel` | Approved Marketing design and its ordered implementation plan | Real persisted state and truthful unavailable/queued outcomes; no fabricated provider success |
| Superseded branch evidence | Retained Marketing, Knowledge, LINE/Funnel and monorepo drafts | Current main plus exact patch/content comparison | Preserve unique evidence; record supersession without importing old schemas, IDs or generated views |

Three workers run concurrently. Root integrates contracts, coordinates IDs and
shared files, reviews results, and assigns queued lanes as slots become free.
Warehouse/Goods Receipts must use the merged located-stock contract rather than
reintroducing the prototype's reference-string location scheme. LINE OA and
memory workers coordinate their shared conversation-job boundary through root.

## Verification and change boundaries

1. Inspect parent and peer documents, enumerate source/tests and reproduce actual
   failures before repairs. Record evidence-backed RCA for bugs.
2. Reuse approved behavior. When a prototype expands beyond binding documents,
   prepare a concrete documentation delta before implementing that expansion.
   Requirement IDs remain global, immutable and allocated by the integrator.
3. Use independent application dependencies and disposable local databases.
   Never install through a junction or copy production environment files.
4. Each lane reports actual tests, build, governance and user-flow checks. No
   skipped, fixture-only or old CI result is represented as current full proof.
5. Integrate reviewed commits in one tree, regenerate governed views once after
   reconciliation, then validate the combined Server/Edge story. Do not weaken
   zero-test, authorization or flaky-test gates.
6. Existing sessions, provider recipients, credentials and live runtime are not
   modified by this software-completion request. Production migrations,
   deployment and external canaries remain separately evidenced operations.

The task is complete only when all approved retained work is delivered with
verification, or any remaining dependency/approval boundary is identified with
the concrete artifact needed to resolve it. Dispatch, code presence and a branch
commit are intermediate progress, not completion.

## Status

The approved retained implementation is integrated on top of published main
`6400cdcb` (PR #318) in `codex/finish-integration-20260910`. Implementation
revision `4a74c1ed` includes Goods Receipts, LINE OA/Edge reliability, scoped
Platform Integrations callbacks, the direct-webhook Memory/Trace adapter, and
owner-approved Billing/POS. Billing source handoff is `b7c611b3`.

Canonical FR-182 remains the SCM operations console. Billing is FR-186 and POS
is FR-183. Integration restored the canonical ledger from `430e731b` and used
`docs:ids` to add only FR-183/FR-186; no published identity was retired or
reworded. The source branch's transient FR-182 abandonment remains documented
in its commit and revision history. The combined inventory has 231 API routes,
318 HTTP operations and 95 page routes. Dangling Billing route-test annotations
were corrected to the real browser regression, retaining the service-test links.

Final local validation of the combined implementation:

| Gate | Result | Evidence |
|---|---|---|
| Server unit/integration | 4,619 passed, 15 skipped; 564 passed files, 5 skipped | `integration-final-tests.log`; assert-tests-ran confirms executed tests |
| Server production build | PASS | `integration-final-build.log` |
| Full browser regression | 154 passed, 4 skipped, zero failures/flaky; 9.0 minutes | `integration-final-e2e.log`; normal fail-on-flaky gate retained |
| Governance | PASS, zero critical/warning; no duplicate/dangling graph edges | `integration-final-govern.log` |
| Edge | 944 passed, 3 skipped; typecheck/build pass in the OA lane | All `apps/edge` files match verified source `eaf40d09` byte-for-byte |
| Billing focused source | 31 server checks and one browser flow pass | Source handoff `b7c611b3`; final combined suites also pass |

The Billing browser flow proves exact-key issuance retries return the same
number, a durable document renders after reload when its order is older than
55 newer orders, a delayed refresh cannot undo a changed selection, Business B
cannot display A's deep-linked document, manual prices are required for every
POS line, and recorded payment remains pending. The PostgreSQL and SQLite
migration files in integration match the isolated execution proofs exactly:

- PostgreSQL: `512becf9e45c3957d289255bc696f5a7755ab8a02163e6051abda0fa6a0d44d4`.
- SQLite: `5ddca8cccf2592408600e30533b263a7f1874553b72faabf87769c9abf06348e`.

PostgreSQL 17.11 proof includes migration execution, exact catalog parity,
idempotent replay, runtime grants/SET ROLE reads and FK retention/cascade.
SQLite proof includes actual migration execution and parent-deletion refusals.
The disposable PostgreSQL container was removed. General seed data is unchanged.
The evidence root is
`C:/Users/pc/.codex/visualizations/2026/09/10/01a08aba-fa9c-7a51-9e67-415f939bd9ac`;
it holds the logs, SQL snapshots and result manifests. Goods Receipts' latest
rendered evidence is in `apps/server/output/playwright/fr165-receipt-*.png`.

Three new contracts remain candidates awaiting owner approval; no implementation
for them is included:

- [Primary-worker memory composition](../../.brain/reports/2026-09-11-memory-worker-composition-amendment.md).
- [Warehouse stocktake](../../.brain/rca/2026-09-11-warehouse-p4-console-contract.md).
- [Marketing P5 planning](../../.brain/reports/2026-09-11-marketing-p5-audit.md).

The direct `/api/agent/line-webhook` memory adapter is verified. The primary
`/api/line-oa/worker` answer path remains ADR-061 public knowledge without MSP
memory; its amendment is separate. Warehouse reuses the now-merged PR #318
Inventory console and proposes only the missing atomic stocktake contract.
Marketing's proposed read/planning slice does not send broadcasts or buy ads.

The original cleanup removed 12 branches and nine worktrees. New isolated lanes
were created for this continuation; the 02:14 inspection counted 41 branches and
23 worktrees. Original dirty source evidence is preserved with a SHA-256 manifest
outside the checkout, and no additional old or shared worktree was deleted by
this completion stage. The shared primary checkout was advanced by other work,
not reset by this integration lane.

This is local source and isolated-database acceptance. Hosted CI, installed
native-device acceptance, live provider delivery, production migration and
runtime activation are separate evidence states; none is inferred from these
results. The three pending contracts are not reported as completed features.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.6.0b | 2026-09-11 | beta | Record owner approval of the three remaining contracts and verified PR #319 merge; start isolated parallel implementation | 196e4a9a | RWANG |
| 0.5.0b | 2026-09-11 | beta | Record final integrated tests, canonical ID reconciliation, migration hashes and three remaining candidate contracts | 4a74c1ed | RWANG |
| 0.4.0b | 2026-09-11 | beta | Link pending review artifacts and record integrated Business-switch guard plus isolated Billing migration evidence | working-tree | RWANG |
| 0.3.0b | 2026-09-11 | beta | Record verified Edge cleanup repair, Billing identifier collision and three pending contract approvals | working-tree | RWANG |
| 0.2.0b | 2026-09-11 | beta | Record integrated receipt/OA/direct-memory scope, approved Billing work and unresolved worker/E2E gates | working-tree | RWANG |
| 0.1.0b | 2026-09-10 | beta | Record the owner's parallel continuation request, bounded lanes and verification order | base f320e888 | RWANG |

Version diff: 0.4.0b → 0.5.0b; record verified implementation and remaining candidate boundaries without expanding scope.

