---
id: "ZAI:FR-256-P2"
title: "Server-owned self-hosted model execution"
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
domain: integration
baseline_commit: "cfd5521e7d004e63ffead1e07f46045f1cdc06f2"
parent_requirement: "FR-256"
phase_id: "FR-256-P2"
phase_order: 2
relations:
  - type: references
    target: "ZAI:FR-256"
  - type: relates_to
    target: "ZAI:FEAT-043"
  - type: relates_to
    target: "ZAI:ADR-099"
---

# FR-256-P2 — Server-owned self-hosted model execution

> Design approved by the owner on 2026-09-18; canonical integration and all runtime evidence remain pending.


## Entry condition and predecessor

Input comes from [[ZAI:FR-256-P1]]. The Agent router has atomically reserved eligible node capacity under FR-257. Integration remains the provider transport boundary; it does not choose business scope, execute tools or own the capacity-lease table.

## Input

A Server-authorized scoped connection reference, matching model/profile/configuration epoch, capacity lease reference, bounded Chat Completions envelope, invocation/attempt identity and cancellation/deadline signal. A connection ID is not authority by itself; resolve it within trusted scope.

## Output and next handoff

Resolve the current credential inside the transport and call only the allowlisted API. Return normalized text/tool requests, response status, nullable usage and timing to Agent. Agent validates/executes any authorized tools and repeats an invocation only with a new current budget/lease and preserved evidence. The final validated answer passes to [[ZAI:FR-256-P3]].

The transport exposes no key to the browser, GPU dashboard, job output or logs. vLLM receives no LINE token or recipient and no arbitrary destination supplied by a tool.

## Failure, retry and acceptance

Differentiate a connection failure before transmission from an uncertain post-dispatch disconnect. Preserve actual error classes without copying provider content into public errors. An uncertain dispatch quarantines capacity and never becomes a blind second generation/tool replay. Required tool/reasoning capabilities must already have qualification receipts.

Acceptance: NODES-02/03/04, EXEC-05/06/07, ROUTE-02/06 and T19–T32. A changed node credential/profile or stale policy may deny an invocation even if a previous health probe passed.

## Baseline source references

The following immutable repository sources were reviewed; proposed new behavior above is not a claim that it exists in this snapshot.

- [docs/domains/integration/CHARTER.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/domains/integration/CHARTER.md) — Provider/credential ownership, management surfaces, production-provider restrictions.
- [apps/server/src/modules/agent/model-provider.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/agent/model-provider.js) — Production provider restrictions and actual HTTP/usage/trace adapter.
- [apps/server/src/modules/agent/phase1-runtime.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/agent/phase1-runtime.js) — Production provider selection and secret/Vault configuration gates.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | candidate | Initial documentation proposal; no runtime implementation or activation | uncommitted; baseline cfd5521 | ChatGPT |
| 0.1.1b | 2026-09-18 | approved design | Record owner approval; design unchanged; canonical IDs, governance and runtime gates remain pending | uncommitted; baseline cfd5521 | ChatGPT |
