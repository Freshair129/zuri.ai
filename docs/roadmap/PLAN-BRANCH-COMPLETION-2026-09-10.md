---
id: ZAI:PLAN-BRANCH-COMPLETION-2026-09-10
title: Complete the retained branch work after the September cleanup
version: "0.1.0b"
created_at: "2026-09-10T23:45:58+07:00,RWANG,base f320e888"
last_update: "2026-09-10T23:45:58+07:00,RWANG"
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
stays unchanged. Existing worktrees and their uncommitted files remain source
evidence; each implementation lane works on an independent sibling worktree.

## Ownership and order

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

Initial state: LINE OA, memory and Billing/POS workers dispatched; Warehouse,
Goods Receipts and Marketing P5 queued. Integration dependency installation and
baseline validation are complete: 4,539 tests passed, 15 skipped across 556 passed and 5 skipped files. No implementation acceptance claimed.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-10 | beta | Record the owner's parallel continuation request, bounded lanes and verification order | base f320e888 | RWANG |

Version diff: new tracking plan; no requirement identity or runtime behavior changed.


