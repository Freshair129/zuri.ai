---
id: "ZAI:FR-256-NOTE"
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
feature: FR-256
module: agent
source: pending
relations:
  - type: references
    target: "ZAI:FR-256"
  - type: relates_to
    target: "ZAI:FEAT-043"
  - type: relates_to
    target: "ZAI:ADR-099"
  - type: references
    target: "ZAI:DOMAIN-AGENT"
  - type: references
    target: "ZAI:ADR-061"
---

# FR-256 — Server-owned self-hosted model execution

> Design approved by the owner on 2026-09-18; canonical integration and all runtime evidence remain pending.


## Behavior and ownership

Agent implements a Server-owned inference path for an account explicitly bound to a qualified self-hosted pool. LINE ingress, the durable job ledger and final LINE sending remain outside this adapter. Integration supplies read-only approved node/profile metadata and credential-resolved transport. MSP/GKS remain independent authorities; neither GPU nor Agent writes their stores directly.

At baseline, `createServerLineAnswer` already composes scoped knowledge and optional memory. Its `LOCAL_ONLY` branch is deterministic. The new provider must be selected explicitly; `LOCAL_ONLY` is not silently reinterpreted and the production provider/Vault restrictions are amended through the approved policy contract rather than bypassed.

### Execution contract

Proposed internal input:

```text
executeSelfHostedAnswer({
  trustedScope, jobId, executionId, conversationKey, accountPolicySnapshot,
  poolId, poolVersion, modelProfileHash, answerDeadlineAt, deliveryMode,
  contextReceiptRef, promptEnvelope, allowedTools, abortSignal
})
```

All identifiers and authority derive from the claimed job and Server resolution. An untrusted question may not choose node, pool, model, endpoint, credentials, retrieval scope, deadline or tool permissions. No parallel public developer API or external API-key billing is added in this release.

Output is bounded answer text, actual profile/node identity, attempt references, nullable reported usage, timing and provenance receipts. It is not a LINE send receipt. Finish state distinguishes valid answer, deadline exhausted, rejected policy, malformed provider output and uncertain execution.

### Per-invocation flow

1. Revalidate the claimed job, tenant/business/account, current processing permission and configuration version.
2. Resolve authorized knowledge/memory through existing ports. Apply the context composer before the actual prompt invocation. Preserve original source provenance, audience restrictions and erasure fences.
3. Count or conservatively bound the **fully rendered** prompt, tool schemas and requested output against the selected profile. A known compatible tokenizer may be used; exact token counts must not be claimed from characters/bytes. Unknown counting/calibration prevents activation for an unbounded context.
4. Request a capacity lease from the Agent router. No node API call occurs before successful admission. Queue wait, retrieval, tool rounds and response persistence share the job's remaining deadline.
5. Call the Integration transport with an allowlisted Chat Completions request and per-node credential. Record the actual submitted prompt hash/context receipt and invocation identity.
6. If tool calls are returned, validate the tool name and arguments against the server's registry and schema. Execute only the caller's authorized capabilities through their existing domain services, then recompose/rebudget before another invocation.
7. Validate nonempty final text, output size, evidence/grounding and stop reason. Commit a bounded result for the current execution; LINE Studio alone determines whether it can be sent.

vLLM tool parsing and prompt formatting depend on the model/profile. Tool parser, chat template and reasoning settings are qualification inputs, not universal flags inherited from Ollama. Do not forward `think`, `options.num_ctx` or model-name-specific fields without a release-tested mapping. [V3]

### Parity gate: removal of Edge must not remove business behavior

| Behavior | Current seam / required disposition |
|---|---|
| Native signed LINE receipt, account namespace, CRM write | Existing Server path unchanged |
| Out-of-hours deterministic answer | Existing admission path unchanged; no model invocation |
| Staff catalogue/project confirmation commands | Preserve existing deterministic Server authority; no model-selected writes |
| Scoped business knowledge / published corpus | Use Server knowledge ports; validate selected grounding mode and generation |
| MSP/context-injection receipts | Preserve opt-in, audience, trimming, before/submitted/completed receipts and unknown-ack behavior |
| Edge sales tool loop / final-answer behavior | Adapt the required provider-neutral behavior into Agent; golden tests must identify equivalence or an approved difference |
| Local filesystem, DuckDB/LAN-only tools, headless CLI | Remain Edge-only; refuse this pool path for requests requiring them |
| Document/vision extraction | Outside this initial text rollout; not implicitly migrated |
| Edge model warm/release schedule | Not translated into raw vLLM sleep/wake API calls; out-of-hours replies remain, GPU power management is deferred |

