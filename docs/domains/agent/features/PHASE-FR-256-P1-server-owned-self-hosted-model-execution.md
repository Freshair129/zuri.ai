---
id: "ZAI:FR-256-P1"
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
domain: agent
baseline_commit: "cfd5521e7d004e63ffead1e07f46045f1cdc06f2"
parent_requirement: "FR-256"
phase_id: "FR-256-P1"
phase_order: 1
relations:
  - type: references
    target: "ZAI:FR-256"
  - type: relates_to
    target: "ZAI:FEAT-043"
  - type: relates_to
    target: "ZAI:ADR-099"
---

# FR-256-P1 — Server-owned self-hosted model execution

> Design approved by the owner on 2026-09-18; canonical integration and all runtime evidence remain pending.


## Entry condition and predecessor

The documentation gate is approved; FR-255 has qualified an allowed pool and FR-259 has defined a legal account policy snapshot. This phase describes a runtime handoff, not an automatic execution dependency enforced by doc-graph metadata.

## Input

One current claimed SERVER job, trusted Tenant/Business/account identity, execution/configuration epoch, immutable processing policy, message/context references and authoritative answer deadline. Input originates in the existing Studio job service, never raw client-supplied tenant IDs.

## Output and next handoff

Resolve authorized knowledge/MSP and deterministic commands. Deterministic answers return to Studio without a GPU lease. A model-needed turn produces a bounded prompt/tool envelope, one invocation identity and the context-receipt evidence for the exact intended model input. Hand off to [[ZAI:FR-256-P2]] with a cancellable remaining budget, not a refreshed timeout.

Agent remains orchestration only; knowledge/MSP store access stays behind existing ports. No new memory database or second CRM ingest is created.

## Failure, retry and acceptance

Fail before provider transmission when policy/scope/context budget/receipt evidence is invalid. Unknown memory receipt acknowledgements cannot lead to another prompt submission. Re-fetching context after a policy revision requires reauthorization and a new recorded invocation envelope.

Acceptance: EXEC-02/03/04, LINE-03/05, and verification cases T11–T18. All deterministic and model-needed branches must have a truthful next outcome; empty evidence does not become a fabricated model answer.

## Baseline source references

The following immutable repository sources were reviewed; proposed new behavior above is not a claim that it exists in this snapshot.

- [docs/domains/agent/CHARTER.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/domains/agent/CHARTER.md) — Agent ownership and source-versus-planned behavior caveats.
- [apps/server/src/modules/agent/server-line-answer.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/agent/server-line-answer.js) — SERVER LOCAL_ONLY uses deterministic model; existing grounding/context hooks.
- [apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js) — Durable claim/settle/send and bounded parallel Server worker.
- [apps/server/src/modules/line-oa-studio/domain/line-execution-budget.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/line-oa-studio/domain/line-execution-budget.js) — 5-second send reserve; compute lease does not extend reply lifetime.
- [apps/edge/src/conversation/executor.ts](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/edge/src/conversation/executor.ts) — Local-only URL restrictions and tools/RAG/context composition.
- [apps/edge/src/answer/providers/openai-compatible.ts](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/edge/src/answer/providers/openai-compatible.ts) — Provider-neutral protocol with local-provider-specific extra fields.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | candidate | Initial documentation proposal; no runtime implementation or activation | uncommitted; baseline cfd5521 | ChatGPT |
| 0.1.1b | 2026-09-18 | approved design | Record owner approval; design unchanged; canonical IDs, governance and runtime gates remain pending | uncommitted; baseline cfd5521 | ChatGPT |
