---
id: "ZAI:PLAN-FEAT-043-PHASES"
title: "Domain-owned inference pool delivery phases"
version: "0.1.1b"
status: approved
approval_scope: design-and-documentation
approved_on: "2026-09-18"
approved_by: "Owner via conversation"
integration_status: pending
implementation_status: not-started
created_at: "2026-09-17"
last_update: "2026-09-18"
author: ChatGPT
domain: agent
baseline_commit: "cfd5521e7d004e63ffead1e07f46045f1cdc06f2"
bundle: "FEAT-043"
relations:
  - type: relates_to
    target: "ZAI:ADR-099"
  - type: relates_to
    target: "ZAI:FEAT-043"
  - type: relates_to
    target: "ZAI:FR-255-NOTE"
  - type: relates_to
    target: "ZAI:FR-256-NOTE"
  - type: relates_to
    target: "ZAI:FR-257-NOTE"
  - type: relates_to
    target: "ZAI:FR-258-NOTE"
  - type: relates_to
    target: "ZAI:FR-259-NOTE"
---

# FEAT-043 — Domain-owned inference pool delivery phases

> Design approved by the owner on 2026-09-18; canonical integration and all runtime evidence remain pending.

## Current identity and ownership

This candidate adds five new FR subjects under one proposed feature. Existing FR-149/150 remain in FEAT-019, and provider connection FRs remain in their existing bundle. They are dependencies, not reassigned members. New numeric IDs are intentionally unallocated in this draft package; bind them only against the current authoritative registries/ledger.

| Candidate requirement | Owning domain | Handoff |
|---|---|---|
| FR-255 | integration | Scoped nodes, secrets, qualification, pools and normalized observations |
| FR-256 | agent | Server orchestration and private model invocation with behavior parity |
| FR-257 | agent | Atomic capacity, preferred-first spillover, observation freshness and uncertainty |
| FR-258 | platform-control | Removable operator-only projection over owned read contracts |
| FR-259 | line-oa-studio | Explicit account policy, immutable job snapshot, delivery preservation and rollback |

## Runtime handoff map

```text
Existing LINE signed ingress / durable admission
  -> account processing-policy + pool snapshot
  -> FR-256-P1 Agent resolves context/commands
  -> FR-257 admission and per-node capacity lease
  -> FR-256-P2 Integration private inference call
  -> Agent validates tools/results; bounded further invocations if required
  -> FR-256-P3 Studio settlement / existing LINE send / CRM receipt

Integration observer -> latest normalized observations -> Agent router
                                                 \-> operator projection
```

A phase number documents ownership and handoff. The current metadata tooling validates link identity, not executable phase ordering or completion. No drawing asserts that the proposal is already deployed.

## Delivery work packages and gates

| Gate | Work package | Entry | Exit evidence | Scope |
|---|---|---|---|---|
| A | Documentation reconciliation | Reviewed baseline and owner request | Candidate ADR/FR approval; allocated IDs; registry/charter deltas composed; governance green on full checkout | docs only |
| B | Single-node private qualification | Approved policy/network scope | Typed connection/profile; negative auth/SSRF tests; same-Business controls; one real synthetic GPU test | Integration + identity review |
| C | Server model adapter and parity | Gate B, existing grounding/MSP available | Golden tests for context, commands/tools, receipts and no Edge dependency for this lane | Agent + knowledge/MSP contract review |
| D | Two-node admission and observer | Gate C plus calibrated profiles | PostgreSQL multi-process races, A/B spillover, deadline/stale/uncertain/restart tests | Agent + Integration |
| E | Operator projection and safe controls | Owned read/action contracts | Operator RBAC, unavailable-value display, remove-dashboard test, secret-free labels | Platform Control |
| F | LINE policy and delivery integration | Gates B–E | Additive schemas, backward-compatible contracts, per-account opt-in, slow-sibling delivery test, rollback rehearsal | LINE Studio + CRM |
| G | Production activation | Reviewed artifacts, migration and network receipts | One owner-authorized LINE canary; node-failure/saturation checks; trace/CRM acceptance evidence; explicit expansion decision | Operator action |

Work packages may be split into reviewable issues/branches; no package is a claim that a numeric task ID already exists. Integrator reconciles shared PRD/FEATURES/ROADMAP/ledger edits before regenerating views. No two lanes hand-merge generated graph snapshots.

### Deferred explicitly

Public developer API keys/billing, cross-Business shared physical-engine pooling, arbitrary remote GPU enrollment, distributed model/VRAM pooling, live KV migration, server-side vision/document extraction, headless CLI migration, hardware auto-remediation and Kubernetes are not prerequisites or hidden deliverables.

## Evidence and release gates

Record test suite/fixture version, source commit, configuration hash, physical GPU/driver, pinned vLLM image and model/tokenizer/quantization revisions for each hardware proof. Record tested prompt/output-length distributions and actual concurrency; do not report hypothetical VRAM arithmetic as measured load capacity.

Software gate uses the current repository verification commands and scoped contract tests. Hardware and live LINE gates are independent: passing a stubbed provider test does not prove a GPU was called, and receiving a LINE HTTP acceptance does not prove the customer read the message.

## Document authority

[[ZAI:ADR-099]] owns the decision. Global registries own numeric FR/FEAT/SEC/SDD/NFR meanings. Domain notes own detailed behavior, [[ZAI:VERIFY-SELF-HOSTED-INFERENCE-POOL]] lists the proposed proof cases, and [[ZAI:RUNBOOK-SELF-HOSTED-INFERENCE-POOL]] governs operational handoff. Generated views and backlinks are not additional requirement sources.

## Baseline source references

The following immutable repository sources were reviewed; proposed new behavior above is not a claim that it exists in this snapshot.

- [AGENTS.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/AGENTS.md) — Documentation layers; immutable requirement IDs; source/derived separation; domain and process rules.
- [docs/FEATURES.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/FEATURES.md) — Feature versus FR distinction and existing bundles; not complete inventory.
- [docs/roadmap/PLAN-FEAT-019-DOMAIN-PHASES.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/roadmap/PLAN-FEAT-019-DOMAIN-PHASES.md) — Existing cross-domain phase plan precedent; phase metadata does not execute ordering.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | candidate | Initial documentation proposal; no runtime implementation or activation | uncommitted; baseline cfd5521 | ChatGPT |
| 0.1.1b | 2026-09-18 | approved design | Record owner approval; design unchanged; canonical IDs, governance and runtime gates remain pending | uncommitted; baseline cfd5521 | ChatGPT |