Reference seams: `apps/server/src/modules/agent/server-line-answer.js`, `phase1-runtime.js`, `model-provider.js`; `apps/edge/src/answer/providers/openai-compatible.ts` and `apps/edge/src/conversation/executor.ts` are read-only parity sources, not modules to import across independent app release boundaries.

## Input, output and failures

### Model profile and cache

Two replica aliases must resolve to the same qualified model profile: artifact/tokenizer/template revisions, quantization, context limit and tool/reasoning behavior. Report the chosen revision, not merely `9B`. GPU memory calibration is node-specific. No assertion is made that a 9B model plus context fits in 6 GB on every engine or GPU.

Persist chat history in the existing application authority. Do not retain a user session in VRAM indefinitely, assume KV cache survives restart, or omit message/context data because the previous turn used the same node. Prefix reuse is opportunistic. Private-context caching follows the approved secret salt/isolation profile or is disabled; no history leakage is permitted by affinity.

### Bounded tools and cancellation

Initial proposed limits are at most three model iterations, at most one active invocation per job, and a profile-bound output cap no greater than the current LINE answer budget. These are activation parameters, not throughput promises. Recompute remaining time before every tool and provider call. A tool requiring confirmation still uses the normal preview/confirmation path.

Tool side effects use existing idempotency/audit contracts; model attempt retry must never re-execute a committed business write. No shell, filesystem, arbitrary SQL or fetched executable is available on the GPU. First release turns off streaming to LINE: Zuri commits a complete validated answer before delivery. Internal provider cancellation is best effort and does not prove remote compute stopped.

### Failure classes

- Refused before invocation: policy/scope denied, no compatible node, bad model profile, context too long, deadline exhausted. No customer prompt leaves Server.
- Definitive pre-dispatch transport refusal: bounded retry may obtain a new eligible lease under the unchanged job policy/deadline.
- Definitive rejected request: classify auth, validation and overload separately; auth/shape problems are not blindly retried on every node.
- Ambiguous post-dispatch timeout/disconnect: record an uncertain model attempt, suppress its eventual stale result, quarantine its capacity, and do not replay tools or auto-switch to a hosted provider.
- Unknown MSP invocation-receipt acknowledgement: retain the existing fail-closed behavior; no second model submission to hide uncertain evidence.
- Valid computation after job cancellation/erasure/epoch change: discard for delivery; no resurrected CRM answer.

An uncertain *model attempt* is not a claim that LINE received anything. Keep compute outcome separate from LINE delivery `UNKNOWN`; use the established job failure/trace mapping and register any new bounded failure code explicitly rather than injecting an unknown enum ad hoc.

## Acceptance criteria

- EXEC-01: SERVER with a self-hosted binding calls only an eligible private node, even when Edge is stopped; no Edge pairing token is sent to vLLM.
- EXEC-02: Existing LOCAL_ONLY and external-provider branches retain their pre-change behavior.
- EXEC-03: Context, tool schema and output budgeting include every actual invocation; no raw hidden history is appended after the receipt is recorded.
- EXEC-04: Knowledge/MSP privacy, corpus provenance, deterministic commands, unknown-receipt refusal and business-tool authority survive the cutover.
- EXEC-05: Malformed/unknown tool calls cannot execute arbitrary capabilities; tool results are treated as data and bounded before reinjection.
- EXEC-06: A disconnect, cancellation or stale execution cannot cause a duplicate tool write or LINE answer.
- EXEC-07: Provider usage unavailable is `null`/UNAVAILABLE, not invented zero; node/profile/attempt timing is traceable without exposing credentials.
- EXEC-08: The two-GPU topology uses independent full replicas; no cross-node KV transfer or distributed GPU runtime is required.

Handoffs: [[ZAI:FR-256-P1]], [[ZAI:FR-256-P2]], [[ZAI:FR-256-P3]].

[V3]: https://docs.vllm.ai/en/stable/features/tool_calling/

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
