---
id: "ZAI:RUNBOOK-SELF-HOSTED-INFERENCE-POOL"
title: "Self-hosted inference pool qualification and recovery"
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
relations:
  - type: references
    target: "ZAI:ADR-099"
  - type: references
    target: "ZAI:FR-259"
  - type: references
    target: "ZAI:VERIFY-SELF-HOSTED-INFERENCE-POOL"
  - type: references
    target: "ZAI:ADR-061"
---

# Self-hosted inference pool — qualification, activation and recovery

> Design approved by the owner on 2026-09-18; canonical integration and all runtime evidence remain pending.

## Scope and prerequisites

This runbook is a candidate operational contract, not an installer and not authorization to change production. Two independent GPU computers run vLLM; Zuri Server must have permitted routed access to them. A Server already reachable through ngrok does not automatically gain a route to a private GPU host. Keep existing Docker/LINE overlay settings intact.

Keep the old Edge installation, keys and data untouched. The deployment never requires deleting a repository or extracting on-premise `.env` files. Never run Compose from an arbitrary worktree against the shared production project; use the repository's reviewed deployment procedure and a separate project/origin for a genuinely isolated test environment.

## 1. Record the baseline

Record source commit, current image digest, account execution/provider policy, current LINE transport owner, pending/claimed/ready/sending/uncertain jobs, migrations applied, backup receipt and rollback approver. Use redacted configuration references; do not paste secret values into the evidence packet.

For each node, record GPU model, VRAM reported by hardware, driver/runtime, OS, engine image/version, model/tokenizer revisions, quantization, context configuration, chat template/tool parser, inference origin/allowed ports and maximum enforced execution horizon. `12 GB`, `16 GB` and `9B` alone are not a deployment profile.

## 2. Establish private transport

Provision permitted LAN/VPN routes and endpoint identity. Use verified HTTPS or a policy-approved authenticated encrypted private tunnel. Restrict source access to the Zuri/observer identities; deny direct Internet and unrelated LAN clients. Keep debug/admin/media-download/weight-management routes inaccessible. A monitor exporter, if present, is read-only and separately gated.

No instruction here disables TLS verification, opens all interfaces publicly, forwards home-router ports, or permits arbitrary private IPs. Do not assume Docker loopback means the host GPU. Container-to-host service discovery/addressing must be tested for the chosen deployment network.

## 3. Install and qualify one replica

Install the reviewed vLLM release and model artifact through operator tooling. This packet does not choose a latest image, unchecked quantization or a universal 9B command. Start with a conservative single admitted request, then perform:

- Valid, absent and incorrect credential probes on the protected model API.
- Model alias and immutable deployment-profile checks.
- Synthetic text response and required tool/schema/reasoning tests.
- Explicit malformed-response, deadline, cancellation and secret-redaction tests.

Example HTTP shapes, **not usable credentials or a public deployment command**:

```http
GET /v1/models HTTP/1.1
Host: gpu-a.internal.example
Authorization: Bearer <NODE_A_SERVICE_KEY>

POST /v1/chat/completions HTTP/1.1
Host: gpu-a.internal.example
Authorization: Bearer <NODE_A_SERVICE_KEY>
Content-Type: application/json

{"model":"approved-pool-alias","messages":[{"role":"user","content":"Return OK."}],"max_tokens":8,"stream":false}
```

A missing/wrong-key success is an authentication-enforcement failure, not a successful connection. A public `/health` response does not qualify credentials. The actual authentication boundary may be the approved private proxy, but it must reject wrong/absent caller credentials in the equivalent network context.

## 4. Calibrate A and B independently

Use synthetic workloads representative of LINE: short chat, longer authorized context, RAG evidence and tool rounds. Pin the same semantic model profile across both nodes; record actual distinct node budgets. Raise admitted concurrency gradually while recording full answer latency, deadline misses, engine queue depth, cache pressure, errors and physical memory.

No generic fixed threshold such as '100 MB per user' or '16 GB handles twice the users' is an acceptance result. KV/token costs vary by model, dtype, context and runtime. A latency percentile needs its workload window and sample count. No OOM does not by itself mean the response-time gate passes.

If another program shares the GPU, either remove it from the inference allocation during the test or record the contention and calibrate an enforced smaller budget. Independent external inference clients are not allowed in the first dedicated-engine deployment.

