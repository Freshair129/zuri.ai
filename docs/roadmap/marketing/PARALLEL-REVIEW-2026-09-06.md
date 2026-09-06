---
version: "0.1.0b"
created_at: "2026-09-06T14:15:00+07:00,RWANG,987be756"
last_update: "2026-09-06T14:15:00+07:00,RWANG"
status: candidate
superseded_by: null
attributes:
  domain: marketing
  doc_type: implementation-review
  scope: "Parallel development review and first-slice integration decisions"
---

# Marketing — Parallel development review

**Version:** 0.1.0b

**Status:** Review complete; implementation and server plan intake pending.

**Relates to:** [Tracking plan](../PLAN-MARKETING-DOMAIN-IMPLEMENTATION.md), [Approved design](../../change-requests/CR-018-MARKETING-DOMAIN-DESIGN.md)

## Team and evidence

The user explicitly selected GPT-5.6 Luna with max reasoning for parallel development work.
Three agents were started with model `gpt-5.6-luna` and reasoning effort `max`.
Each reviewed the proposal worktree at commit 987be756 without writing files or connecting external systems.
Root performed the independent integration review and applies the reconciled changes.

| Lane | Agent | Completed output |
|---|---|---|
| PM plan | pm_plan_validation | Schema, counts, dependencies, progress, interface coverage and metadata caveats |
| Wave 1 core | wave1_core_contracts | First persistent aggregate, authorization, versioning, audit, PM ownership and tests |
| Wave 1 interfaces | wave1_interface_contracts | Actual shell readiness, reusable contracts, scope resets, accessibility and UI dependencies |

These are development agents. This request does not configure the future Marketing runtime's model,
grant product access, or establish an MSP/GKS integration.

The shared remote main advanced to acf0974f during review, adding LINE rich-menu work and documentation
link tooling. No agent allocated global IDs or wrote schema against a moving registry. The implementation
lane must reconcile that baseline before allocating IDs or merging source changes.

## PM plan findings and corrections

Verified: 5 Workstreams, 47 WorkItems, 5 milestones, 5 gates and 158 BLOCKS edges; the graph is acyclic.
All 100 interface IDs match the inventory and map to declared tasks. Weights total 100%; initial planned
progress is 5% for design only and 0% for implementation. Local vocabulary and strict published schema checks pass.

1. Task provenance was too broad: every task referenced only the domain design. The envelope now includes
   relevant navigation/inventory, channel and team specifications per task. IDs, counts, weights and statuses stay stable.
2. Acceptance and evidence fields are stored as WorkItem metadata. Existing status writes do not enforce
   those fields, and current Roadmap/WorkItem UI does not display them as an acceptance workflow. The
   tracking plan now labels completion evidence as a human delivery policy, not an implemented PM guard.

These corrections do not add a PM feature to the approved Marketing scope. A dedicated PM evidence-UI
enhancement would need its own scope. Server intake still requires an explicit instance, authenticated session
and target Workspace; no dev/production target or Person/Workspace identity has been guessed.

## First functional slice

The integrated recommendation is:

**Business-scoped Strategy draft → immutable version → independent review → exact human decision → PM preview/commit receipt.**

The approved Strategy navigation permits plans before campaign initiatives, so the first slice does not
need a new campaign root just to create a strategy draft. Existing Business Roadmap/Goal owners remain
authoritative. Marketing adds planning meaning and references instead of cloning their goals.

Candidate owned records are MarketingPlan, MarketingPlanVersion, MarketingReview and MarketingDecision.
PM execution linkage retains explicit receipt and Project/Workstream references; whether a join table is
needed is decided from the final association cardinality before migration. No Marketing Task, Project,
TeamMembership, provider credential or binary-asset store is introduced.

Root reconciled the following review recommendations:

- Existing Business ownership plus the `growth` visibility gate is the initial write policy. Team membership
  grants nothing; this slice introduces no new RoleBinding authority.
- Independence applies to the reviewer of the exact artifact. Draft ownership alone must not silently
  prohibit an accountable human decision unless the accepted decision policy requires it.
- FileAsset/content bytes stay with the existing Files owner. Asset Management owns physical assets and
  must not become the owner of Marketing creative binaries.
- Scope comes from the trusted viewer and loaded Business, never a request-body tenant ID. Updates use
  expected-version compare-and-swap; audit writes share the same transaction.
- Marketing calls PM dry-run/commit through the existing service boundary and stores the accepted receipt.
  It never directly inserts PM projects, workstreams, containers or items.
- MSP session/run/lease ownership is a separate dependency. Human-authored plan/review records can be
  implemented without presenting a mock controller as an integrated multi-agent runtime.

## Coding ownership and verification

| Lane | File responsibility | Dependency |
|---|---|---|
| Root integration | Marketing charter/context, requirements/ID ledger, Prisma schema/migrations, generated governance and shared shell configuration | Latest main and frozen first-slice contract |
| Core | Marketing domain schemas, canonical hash/version rules, repository interface and application service | Root-owned data and API contract |
| PM handoff | Marketing adapter for authorized PM preview/commit and receipt association | Exact reviewed version plus verified PM target |
| UI | Native `/growth` and Strategy pages/components; URL state, scope-safe loading, review/diff UI | Functional API contract and authorization |

All coding lanes use separate worktrees. Only root regenerates the shared documentation graph after
integration. Test/build lanes require real local dependency installations, never a junctioned Prisma client.

The UI review confirms `growth` is still reserved with `soon: true` and has no route implementation on the
review baseline. Routes alone will not expose the domain; shell enablement occurs only when real routes and
server checks exist. Existing Business Strategy and PM import components can be reused through their owner
contracts. Source SOT approvals and integration pipeline runs cannot be relabeled as Marketing reviews/runs.

Required tests include Business A/B and cross-tenant denial, owner/visible-only write differences, stale
expected versions, immutable reviews, revoked/expired decisions, hash mismatch, PM scope/idempotency,
Business-switch stale-data prevention, copied URLs, Back/reload, keyboard navigation and mobile layout.
Viewer fixtures come from the existing factory. Mockup sessionStorage, fictional metrics and simulated
approval/provider receipts are not production implementation evidence.

## Version diff and state

Tracking plan 0.1.0b → 0.2.0b adds review findings, more precise task references and metadata/UI limits.
This review report is new at 0.1.0b. Approved Marketing design scope is unchanged.
No product implementation, live integration, actual PM import or remote progress was completed by this review.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | candidate | Consolidate three GPT-5.6 Luna max reviews and define safe first-slice file ownership | See git history | RWANG |
