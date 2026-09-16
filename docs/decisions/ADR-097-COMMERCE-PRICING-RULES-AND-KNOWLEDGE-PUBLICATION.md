---
id: ZAI:ADR-097
title: Commerce pricing rules and governed Knowledge publication
version: "1.0.0b"
status: accepted
created_at: "2026-09-17T03:00:00+07:00,RWANG,uncommitted"
last_update: "2026-09-17T03:00:00+07:00,RWANG"
author: RWANG
attributes:
  doc_type: architecture-decision
  domain: commerce
relations:
  - type: relates_to
    target: ZAI:ADR-065
  - type: relates_to
    target: ZAI:ADR-075
  - type: references
    target: ZAI:FR-252
---

# ADR-097 — Commerce pricing rules and governed Knowledge publication

**Status:** Owner approved on 2026-09-17 in the implementation task, replying
`approve` to the 0.1.0b pricing-engine/rules-console/GenesisRAG17 spec.
Complexity C-3; risk HIGH. Implementation approval is not deployment approval.

## Context

The [approved cost/quote proposal](../change-requests/ZAI-PROPOSAL-SMARTGIFT-COST-QUOTE-ENGINE-20260913.md)
already assigns TASK-ZAI-055/056/059 to versioned pricing rules, one price engine
and structured sell-side Knowledge records. It leaves TASK-ZAI-052 to declare
the governing decision and requirements. FR-252 implements this bounded slice;
Procurement intake, ledger-cost changes, the full Quote lifecycle and LINE
sending remain their existing tasks.

Legacy SmartGift Python/browser calculators contain different FX/floor handling.
Parity is evidence to review, not permission to reproduce incorrect defaults.
Source snapshots and calculated prices remain distinguishable.

## Decision

1. Commerce owns PricingRuleSet versions and deterministic evaluation. The editor
   is `/commerce/pricing-rules`, Business-scoped. Internal rules, cost previews,
   approvals and calculations require Business OWNER plus domain visibility.
   A customer-facing price projection carries no cost, floor or margin.
2. Approved rules are immutable. Draft writes require their current revision.
   Approval records actor, reason and effective date; expiry/revocation preclude
   new calculations. Existing results retain pinned rule/input/evaluator hashes.
   Future-effective versions do not activate early. Missing active rules fail closed.
3. Formula expressions use bounded parsed arithmetic, declared typed variables,
   allowed functions and an acyclic dependency graph, never JavaScript/Python eval.
   Units/currency and division/overflow limits are checked. Mandatory floor and
   rounding remain outside the editable candidate-price expression.
4. Money outputs are integer satang using exact decimal/rational arithmetic.
   Preview, persisted calculations and migrated agent callers use the same evaluator.
   A trusted already-landed path does not add factory/freight a second time.
5. This decision narrowly supersedes ADR-075 D9's pricing-execution placement:
   Commerce now owns the engine, with the approved SmartGift policy as migration
   authority. GKS does not calculate business prices or call Commerce.
   ADR-075 D2/D3 still place a source producer/adapter BEFORE Stage 1.
   Source preparation is not a new stage or a change to Stage 1–17 meanings.
6. Only deliberately approved, allowlisted sell-side records may enter Knowledge.
   Calculations using user-entered trial inputs are simulations, not automatically
   verified catalog prices. Admission reuses FR-187; GKS/Tier-4 receipt and quality
   gates remain authoritative. No direct substrate write, fake stage success or
   automatic publication on rule approval is allowed.
   Computed managed files reserve `PCAT-<requestKeyHash>`, bound to immutable
   ledger calculation rows under `catalog:<requestKeyHash>:<quantity>`.
   The public Commerce `pricing-publication` read port checks their pinned
   policy against the latest effective approval at Knowledge admission,
   publication, query and citation disclosure. Revoked, expired or superseded
   computed prices fail closed, including a policy change during retrieval.
   This private binding does not travel in the sell-side record payload.
7. FR-131's rate-card subject is retained; the business pricing rate matrix used
   by this engine is the versioned rule-set block rather than a second set of
   editable constants. FR-132 consumes the Commerce read port when its task lands.
   Existing FR-181 stock/cost authorization is preserved on engine integration.
8. Additive PricingRuleSet/PricingCalculation storage has tenant/business isolation,
   audit, optimistic concurrency and request idempotency. Migrations are authored
   and locally verified; applying them to production remains ADR-057's operator step.
9. Preserve ADR-075 D8's shadow/cutover/fallback conditions. This slice does not
   retire legacy stores, activate live ingestion or deploy a service.

## Verification

FR-252's feature note records the API, UI and acceptance contract. Proof requires
exact calculation and legacy parity/deliberate-difference vectors; formula abuse,
invalid config and input tests; real isolated persistence/scope/concurrency tests;
browser editing/preview/version activation; and scoped Knowledge admission tests.
Local proof and production publication evidence must be reported separately.

## Alternatives and consequences

Keeping browser and Python pricing writers preserves drift. Moving the engine
into GKS would mix business price authority with Knowledge authority. A single
Commerce evaluator and explicit sell-side adapter preserve both ownership and
traceability, at the cost of a coordinated migration and rule-version lifecycle.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0b | 2026-09-17 | accepted | Owner-approved rules console, shared evaluator and sell-side boundary | uncommitted | RWANG |