## 5. Prove Server behavior without sending LINE

Run Agent golden/contract tests through the new private provider using authorized synthetic fixtures, with LINE delivery disabled/stubbed. Check current deterministic commands, retrieval scope, memory receipts, tool validation, output bounds, policy refusal and late-result fencing. Required local-only Edge tools must either stay on Edge or be explicitly unavailable; they cannot disappear silently.

Test two actual Server processes competing for one remaining node slot. Test all nodes unavailable, stale observer data, wrong model, wrong key, engine restart during generation and a lost response after dispatch. No test may automatically call an external hosted model.

## 6. Apply additive state and activate one account

Migration application requires explicit operator authorization. Apply the reviewed SQLite/PostgreSQL/schema changes with correct production roles; record their identities and effects. Never use a destructive reset for rollout.

Drain current computation for the chosen account, reconcile uncertain work and bind the qualified pool through the owning versioned action. Preserve the existing Server LINE webhook and transport owner. New job policy/profile snapshots are immutable. Start the supervised observer and confirm its actual observations, not merely that the process was launched.

Run one owner-authorized canary and trace it end to end. Record selected node/profile, job/execution/attempt/context receipts, validated answer, LINE acceptance and CRM outbound reconciliation. Do not record delivery/read unless the provider actually supplied that evidence.

## 7. Failover, maintenance and recovery

| Situation | Operational action | Must not do |
|---|---|---|
| A busy, B qualified | Admit new requests to B under the same policy | Migrate active A request/KV or exceed node caps |
| A unreachable | Fence new A work; inspect in-flight uncertainty; use eligible B | Assume A stopped computing because client disconnected |
| Model/key changed | Drain or revoke as appropriate; update secret/profile and requalify | Keep old qualification as valid for a new deployment |
| Observer stale | Show UNKNOWN and block unsafe admission | Display load 0 or increase concurrency |
| Both nodes unavailable | Respect queue/deadline; explicit failure/operator signal | Hidden cloud fallback or second LINE sender |
| One model attempt uncertain | Hold/quarantine capacity to verified recovery/horizon | Replay the whole agent/tool turn blindly |
| One LINE send uncertain | Existing delivery reconciliation/operator flow | Retry as a new Reply/Push |
| Dashboard unavailable | Keep owned runtime services operational | Restart GPU because a UI failed |

Drain uses the owner's application state, not a vLLM process kill. Requalification follows restart/model changes. No automatic hardware repair is included.

## 8. Rollback

Stop new pool dispatch for the selected account, preserve signed ingress and durable evidence, reconcile or fence current attempts, and restore the prior authorized inference configuration. Keep exactly one LINE transport owner. A rollback does not delete reservations, traces, CRM rows or Edge files and does not blindly replay stale jobs.

If a migration cannot be safely reversed, keep additive columns/tables and roll forward with the old path disabled from new use. Record the actual rollback boundary and unresolved compute/delivery outcomes.

## Acceptance receipt checklist

Each activation packet records: approver and scope; source/artifact identities; migration and private-network receipts; per-node qualified profiles; credential negative-test results without values; calibrated capacity and workload evidence; multi-process reservation proof; Agent parity; monitoring freshness; live LINE canary; drain/failure/rollback results; explicitly unverified/deferred capabilities.

Blank or absent evidence means pending, not passed. This documentation package contains no production activation receipt.

## Baseline source references

The following immutable repository sources were reviewed; proposed new behavior above is not a claim that it exists in this snapshot.

- [docs/decisions/ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/decisions/ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md) — Existing LINE ownership, optional Edge, durable queue and delivery semantics.
- [apps/server/src/modules/line-oa-studio/domain/line-execution-budget.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/line-oa-studio/domain/line-execution-budget.js) — 5-second send reserve; compute lease does not extend reply lifetime.
- [README.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/README.md) — Monorepo app boundaries, deployment overlay, built-not-committed llms corpus.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | candidate | Initial documentation proposal; no runtime implementation or activation | uncommitted; baseline cfd5521 | ChatGPT |
| 0.1.1b | 2026-09-18 | approved design | Record owner approval; design unchanged; canonical IDs, governance and runtime gates remain pending | uncommitted; baseline cfd5521 | ChatGPT |
