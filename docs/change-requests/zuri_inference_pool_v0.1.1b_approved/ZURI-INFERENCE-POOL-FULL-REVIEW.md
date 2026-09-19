# Zuri Self-hosted Inference Pool — Approved Design

**v0.1.1b · Approved design · 18 กันยายน 2026**

เจ้าของอนุมัติแบบแล้ว แต่ canonical ID/registry/ledger integration ยังรอดำเนินการ ไม่มีผลทดสอบ runtime หรือ production activation ใหม่ เนื้อหาออกแบบไม่เปลี่ยนจากชุดที่อนุมัติ

อ่านรายละเอียดที่ `APPROVAL-TH.md`; ฉบับรวมนี้เป็นมุมมองเพื่ออ่าน ไม่ใช่ requirement source อีกชุด


---

<a id="doc-01"></a>

## Document 01 — Server-owned self-hosted inference pool

Source: `drafts/docs/decisions/ADR-099-SERVER-OWNED-SELF-HOSTED-INFERENCE-POOL.md.template`

```yaml
id: "ZAI:ADR-099"
title: "Server-owned self-hosted inference pool"
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
attributes:
  doc_type: architecture-decision
  domain: agent
relations:
  - type: relates_to
    target: "ZAI:ADR-061"
  - type: relates_to
    target: "ZAI:ADR-025"
  - type: references
    target: "ZAI:ADR-039"
  - type: relates_to
    target: "ZAI:FEAT-043"
```

## ADR-099 — Server-owned self-hosted inference pool

**Status:** Design approved by the owner in the subsequent `approve` message, recorded 2026-09-18 (Asia/Bangkok). Canonical ID allocation and repository integration remain pending. This approval is not evidence of implementation, test success, migration application or production activation.

### Context

The requested topology uses two independently serving computers, nominally 12 GB and 16 GB VRAM, each loading a complete copy of a compatible approximately 9B model. A shared model replica serves several active requests on one node. New requests spill from preferred node A to B when safe admission or response deadlines require it. This is request distribution, not VRAM aggregation, tensor parallelism, KV migration or a single distributed model.

The owner prefers to remove the **mandatory Edge executor from this LINE inference path**, while retaining Zuri Server as the business/agent authority. Node enrollment, authentication, health/capacity observation and an operations view must be defined, not assumed to appear because vLLM is installed.

At the reviewed baseline, ADR-061 already separates LINE ownership from optional execution. Server holds native ingress, durable jobs and final delivery. Edge pulls scoped jobs and returns bounded results. `server-line-answer.js` selects `createDeterministicBusinessModel()` for `LOCAL_ONLY`; the production provider gates do not already admit a generic private vLLM pool. The Edge adapter speaks Chat Completions, but the Edge executor also composes tools and retrieval. A URL-only replacement is therefore insufficient.

Authority: [[ZAI:ADR-061]], [[ZAI:DOMAIN-AGENT]], [[ZAI:DOMAIN-INTEGRATION]], [[ZAI:DOMAIN-LINE-OA-STUDIO]]. See the accompanying source review for snapshot paths and the stale-prose versus implemented-code distinction.

### Decision

#### D1. Placement and scope

Propose `LINE → existing Zuri admission/worker → Server agent → pool router → independent vLLM nodes → existing Server delivery`. No Zuri Edge process is required on either GPU for this lane. No Ray, Kubernetes, Redis/BullMQ, LiteLLM or new LINE gateway is required by this decision. It does not prohibit later additions justified by separate requirements.

The first activation is a **single Business-scoped pool with two nodes**. Separate Business pools may be added only with explicit grants and isolated engine deployments. Sharing one vLLM engine across independent Business schedulers or different trust owners is deferred. A Business scope is not automatically a deployment-wide grant.

#### D2. Keep ownership rather than move the entire Edge application

| Concern | Owning lane / process |
|---|---|
| LINE account, job lifecycle, admission, reply/push and cutover | line-oa-studio, using Integration's LINE transport |
| Identity and authorization | identity |
| Provider connections, credentials, node enrollment and normalized observations | integration |
| Agent orchestration, prompt/tool control, routing and capacity leases | agent |
| Customer, conversation and accepted message records | crm |
| Memory/session policy and canonical knowledge | existing MSP and GKS ports; no direct store access |
| Operator-only removable monitoring projection | platform-control |
| Model weights, local inference scheduling and KV cache | each vLLM process |

New proposed models are Integration-owned `InferencePool`, `InferencePoolMember`, `InferenceNodeObservation`, and Agent-owned `InferenceCapacityLease`. A node reuses `IntegrationConnection` with a typed self-hosted provider profile and existing credential references. No second credential table, LINE job table or transcript store is introduced. Add `owns_models` only with actual model implementation; a docs-only declaration lists planned ownership in prose.

#### D3. Explicit processing policy

Keep `executionMode=SERVER` for server orchestration. Add a proposed `SELF_HOSTED_ONLY` value to the appropriate LINE model-access contract, plus a versioned pool reference. Do **not** redefine existing `LOCAL_ONLY`, which must retain its baseline deterministic Server behavior and local-only Edge meaning. Do not use `EXTERNAL_MODEL_ALLOWED` as a shortcut to bypass the local guard.

A valid selected pool is necessary but not sufficient: data classification and the authorization of the job/context must permit processing at the pool's declared trust boundary. Where current contracts cannot express this, admission fails closed until the policy extension lands. The proposal does not certify that operator-owned hardware is on the customer's premises.

#### D4. Enrollment is configuration plus qualification, not an Edge handshake

An authorized manager registers a permitted origin and a write-only credential, chooses an exact model profile, and requests qualification. Server checks the allowed network target and TLS identity, validates good/missing/wrong credentials on protected API endpoints, lists models, and performs a small synthetic generation test. Qualification receipts bind endpoint, credential version, model profile and configuration epoch. They are not hardware attestation or proof of physical location.

The base inference contract is OpenAI-compatible Chat Completions. No custom `/handshake`, callback, job-pull or LINE credential is added to vLLM. Discovery and all examples are provisional until checked against a pinned engine release. [V1] [V2]

#### D5. One model profile, independent node capacities

A pool profile pins the actual model artifact revision, tokenizer revision, quantization, context limit, chat template, reasoning controls, tool parser and capability evidence. A public `model` name is an alias, not proof that two weights files match. The two nodes may have different calibrated slot/token budgets, but must satisfy the same selected semantic/capability profile. A 16 GB card is not assumed faster than a 12 GB card.

#### D6. Capacity admission before network dispatch

Use the existing durable Zuri job queue. The router chooses only authorized, current, qualified nodes with fresh observations and a bounded local-engine queue. Prefer A when it can satisfy the job deadline; spill new work to B rather than wait for A's VRAM allocation to become full. Do not migrate active generation or KV state between nodes.

Serialize reservations for a physical engine identity across all Zuri worker processes using the database-backed lease contract, not process-local counters alone. Each invocation reserves one slot and a conservative calibrated token budget. KV metrics are pressure signals, not an exact count of immediately allocatable tokens; never subtract a cache percentage from nominal VRAM and label the result guaranteed capacity.

#### D7. Monitoring is an operational input, not a new authority over business records

A supervised observer updates one latest normalized observation per node with timestamps, profile/configuration identity and evidence quality. Unknown or stale values remain unknown, never zero. The router uses current observations plus capacity leases; it never blocks on Grafana.

Baseline monitoring covers readiness, auth failures, model mismatch, running/waiting requests, cache pressure, queue latency and complete Zuri answer duration. GPU temperature/power are optional host-exporter data, separately permissioned and explicitly unavailable when not collected. No automatic reboot, process-kill or GPU-clock adjustment is authorized.

#### D8. Preserve agent behavior at Server

Port or adapt only the required provider-neutral tool loop and response validation into the Server's existing agent seam. Preserve deterministic catalogue/project commands, knowledge grounding, scoped MSP context, invocation receipts, cancellation and trace evidence. vLLM receives the minimum authorized prompt/tools and returns text/tool requests; Zuri validates and executes allowed business capabilities. It never receives database superuser credentials or arbitrary shell access.

The first rollout is bounded text conversation. Vision/document extraction, headless coding agents, local filesystem/LAN-only capabilities and all other Edge functions remain unchanged or unavailable on this lane until separately qualified. Do not label a text endpoint as extraction parity.

#### D9. One attempt is not permission to repeat side effects

Every model attempt records `jobId`, `executionId`, `invocationId`, `attemptId`, node and profile epoch. Retry before transmission may select another eligible node; an ambiguous post-dispatch result is recorded and fenced rather than blindly generating again and replaying tools. A client abort does not prove that GPU compute has stopped; quarantine capacity until the configured hard execution horizon or verified recovery.

LINE sending is never performed by the inference adapter. Existing `UNKNOWN`, reply/push constraints, send intents, acceptance-versus-delivery distinctions and CRM reconciliation remain in force. This ADR does not promise exactly-once provider computation or LINE delivery.

#### D10. Security boundary

Only Zuri's controlled private transport may reach approved inference and observation endpoints. Use HTTPS with verified identity or an authenticated encrypted private tunnel whose identities and routing are explicitly provisioned. API keys authenticate the caller, not the server or GPU location. Protect or block monitoring and administrative endpoints separately; native API-key coverage is not universal. [V1]

Enforce an operator-controlled host/IP/port allowlist, constrained DNS resolution at connection time, no redirects, response/body limits and restricted egress. No registration request may access cloud metadata, local management ports or arbitrary internal services. The GPU cannot resolve URLs supplied by customer text or execute plugins supplied by a model request.

Prefix caching is optional. A cache hit is not application memory. For private contexts, either disable cross-request prefix reuse or use a release-verified, secret cache salt scoped at least to the authorized conversation/audience boundary; salt does not replace authorization or imply zero retention. [V1]

#### D11. Operations surface is removable

Integration owns management actions and secrets. Agent owns runtime routing and reservations. The operator dashboard only reads their redacted contracts and delegates approved drain/resume actions to the owning service. Removing the dashboard, Prometheus or Grafana cannot disable inference correctness or delete business state. Business owners see only their pool eligibility through their normal authorized Integration/LINE surfaces, not deployment-wide customer details.

#### D12. Activation is an explicit, reversible per-account operation

Add requirements, policy/schema support, test evidence and release artifacts before activation. Quiesce the chosen account's computation, settle or visibly hold old jobs, bind a qualified pool and run one owner-authorized canary through the existing delivery path. No webhook change or LINE transport-owner change is required for an account already on ADR-061 Server transport.

Keep Edge installed/configured for other capabilities. Do not delete `apps/edge`, its secrets, devices, customer files or existing jobs. Roll back the inference binding without enabling a second LINE sender. Database rollback is additive/forward-safe; never drop state containing active leases or unsettled evidence.

### Alternatives and consequences

| Alternative | Why not the first choice for this request | When it remains appropriate |
|---|---|---|
| Edge + local inference on each GPU | Keeps job pulling, but retains a full device agent where only inference is needed; needs concurrency work | Customer-premise tools/files, outbound-only network, independently managed endpoints |
| Server calls one vLLM endpoint | Valid first proof step, not the final two-node spillover requirement | Phase B qualification |
| LiteLLM gateway in front of nodes | Adds another ownership/routing layer before external keys/billing are needed | Separately approved public API/provider service |
| Native distributed/tensor-parallel model | Solves a different problem; neither node needs only half the model | A future model that cannot fit one node |
| Generic round-robin | Ignores unequal capacities, readiness and LINE deadline | Controlled smoke test only, not the proposed default |
| New inference domain/microservice | Unnecessary while existing Integration/Agent lanes cover the boundaries | Separate product/runtime ownership later |

Consequences: Server needs routed access to GPU APIs; removing Edge loses its outbound-only networking advantage. Server must host the required orchestration capabilities, not merely forward raw LINE text. Capacity observations may be delayed, so calibration, reservation and failure fencing are required. GPU host/Internet/power failure still affects availability; the design adds no fictional HA or throughput SLA.

### Verification

Acceptance is governed by [[ZAI:VERIFY-SELF-HOSTED-INFERENCE-POOL]] and the five FR notes, with separate documentation, software, GPU qualification and live LINE gates. Required evidence includes negative authentication, SSRF refusal, scope isolation, independent replicas, parallel requests, two-worker reservation races, stale telemetry, uncertain execution, deadline exhaustion, tool/RAG/MSP parity, and drain/rollback without duplicate sending.

The package itself does not report runtime tests as passed. No engine version, GPU slot count or model format is approved until measured on the actual computers.

#### Upstream contract references

[V1]: https://docs.vllm.ai/en/stable/usage/security/
[V2]: https://docs.vllm.ai/en/stable/serving/online_serving/openai_compatible_server/

### Baseline source references

The following immutable repository sources were reviewed; proposed new behavior above is not a claim that it exists in this snapshot.

- [AGENTS.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/AGENTS.md) — Documentation layers; immutable requirement IDs; source/derived separation; domain and process rules.
- [docs/decisions/ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/decisions/ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md) — Existing LINE ownership, optional Edge, durable queue and delivery semantics.
- [apps/server/src/modules/agent/server-line-answer.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/agent/server-line-answer.js) — SERVER LOCAL_ONLY uses deterministic model; existing grounding/context hooks.
- [apps/server/src/modules/agent/model-provider.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/agent/model-provider.js) — Production provider restrictions and actual HTTP/usage/trace adapter.
- [apps/server/src/modules/agent/phase1-runtime.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/agent/phase1-runtime.js) — Production provider selection and secret/Vault configuration gates.

### CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | candidate | Initial documentation proposal; no runtime implementation or activation | uncommitted; baseline cfd5521 | ChatGPT |
| 0.1.1b | 2026-09-18 | approved design | Record owner approval; design unchanged; canonical IDs, governance and runtime gates remain pending | uncommitted; baseline cfd5521 | ChatGPT |


---

<a id="doc-02"></a>

## Document 02 — Self-hosted inference pool verification

Source: `drafts/docs/domains/agent/SELF-HOSTED-INFERENCE-POOL-VERIFICATION.md.template`

```yaml
id: "ZAI:VERIFY-SELF-HOSTED-INFERENCE-POOL"
title: "Self-hosted inference pool verification"
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
    target: "ZAI:FR-255-NOTE"
  - type: references
    target: "ZAI:FR-256-NOTE"
  - type: references
    target: "ZAI:FR-257-NOTE"
  - type: references
    target: "ZAI:FR-258-NOTE"
  - type: references
    target: "ZAI:FR-259-NOTE"
```

## Self-hosted inference pool — verification and acceptance matrix

> Design approved by the owner on 2026-09-18; canonical integration and all runtime evidence remain pending.

### Evidence levels

Documentation validation, automated application tests, pinned-engine contract tests, real PostgreSQL concurrency tests, physical GPU qualification and a live LINE canary are separate evidence levels. No level implies the next. Every proposed case below starts **NOT RUN** in this packet.

### Test matrix

| Case | Acceptance link | Stimulus | Required observable outcome | Proof level |
|---|---|---|---|---|
| T01 | NODES-01 | Register same-scope node; read response/audit | Only approved metadata; no key bytes | unit/integration |
| T02 | NODES-01 | Another Business reads/updates connection/pool | Refusal without cross-scope disclosure | integration |
| T03 | NODES-02 | Good, wrong and absent Bearer key | Only configured credential accepted | contract + real node |
| T04 | NODES-02 | Public /health succeeds; protected key invalid | Qualification still fails | contract |
| T05 | NODES-03 | Metadata/loopback/unapproved LAN destination | No socket/request opened | unit/integration |
| T06 | NODES-03 | Redirect, DNS rebinding, mixed IPv4/IPv6 answer | Approved transport boundary enforced | integration |
| T07 | NODES-04 | Model alias exists but required tool/profile unverified | Node cannot enable for that workload | contract |
| T08 | NODES-05 | Stale lifecycle version / key rotation / revoked pool | CAS refusal or explicit requalification | integration |
| T09 | NODES-06 | Two host aliases resolve to same engine | No duplicated independent budget | integration |
| T10 | NODES-07/08 | Snapshot restore and synthetic qualification logs | Disabled restored pool; no customer/key content | integration |
| T11 | EXEC-01/02 | SERVER self-hosted selected with Edge stopped | Actual approved private call; existing policies unchanged | integration + real node |
| T12 | EXEC-03 | Tool schema pushes full prompt beyond profile limit | No oversized invocation; truthful budget failure | unit/contract |
| T13 | EXEC-03 | Tokenizer/template revision differs from profile | No claim of exact safe token capacity | contract |
| T14 | EXEC-04 | Group conversation asks for private MSP content | Audience gate preserved | integration |
| T15 | EXEC-04 | MSP receipt submission acknowledgement lost | No hidden second model submission | integration |
| T16 | EXEC-04 | Published corpus generation changes before settlement | Stale evidence refused/fenced | integration |
| T17 | EXEC-04/LINE-05 | Authorized catalogue/project confirmation command | Existing preview/confirmation/domain writer only | integration/e2e |
| T18 | EXEC-04 | Required filesystem/CLI/vision capability on text pool | Explicitly unsupported; Edge not silently removed | contract |
| T19 | EXEC-05 | Unknown/malformed tool call from model | No unauthorized execution | unit/contract |
| T20 | EXEC-05 | Tool result includes prompt injection / oversized payload | Data-only handling and recomposed bounded context | integration |
| T21 | EXEC-06 | Tool write completed, model continuation disconnects | No duplicate committed write | integration |
| T22 | EXEC-07 | Provider omits usage / wrong JSON / empty output | UNAVAILABLE usage; no invented valid answer | contract |
| T23 | ROUTE-01 | A reaches calibrated slots; B is eligible | New request goes to B; A cap not exceeded | integration + two real nodes |
| T24 | ROUTE-02 | Two Server processes race for one remaining slot | At most one reservation admitted | real PostgreSQL |
| T25 | ROUTE-03 | Stale/missing metrics or percent mistakenly 80 not .8 | UNKNOWN/invalid; never extra capacity | unit/integration |
| T26 | ROUTE-03 | Out-of-order and old-epoch observer writes | Newer state not overwritten | integration |
| T27 | ROUTE-04 | Free GPU but auth/profile/scope revoked or drained | No dispatch | integration |
| T28 | ROUTE-05 | A free memory but too slow for job deadline | Eligible B or honest deadline refusal | unit/integration |
| T29 | ROUTE-06 | Server dies after reserve but before dispatch | Safe RESERVED recovery; no duplicate provider call | fault injection |
| T30 | ROUTE-06 | Server dies after dispatch or client aborts | Uncertain capacity retained/quarantined | fault injection + real node |
| T31 | ROUTE-06 | Old provider answer arrives after new execution/erasure | Late result cannot settle/send | integration |
| T32 | ROUTE-07 | Both nodes saturated/unavailable | Bounded queue/failure; no cloud request | integration |
| T33 | LINE-01/09 | Old account and older Edge wire consumers | Backward-compatible unchanged behavior | cross-app contract |
| T34 | LINE-03 | Job carries old pool version after account switch | Explicit fence; no unauthorized retarget | integration |
| T35 | LINE-05 | Outside account business hours | Existing fixed reply; no GPU invocation | integration |
| T36 | LINE-06 | One answer ready, sibling model hangs | Ready answer gets independent bounded send opportunity | integration |
| T37 | LINE-07 | Reply deadline expired and delayed Push disabled | No send; defined deadline failure | integration |
| T38 | LINE-07 | Delayed Push enabled; original policy selects it | Existing Push/idempotency flow only | integration |
| T39 | LINE-07 | LINE Reply/Push outcome uncertain | No fresh blind resend/recomputed agent turn | integration |
| T40 | LINE-07 | LINE accepted but CRM write failed | Receipt-only CRM reconciliation; no second send | integration |
| T41 | LINE-08 | Quiescent inference rollback | One LINE sender; Edge and evidence untouched | operator rehearsal |
| T42 | LINE-02 | Authorized actual LINE canary | Provider acceptance and CRM record traced; no read claim | live authorized canary |
| T43 | LINE-04 | Two real unequal-memory nodes with known workload | Measured capacity/latency, not nominal-memory arithmetic | hardware load test |
| T44 | MON-01 | Business owner/non-operator visits /control/inference | Operator guard enforced | e2e |
| T45 | MON-02/07 | Missing GPU exporter/stale engine observation | Unavailable label and timestamp, never fake zero | e2e |
| T46 | MON-03/ROUTE-08 | Remove dashboard and disable Prometheus | Routing correctness remains; critical observer still runs | integration |
| T47 | ROUTE-08 | Stop critical observer | Freshness expires; unsafe admission blocks | integration |
| T48 | MON-04/05 | View dashboard; stale drain/resume action | Read makes no inference/send; mutating action reauthorizes | e2e |
| T49 | MON-06/08 | Repeated fault and notification unconfigured | Deduplicated/redacted event; no false notified claim | integration |
| T50 | ROUTE-09 | One metrics parse failure | No host reboot/model unload/GPU restart | integration |
| T51 | EXEC-03/04 | Private prefixes across conversation/audience boundaries | Salted/disabled reuse; authorization remains independent | contract + real node |
| T52 | ROUTE-10 | Raise capacity without hardware calibration receipt | Activation/update refused | integration |

### Suggested test placement — new files, not claimed existing

- Server unit: `apps/server/tests/unit/inference-pool-policy.test.js`, `inference-router.test.js`, `inference-metric-normalization.test.js`.
- Server integration: `apps/server/tests/integration/self-hosted-line-inference.test.js`, `inference-reservation-postgres.test.js`, `inference-node-security.test.js`.
- Browser: `apps/server/tests/e2e/inference-pool-management.spec.js`, `inference-operations.spec.js`.
- Cross-app tests retain existing Edge/LINE schemas; no unsupported policy is pushed to old Edge versions.

Use the repository's viewer factory and real writer/service contracts. Source annotations reference only code that actually enforces the requirement. Test files used in `@tested` must exist; do not fabricate proof edges during documentation-only work.

### Hardware proof record

Each run captures image/model/tokenizer/template revisions, GPU/driver, node-specific model/cache settings, admitted concurrency, prompt/output-token distributions, warm/cold state, sample count/window, answer latency/deadline misses, engine queue/cache readings and errors. Report background GPU contention. A memory calculation or one short prompt is not a production concurrency benchmark.

### Release gate

All applicable security, scope, retry/uncertainty, deadline and compatibility cases must pass. Hardware-dependent tests can be unavailable during CI but are mandatory before the account's production activation. Skips require a named reason and cannot be counted as success. One failing critical scope/duplicate-send case blocks rollout regardless of aggregate pass percentage.

Run the current repository's governance and verification commands after integrating sources and approved IDs. Include generated state according to the current branch's policy; do not hand-edit graph/backlink files or force-add ignored built corpora. Live migration, secrets/network provisioning and LINE activation require explicit operator evidence.

### Baseline source references

The following immutable repository sources were reviewed; proposed new behavior above is not a claim that it exists in this snapshot.

- [docs/domains/agent/CHARTER.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/domains/agent/CHARTER.md) — Agent ownership and source-versus-planned behavior caveats.
- [apps/server/src/modules/agent/server-line-answer.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/agent/server-line-answer.js) — SERVER LOCAL_ONLY uses deterministic model; existing grounding/context hooks.
- [apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js) — Durable claim/settle/send and bounded parallel Server worker.
- [apps/server/src/modules/line-oa-studio/domain/line-execution-budget.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/line-oa-studio/domain/line-execution-budget.js) — 5-second send reserve; compute lease does not extend reply lifetime.
- [apps/edge/src/conversation/executor.ts](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/edge/src/conversation/executor.ts) — Local-only URL restrictions and tools/RAG/context composition.
- [apps/edge/src/answer/providers/openai-compatible.ts](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/edge/src/answer/providers/openai-compatible.ts) — Provider-neutral protocol with local-provider-specific extra fields.

### CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | candidate | Initial documentation proposal; no runtime implementation or activation | uncommitted; baseline cfd5521 | ChatGPT |
| 0.1.1b | 2026-09-18 | approved design | Record owner approval; design unchanged; canonical IDs, governance and runtime gates remain pending | uncommitted; baseline cfd5521 | ChatGPT |


---

<a id="doc-03"></a>

## Document 03 — Server-owned self-hosted model execution

Source: `drafts/docs/domains/agent/features/PHASE-FR-256-P1-server-owned-self-hosted-model-execution.md.template`

```yaml
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
```

## FR-256-P1 — Server-owned self-hosted model execution

> Design approved by the owner on 2026-09-18; canonical integration and all runtime evidence remain pending.


### Entry condition and predecessor

The documentation gate is approved; FR-255 has qualified an allowed pool and FR-259 has defined a legal account policy snapshot. This phase describes a runtime handoff, not an automatic execution dependency enforced by doc-graph metadata.

### Input

One current claimed SERVER job, trusted Tenant/Business/account identity, execution/configuration epoch, immutable processing policy, message/context references and authoritative answer deadline. Input originates in the existing Studio job service, never raw client-supplied tenant IDs.

### Output and next handoff

Resolve authorized knowledge/MSP and deterministic commands. Deterministic answers return to Studio without a GPU lease. A model-needed turn produces a bounded prompt/tool envelope, one invocation identity and the context-receipt evidence for the exact intended model input. Hand off to [[ZAI:FR-256-P2]] with a cancellable remaining budget, not a refreshed timeout.

Agent remains orchestration only; knowledge/MSP store access stays behind existing ports. No new memory database or second CRM ingest is created.

### Failure, retry and acceptance

Fail before provider transmission when policy/scope/context budget/receipt evidence is invalid. Unknown memory receipt acknowledgements cannot lead to another prompt submission. Re-fetching context after a policy revision requires reauthorization and a new recorded invocation envelope.

Acceptance: EXEC-02/03/04, LINE-03/05, and verification cases T11–T18. All deterministic and model-needed branches must have a truthful next outcome; empty evidence does not become a fabricated model answer.

### Baseline source references

The following immutable repository sources were reviewed; proposed new behavior above is not a claim that it exists in this snapshot.

- [docs/domains/agent/CHARTER.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/domains/agent/CHARTER.md) — Agent ownership and source-versus-planned behavior caveats.
- [apps/server/src/modules/agent/server-line-answer.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/agent/server-line-answer.js) — SERVER LOCAL_ONLY uses deterministic model; existing grounding/context hooks.
- [apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js) — Durable claim/settle/send and bounded parallel Server worker.
- [apps/server/src/modules/line-oa-studio/domain/line-execution-budget.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/line-oa-studio/domain/line-execution-budget.js) — 5-second send reserve; compute lease does not extend reply lifetime.
- [apps/edge/src/conversation/executor.ts](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/edge/src/conversation/executor.ts) — Local-only URL restrictions and tools/RAG/context composition.
- [apps/edge/src/answer/providers/openai-compatible.ts](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/edge/src/answer/providers/openai-compatible.ts) — Provider-neutral protocol with local-provider-specific extra fields.

### CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | candidate | Initial documentation proposal; no runtime implementation or activation | uncommitted; baseline cfd5521 | ChatGPT |
| 0.1.1b | 2026-09-18 | approved design | Record owner approval; design unchanged; canonical IDs, governance and runtime gates remain pending | uncommitted; baseline cfd5521 | ChatGPT |


---

<a id="doc-04"></a>

## Document 04 — Server-owned self-hosted model execution

Source: `drafts/docs/domains/agent/features/FR-256-server-owned-self-hosted-model-execution.md.template`

```yaml
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
feature: "FR-256"
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
```

## FR-256 — Server-owned self-hosted model execution

> Design approved by the owner on 2026-09-18; canonical integration and all runtime evidence remain pending.


### Behavior and ownership

Agent implements a Server-owned inference path for an account explicitly bound to a qualified self-hosted pool. LINE ingress, the durable job ledger and final LINE sending remain outside this adapter. Integration supplies read-only approved node/profile metadata and credential-resolved transport. MSP/GKS remain independent authorities; neither GPU nor Agent writes their stores directly.

At baseline, `createServerLineAnswer` already composes scoped knowledge and optional memory. Its `LOCAL_ONLY` branch is deterministic. The new provider must be selected explicitly; `LOCAL_ONLY` is not silently reinterpreted and the production provider/Vault restrictions are amended through the approved policy contract rather than bypassed.

#### Execution contract

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

#### Per-invocation flow

1. Revalidate the claimed job, tenant/business/account, current processing permission and configuration version.
2. Resolve authorized knowledge/memory through existing ports. Apply the context composer before the actual prompt invocation. Preserve original source provenance, audience restrictions and erasure fences.
3. Count or conservatively bound the **fully rendered** prompt, tool schemas and requested output against the selected profile. A known compatible tokenizer may be used; exact token counts must not be claimed from characters/bytes. Unknown counting/calibration prevents activation for an unbounded context.
4. Request a capacity lease from the Agent router. No node API call occurs before successful admission. Queue wait, retrieval, tool rounds and response persistence share the job's remaining deadline.
5. Call the Integration transport with an allowlisted Chat Completions request and per-node credential. Record the actual submitted prompt hash/context receipt and invocation identity.
6. If tool calls are returned, validate the tool name and arguments against the server's registry and schema. Execute only the caller's authorized capabilities through their existing domain services, then recompose/rebudget before another invocation.
7. Validate nonempty final text, output size, evidence/grounding and stop reason. Commit a bounded result for the current execution; LINE Studio alone determines whether it can be sent.

vLLM tool parsing and prompt formatting depend on the model/profile. Tool parser, chat template and reasoning settings are qualification inputs, not universal flags inherited from Ollama. Do not forward `think`, `options.num_ctx` or model-name-specific fields without a release-tested mapping. [V3]

#### Parity gate: removal of Edge must not remove business behavior

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

### Input, output and failures

#### Model profile and cache

Two replica aliases must resolve to the same qualified model profile: artifact/tokenizer/template revisions, quantization, context limit and tool/reasoning behavior. Report the chosen revision, not merely `9B`. GPU memory calibration is node-specific. No assertion is made that a 9B model plus context fits in 6 GB on every engine or GPU.

Persist chat history in the existing application authority. Do not retain a user session in VRAM indefinitely, assume KV cache survives restart, or omit message/context data because the previous turn used the same node. Prefix reuse is opportunistic. Private-context caching follows the approved secret salt/isolation profile or is disabled; no history leakage is permitted by affinity.

#### Bounded tools and cancellation

Initial proposed limits are at most three model iterations, at most one active invocation per job, and a profile-bound output cap no greater than the current LINE answer budget. These are activation parameters, not throughput promises. Recompute remaining time before every tool and provider call. A tool requiring confirmation still uses the normal preview/confirmation path.

Tool side effects use existing idempotency/audit contracts; model attempt retry must never re-execute a committed business write. No shell, filesystem, arbitrary SQL or fetched executable is available on the GPU. First release turns off streaming to LINE: Zuri commits a complete validated answer before delivery. Internal provider cancellation is best effort and does not prove remote compute stopped.

#### Failure classes

- Refused before invocation: policy/scope denied, no compatible node, bad model profile, context too long, deadline exhausted. No customer prompt leaves Server.
- Definitive pre-dispatch transport refusal: bounded retry may obtain a new eligible lease under the unchanged job policy/deadline.
- Definitive rejected request: classify auth, validation and overload separately; auth/shape problems are not blindly retried on every node.
- Ambiguous post-dispatch timeout/disconnect: record an uncertain model attempt, suppress its eventual stale result, quarantine its capacity, and do not replay tools or auto-switch to a hosted provider.
- Unknown MSP invocation-receipt acknowledgement: retain the existing fail-closed behavior; no second model submission to hide uncertain evidence.
- Valid computation after job cancellation/erasure/epoch change: discard for delivery; no resurrected CRM answer.

An uncertain *model attempt* is not a claim that LINE received anything. Keep compute outcome separate from LINE delivery `UNKNOWN`; use the established job failure/trace mapping and register any new bounded failure code explicitly rather than injecting an unknown enum ad hoc.

### Acceptance criteria

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

### Baseline source references

The following immutable repository sources were reviewed; proposed new behavior above is not a claim that it exists in this snapshot.

- [docs/domains/agent/CHARTER.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/domains/agent/CHARTER.md) — Agent ownership and source-versus-planned behavior caveats.
- [apps/server/src/modules/agent/server-line-answer.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/agent/server-line-answer.js) — SERVER LOCAL_ONLY uses deterministic model; existing grounding/context hooks.
- [apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js) — Durable claim/settle/send and bounded parallel Server worker.
- [apps/server/src/modules/line-oa-studio/domain/line-execution-budget.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/line-oa-studio/domain/line-execution-budget.js) — 5-second send reserve; compute lease does not extend reply lifetime.
- [apps/edge/src/conversation/executor.ts](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/edge/src/conversation/executor.ts) — Local-only URL restrictions and tools/RAG/context composition.
- [apps/edge/src/answer/providers/openai-compatible.ts](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/edge/src/answer/providers/openai-compatible.ts) — Provider-neutral protocol with local-provider-specific extra fields.

### CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | candidate | Initial documentation proposal; no runtime implementation or activation | uncommitted; baseline cfd5521 | ChatGPT |
| 0.1.1b | 2026-09-18 | approved design | Record owner approval; design unchanged; canonical IDs, governance and runtime gates remain pending | uncommitted; baseline cfd5521 | ChatGPT |


---

<a id="doc-05"></a>

## Document 05 — Inference capacity routing and health

Source: `drafts/docs/domains/agent/features/FR-257-inference-capacity-routing-and-health.md.template`

```yaml
id: "ZAI:FR-257-NOTE"
title: "Inference capacity routing and health"
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
feature: "FR-257"
module: agent
source: pending
relations:
  - type: references
    target: "ZAI:FR-257"
  - type: relates_to
    target: "ZAI:FEAT-043"
  - type: relates_to
    target: "ZAI:ADR-099"
  - type: references
    target: "ZAI:FR-255"
  - type: references
    target: "ZAI:FR-256"
```

## FR-257 — Inference capacity routing and health

> Design approved by the owner on 2026-09-18; canonical integration and all runtime evidence remain pending.


### Behavior and ownership

Agent owns capacity-aware admission and node selection for the Server inference path. Integration supplies qualified connection profiles and normalized current observations; it owns no business answer. The LINE job ledger stays the only durable conversation-work queue. Per-engine vLLM scheduling is not a replacement for that application queue.

Preferred-first spillover is the requested default: A receives new work while it is eligible and can meet the remaining answer budget; B receives new work when A is unhealthy, policy-ineligible or sufficiently loaded. Different memory sizes do not prescribe a 12:16 weight or a fixed number of users.

#### Proposed capacity ledger

`InferenceCapacityLease` is one **Agent-owned** table with a sole writer under `src/modules/agent/`. Fields include UUID, trusted tenant/business, connection/engine identity, pool/version, job/execution/invocation/attempt references, profile hash, configuration epoch, slot count, conservative reserved tokens, state, created/expires/released times and version. It is scheduling evidence, not chat history, provider billing or the LINE delivery state machine.

Lease states: `RESERVED → DISPATCHED → RELEASED`, with `CANCELLED_PRE_DISPATCH` and `UNCERTAIN_REMOTE` branches. A RESERVED lease can expire safely only if no provider submission started. DISPATCHED or uncertain work is not recycled merely because the client timed out.

A PostgreSQL adapter serializes reservation decisions by canonical engine identity, for example with an advisory transaction lock and aggregate active leases in the same transaction. A SQLite test adapter must exercise equivalent serialization. Do not mutate another domain's models just to acquire a lock. Multi-process correctness must be proved on real PostgreSQL; mocked counters are insufficient.

### Input, output and failures

#### Observation contract

Normalize only the selected node/engine's metric series:

```text
NodeObservation {
  nodeConnectionId, configurationEpoch, profileHash,
  receivedAt, observedAt, observerId, sampleSequence,
  health: READY | UNHEALTHY | UNKNOWN,
  auth: VALID | INVALID | UNKNOWN,
  model: MATCH | MISMATCH | UNVERIFIED,
  runningRequests: integer | null,
  waitingRequests: integer | null,
  kvUsageRatio: number[0,1] | null,
  latencyEstimateMs: number | null,
  sampleWindowCount: integer,
  evidenceSource, errorCode
}
```

`receivedAt` comes from the collector; do not trust an engine's clock for freshness. An out-of-order or old-epoch sample cannot overwrite a newer one. Bound labels, number of series, response bytes, numeric ranges and parse time. Unknown fields/metrics cannot become zero. Never attach LINE IDs, prompt text or credentials as labels.

The initially verified vLLM metric contract includes `vllm:num_requests_running`, `vllm:num_requests_waiting`, `vllm:kv_cache_usage_perc` (ratio; 1 means 100%) and latency histograms. An exporter profile must verify names/units/labels on the pinned deployment. `/load` is optional and its schema must be qualified; the router must not assume an undocumented JSON shape. [V4]

A memory-use percentage from `nvidia-smi` measures a different thing from active KV pressure. A full preallocated pool is not synonymous with no capacity. Even cache pressure can include release-specific/reclaimable behavior, so it is not an exact free-token API. Do not invent `free_kv_blocks` if the deployed endpoint does not expose it.

#### Poller lifecycle and proposed starting defaults

Run a supervised observer from the existing long-lived Server release/supervisor pattern, with startup/shutdown hooks or an authenticated bounded observer tick. Do not rely on a browser tab, one incoming LINE message or an untracked Next.js hot-reload timer to keep monitoring alive. A singleton/lease or idempotent latest-observation write prevents competing observer updates. The observer's internal endpoint is not public.

| Parameter | Proposed starting value | Meaning |
|---|---:|---|
| Busy observation interval | 2 s | Per node, with jitter |
| Idle interval | 10 s | No active/pending pool jobs |
| Busy sample stale age | 8 s | Exceeding this makes load data UNKNOWN |
| Idle sample stale age | 30 s | On new work, refresh before admission if busy freshness is not met |
| Individual probe timeout | 2 s | Bounded network/parse operation |
| Transport failure circuit threshold | 3 consecutive | Avoid disabling on one transient failure |
| Initial circuit cool-down | 15 s | Only a bounded half-open probe is allowed afterwards |
| Recovery successes | 2 current checks | Avoid rapid route flapping |

These values are test defaults to calibrate, not observed performance or an SLA. Invalid credentials, revoked policy or a model mismatch makes the node ineligible immediately regardless of the transient threshold. One metrics parse failure marks that observation unknown; it does not restart the engine or fabricate an empty queue.

#### Admission algorithm

1. Resolve the trusted job snapshot, allowed pool and exact model profile. Serialize active turns for the same account/conversation to avoid answer-order and memory races; other conversations may run in parallel. Do not infer conversation ownership from a supplied external LINE user ID.
2. Require current qualification, administrative ENABLED state, permitted processing trust and fresh required health/auth/model/load evidence. A drained node is excluded even if its health endpoint is green.
3. Calculate the final prompt token count or a proved conservative upper bound with the pinned tokenizer/template. Add requested output and a documented safety margin. Enforce each node's context limit. A pool has no cross-node token/VRAM sum.
4. Check the deadline: compare remaining end-to-end budget against a calibrated conservative latency estimate for this workload bucket plus send/persistence reserve. With insufficient history, use a bounded initial calibration envelope, not a fabricated p95 from two samples.
5. Under the per-engine database lock, check active lease slots and reserved token budget against calibrated node caps. Re-read current policy/configuration epoch. Allocate the lease atomically before dispatch.
6. Prefer A when eligible. Otherwise attempt B under its own lock. A failed compare-and-set/reservation restarts selection from current state within a small bounded retry count.
7. If neither qualifies, release any pre-dispatch holds and leave work visibly deferred under the existing job contract until its deadline, or return a defined capacity/deadline failure. No cloud fallback, unlimited inner queue or polling loop that holds an execution lease beyond its useful lifetime.

Let `slots(n)` and `tokens(n)` be the totals from unexpired active/uncertain leases for node n, and `need(r)` the conservative invocation budget. Admission requires `slots(n)+1 <= capSlots(n)` and `tokens(n)+need(r) <= capTokens(n)`, plus all non-capacity gates above. `capTokens` is calibrated usable workload budget, not nominal VRAM converted by a universal formula. Engine observations detect external load/drift; they are not added to lease totals as if every metric represented a distinct extra request.

The first production profile dedicates these engine processes to Zuri. Uncontrolled external clients invalidate the capacity model. Detect unexpected load, degrade availability and require recalibration or centrally governed access; a vLLM service key is not per-Business fairness enforcement.

#### Concurrency and uncertainty

Reservations live in PostgreSQL so two web processes cannot both see the same unreserved slot and admit it. Holds include a hard maximum execution horizon configured and tested for the inference deployment. Client cancellation or lease expiry cannot prove remote compute stopped. Retain/quarantine uncertain capacity until a verified cancellation, node restart/requalification, or the tested hard remote execution horizon with safety margin has passed. If no reliable horizon/cancel evidence exists, keep the node unavailable for new admission until operator recovery.

Do not equate the return of `/health` or an aggregate zero queue with proof that a particular disputed request never ran. Late results are accepted only against current job/execution/version/epoch. Retry of a purely model-only call may be a future explicit policy; automatic replay after dispatch is off in this release.

KV affinity is an optional tie-breaker after health/deadline/capacity gates. It cannot pin a user to a dead or full node, grant access to another conversation, or replace Server history. No live migration of an in-flight generation is attempted.

#### Suggested failure vocabulary

`POOL_NOT_QUALIFIED`, `POOL_SCOPE_DENIED`, `NO_ELIGIBLE_NODE`, `NODE_AUTH_INVALID`, `NODE_MODEL_MISMATCH`, `NODE_OBSERVATION_STALE`, `CAPACITY_UNAVAILABLE`, `CAPACITY_RESERVATION_CONFLICT`, `CONTEXT_LIMIT_EXCEEDED`, `ANSWER_DEADLINE_EXHAUSTED`, `MODEL_EXECUTION_UNCERTAIN`.

These are proposed internal bounded codes. Map them deliberately to the existing job/trace contract; do not add unapproved values to strict completion schemas.

### Acceptance criteria

- ROUTE-01: Concurrent same-profile requests fill calibrated A capacity and spill new work to B, while total reservations on either node never exceed its caps.
- ROUTE-02: Two independent Server processes racing for one slot produce at most one successful lease; prove on PostgreSQL.
- ROUTE-03: Missing/stale/wrong-unit/out-of-order metrics never become zero or extra capacity; stale idle snapshots are refreshed before busy admission.
- ROUTE-04: Wrong profile, scope, auth, processing policy or drain excludes a node even if VRAM is free.
- ROUTE-05: A slow node with free memory does not capture work that cannot meet the answer deadline; larger VRAM is not treated as guaranteed lower latency.
- ROUTE-06: Queued jobs and same-conversation sequencing survive process restart without duplicate answer/tool/send; stranded pre-dispatch and uncertain post-dispatch reservations are distinguished.
- ROUTE-07: No external provider, active request migration or cross-node cache transfer occurs when both nodes saturate.
- ROUTE-08: Removing the dashboard/Prometheus does not change reservation correctness; stopping the actual observer makes node data stale and blocks unsafe admission.
- ROUTE-09: A metric/read outage alone never causes a host reboot, model unload or GPU restart.
- ROUTE-10: Allocation, latency and memory calibration is captured per physical node/profile/context bucket before raising concurrency.

[V4]: https://docs.vllm.ai/en/stable/usage/metrics/

### Baseline source references

The following immutable repository sources were reviewed; proposed new behavior above is not a claim that it exists in this snapshot.

- [docs/domains/agent/CHARTER.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/domains/agent/CHARTER.md) — Agent ownership and source-versus-planned behavior caveats.
- [apps/server/src/modules/agent/server-line-answer.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/agent/server-line-answer.js) — SERVER LOCAL_ONLY uses deterministic model; existing grounding/context hooks.
- [apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js) — Durable claim/settle/send and bounded parallel Server worker.
- [apps/server/src/modules/line-oa-studio/domain/line-execution-budget.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/line-oa-studio/domain/line-execution-budget.js) — 5-second send reserve; compute lease does not extend reply lifetime.
- [apps/edge/src/conversation/executor.ts](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/edge/src/conversation/executor.ts) — Local-only URL restrictions and tools/RAG/context composition.
- [apps/edge/src/answer/providers/openai-compatible.ts](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/edge/src/answer/providers/openai-compatible.ts) — Provider-neutral protocol with local-provider-specific extra fields.

### CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | candidate | Initial documentation proposal; no runtime implementation or activation | uncommitted; baseline cfd5521 | ChatGPT |
| 0.1.1b | 2026-09-18 | approved design | Record owner approval; design unchanged; canonical IDs, governance and runtime gates remain pending | uncommitted; baseline cfd5521 | ChatGPT |


---

<a id="doc-06"></a>

## Document 06 — Server-owned self-hosted model execution

Source: `drafts/docs/domains/integration/features/PHASE-FR-256-P2-server-owned-self-hosted-model-execution.md.template`

```yaml
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
```

## FR-256-P2 — Server-owned self-hosted model execution

> Design approved by the owner on 2026-09-18; canonical integration and all runtime evidence remain pending.


### Entry condition and predecessor

Input comes from [[ZAI:FR-256-P1]]. The Agent router has atomically reserved eligible node capacity under FR-257. Integration remains the provider transport boundary; it does not choose business scope, execute tools or own the capacity-lease table.

### Input

A Server-authorized scoped connection reference, matching model/profile/configuration epoch, capacity lease reference, bounded Chat Completions envelope, invocation/attempt identity and cancellation/deadline signal. A connection ID is not authority by itself; resolve it within trusted scope.

### Output and next handoff

Resolve the current credential inside the transport and call only the allowlisted API. Return normalized text/tool requests, response status, nullable usage and timing to Agent. Agent validates/executes any authorized tools and repeats an invocation only with a new current budget/lease and preserved evidence. The final validated answer passes to [[ZAI:FR-256-P3]].

The transport exposes no key to the browser, GPU dashboard, job output or logs. vLLM receives no LINE token or recipient and no arbitrary destination supplied by a tool.

### Failure, retry and acceptance

Differentiate a connection failure before transmission from an uncertain post-dispatch disconnect. Preserve actual error classes without copying provider content into public errors. An uncertain dispatch quarantines capacity and never becomes a blind second generation/tool replay. Required tool/reasoning capabilities must already have qualification receipts.

Acceptance: NODES-02/03/04, EXEC-05/06/07, ROUTE-02/06 and T19–T32. A changed node credential/profile or stale policy may deny an invocation even if a previous health probe passed.

### Baseline source references

The following immutable repository sources were reviewed; proposed new behavior above is not a claim that it exists in this snapshot.

- [docs/domains/integration/CHARTER.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/domains/integration/CHARTER.md) — Provider/credential ownership, management surfaces, production-provider restrictions.
- [apps/server/src/modules/agent/model-provider.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/agent/model-provider.js) — Production provider restrictions and actual HTTP/usage/trace adapter.
- [apps/server/src/modules/agent/phase1-runtime.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/agent/phase1-runtime.js) — Production provider selection and secret/Vault configuration gates.

### CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | candidate | Initial documentation proposal; no runtime implementation or activation | uncommitted; baseline cfd5521 | ChatGPT |
| 0.1.1b | 2026-09-18 | approved design | Record owner approval; design unchanged; canonical IDs, governance and runtime gates remain pending | uncommitted; baseline cfd5521 | ChatGPT |


---

<a id="doc-07"></a>

## Document 07 — Inference node registration and trust

Source: `drafts/docs/domains/integration/features/FR-255-inference-node-registration-and-trust.md.template`

```yaml
id: "ZAI:FR-255-NOTE"
title: "Inference node registration and trust"
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
feature: "FR-255"
module: integration
source: pending
relations:
  - type: references
    target: "ZAI:FR-255"
  - type: relates_to
    target: "ZAI:FEAT-043"
  - type: relates_to
    target: "ZAI:ADR-099"
  - type: references
    target: "ZAI:DOMAIN-INTEGRATION"
```

## FR-255 — Inference node registration and trust

> Design approved by the owner on 2026-09-18; canonical integration and all runtime evidence remain pending.


### Behavior and ownership

Integration provides Business-scoped registration and qualification of self-hosted inference endpoints. It reuses `IntegrationConnection` and existing secret-resolution/provisioning abstractions. The selected product scope is a Business, not an arbitrary caller-supplied tenant. Identity verifies the viewer; only the owning Business's approved manager may select/register within the operator's allowed network targets. Raw key provisioning/rotation requires the established step-up assurance policy.

The network-target allowlist is installation-operator configuration, separate from a Business owner's provider selection. Being an installation operator does not silently grant access to Business prompts, model keys or customer records. Sharing a physical engine across Business pools is not part of the first release.

#### Proposed data and ownership

| Entity | Owner | Required meaning |
|---|---|---|
| IntegrationConnection | integration, existing | Scoped node connection; proposed self-hosted provider code; metadata excludes secrets |
| IntegrationCredential / secret references | integration, existing | Write-only secret versions; no second API-key database |
| InferencePool | integration, proposed | UUID/code, tenant/business, logical model alias, immutable versioned profile, lifecycle/version |
| InferencePoolMember | integration, proposed | Pool/node connection reference, priority, calibrated slot/token budget, epoch/version |
| InferenceNodeObservation | integration, proposed | One latest bounded normalized observation per connection; observed/received time, epoch and evidence quality |

A member and pool must have the same Tenant/Business. Each node connection belongs to one active pool in the first release. The target engine identity is canonicalized so aliases cannot enroll the same engine twice and evade capacity accounting. This is an operator/configuration assertion plus endpoint checks, not cryptographic physical-device attestation.

Use UUIDs internally, human-readable codes for management, and versioned audited services for mutations. SQLite development and PostgreSQL production schemas/migrations must agree. Only implemented models enter charter `owns_models`.

#### Administrative lifecycle

`DRAFT → QUALIFYING → QUALIFIED → ENABLED → DRAINING → DISABLED → ARCHIVED`.

Qualification may end `FAILED`; an explicit new qualification creates a new attempt. Observed health is independent of lifecycle: `ENABLED` does not imply `READY`. Drain stops new assignments while existing attempts may settle. Archive is refused while references or unsettled reservations require the record. Emergency revoke fences new dispatch and stale completion according to the LINE/Agent policy; it is not equivalent to a graceful drain.

### Input, output and failures

#### Registration contract (proposed, not an existing endpoint)

`registerInferenceNode(viewer, { businessId, code, endpointOrigin, apiBasePath, modelProfileRef, credentialInput, expectedVersion })`.

`businessId` is a locator checked against the authenticated viewer; the resolved trusted scope is authoritative. `apiBasePath` is `/v1` in the initial profile. Origin excludes path, query, fragment and userinfo. Endpoint values come only from authorized management, never LINE text, a model's tool arguments or an Edge job.

`credentialInput` is either a supported write-only provision operation or an opaque reference to the selected SecretStorePort. A raw key must never appear in a read response, audit payload, request log, model context, metrics label or error message. Storage uses the approved backend; do not assume ADR-061's LINE-token mount exemption authorizes model secrets.

Read output: internal ID/code, redacted endpoint label, profile metadata, administrative lifecycle, credential status/version, last qualification timestamp and bounded error code. Physical endpoints are shown only to the properly authorized manager/operator surface, not a general Business viewer.

#### Proposed API ownership

Management routes stay under Integration's existing `src/app/api/platform/integrations/**` ownership. Candidate subpaths are `inference-pools`, `inference-nodes`, `inference-nodes/[id]/qualify`, and lifecycle actions. They are names to register and test, not routes present at the baseline. Thin handlers call management services under `src/modules/integration/application/`; network/provider code stays under `src/platform/integrations/` and imports no business domain.

#### Qualification protocol

1. Resolve viewer scope, endpoint allowlist and secret reference. Validate origin, DNS/address family, permitted CIDR/host/port and route policy before any socket is opened.
2. Establish the configured authenticated transport. Verify TLS hostname/certificate where HTTPS is used. Reject redirects and DNS rebinding; all resolved destinations must remain in the approved target set at connection time.
3. Read the protected model-list endpoint with the valid credential. In an equivalent authenticated network context, repeat with absent and deliberately incorrect Bearer credentials; both must be rejected by the configured access boundary.
4. Confirm the expected served model alias. Compare against the operator-provided immutable deployment profile. `/v1/models` alone is not proof of weights revision, GPU type or quantization.
5. Run one bounded synthetic text request without customer data. Validate response shape, nonempty output, allowed model identity and a useful end-to-end timing sample. A successful HTTP status with malformed/empty output is failure.
6. Run capability tests required by the target workload, especially tool-call syntax/arguments and reasoning behavior. Mark untested capabilities `UNVERIFIED`, not supported.
7. Persist a redacted qualification receipt bound to endpoint, credential version, profile hash, configuration epoch and test revision. Enablement is an explicit action after gates pass.

A successful health probe is not an authentication test. Model alias equality is not cryptographic deployment attestation. Mutual TLS can authenticate deployed service identities, but does not prove what model/hardware the process actually runs. [V1] [V2]

#### Security controls

Allow only the exact required methods/paths: protected model listing and Chat Completions, plus the selected management-network observation endpoints. Deny arbitrary admin, debug, filesystem, weight loading, sleep/wake or cache-reset endpoints. A future tokenizer endpoint is separately allowlisted after its release-specific schema/auth behavior is verified.

Reject link-local metadata addresses, loopback management targets, multicast, public Internet targets outside policy, nonapproved private hosts/ports, userinfo, redirects and unbounded bodies. Private RFC1918 addresses are not automatically trusted. With a private VPN, peer identity, subnet routes and ACLs must be provisioned before enrollment; an IP string alone is not pairing.

Hard limits proposed for management probes: connect 2 s; header 3 s; normalized response cap 64 KiB for model metadata, 1 MiB for metrics; qualification generation 15 s/32 output tokens unless a reviewed hardware profile sets stricter limits. These are initial **policy defaults**, not measured engine guarantees. Do not disable certificate validation to make qualification succeed.

#### Rotation and recovery

Stage a new secret version, qualify against the node's configured credential set, then atomically select it for new requests. Never log a key for troubleshooting. If the deployed engine cannot rotate without restart, drain, restart through the operator's deployment tooling, requalify and resume; the application does not invent a hot-reload feature. Revocation prevents new dispatch immediately and records in-flight uncertainty honestly.

| Failure code | Result |
|---|---|
| INFERENCE_SCOPE_DENIED | Refuse without exposing other Business existence |
| INFERENCE_ENDPOINT_FORBIDDEN | No network request |
| INFERENCE_TLS_INVALID | No credential transmission over an untrusted connection |
| INFERENCE_AUTH_INVALID | Node ineligible until credential repair |
| INFERENCE_AUTH_NOT_ENFORCED | Qualification refused even if valid-key probe succeeded |
| INFERENCE_MODEL_MISMATCH | No production prompt dispatched |
| INFERENCE_CAPABILITY_UNVERIFIED | Required workload cannot select this node |
| INFERENCE_QUALIFICATION_TIMEOUT | Failed receipt, no auto-enable |
| INFERENCE_SECRET_UNAVAILABLE | Fail closed, no anonymous request |

### Acceptance criteria

- NODES-01: An authorized same-scope registration creates exactly one connection and no readable key; another Business gets a refusal with no disclosure.
- NODES-02: Good credentials pass; absent/wrong credentials fail. A health-only success cannot mark authentication qualified.
- NODES-03: A supplied URL cannot access metadata services, another internal application or a rebinding/redirect destination.
- NODES-04: Missing/wrong model, unverified tool behavior or a changed profile/credential epoch prevents admission until requalification.
- NODES-05: Drain/resume/revoke/rotation use versioned audited transitions and cannot resurrect archived/revoked nodes.
- NODES-06: Duplicate endpoint aliases cannot create two independent capacity budgets for one physical engine.
- NODES-07: Restored metadata starts disabled/unqualified; backups contain only the existing approved secret-reference representation, never raw node keys. Credentials must be revalidated before activation.
- NODES-08: A generation probe uses synthetic content only and leaves no customer prompt in observations.

Verification and phase handoff: [[ZAI:VERIFY-SELF-HOSTED-INFERENCE-POOL]], [[ZAI:PLAN-FEAT-043-PHASES]].

[V1]: https://docs.vllm.ai/en/stable/usage/security/
[V2]: https://docs.vllm.ai/en/stable/serving/online_serving/openai_compatible_server/

### Baseline source references

The following immutable repository sources were reviewed; proposed new behavior above is not a claim that it exists in this snapshot.

- [docs/domains/integration/CHARTER.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/domains/integration/CHARTER.md) — Provider/credential ownership, management surfaces, production-provider restrictions.
- [apps/server/src/modules/agent/model-provider.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/agent/model-provider.js) — Production provider restrictions and actual HTTP/usage/trace adapter.
- [apps/server/src/modules/agent/phase1-runtime.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/agent/phase1-runtime.js) — Production provider selection and secret/Vault configuration gates.

### CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | candidate | Initial documentation proposal; no runtime implementation or activation | uncommitted; baseline cfd5521 | ChatGPT |
| 0.1.1b | 2026-09-18 | approved design | Record owner approval; design unchanged; canonical IDs, governance and runtime gates remain pending | uncommitted; baseline cfd5521 | ChatGPT |


---

<a id="doc-08"></a>

## Document 08 — Server-owned self-hosted model execution

Source: `drafts/docs/domains/line-oa-studio/features/PHASE-FR-256-P3-server-owned-self-hosted-model-execution.md.template`

```yaml
id: "ZAI:FR-256-P3"
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
domain: line-oa-studio
baseline_commit: "cfd5521e7d004e63ffead1e07f46045f1cdc06f2"
parent_requirement: "FR-256"
phase_id: "FR-256-P3"
phase_order: 3
relations:
  - type: references
    target: "ZAI:FR-256"
  - type: relates_to
    target: "ZAI:FEAT-043"
  - type: relates_to
    target: "ZAI:ADR-099"
```

## FR-256-P3 — Server-owned self-hosted model execution

> Design approved by the owner on 2026-09-18; canonical integration and all runtime evidence remain pending.


### Entry condition and predecessor

Receive a final bounded result from [[ZAI:FR-256-P2]] through the Server answer seam. Agent has completed required response/grounding checks. This phase coordinates existing Studio settlement and Integration/CRM ports; it transfers no data-model ownership.

### Input

Job/execution/version, account transport epoch, immutable processing binding, validated answer or explicit compute failure, context/attempt evidence and the original delivery/deadline policy. No GPU-supplied recipient or delivery method is accepted.

### Output and next handoff

Fence stale/cancelled/erased work, persist the current valid answer, and use the established send-intent path. Integration performs the one authorized LINE call. CRM records/reconciles accepted outbound messages through its existing writer. A durable acceptance can be reconciled after restart without another send.

If the model result is ready while a sibling invocation is still slow, the scheduler/send path must preserve this answer's remaining delivery budget; do not wait for the sibling just to end a large batch.

### Failure, retry and acceptance

Retain current Reply/Push consent, idempotency and UNKNOWN semantics. A failed/uncertain compute attempt is not reported as LINE delivery. A lost LINE response is not reported as a safe-to-repeat send. No expired/ineligible output is made current by retrying under a new account configuration.

Acceptance: LINE-02/03/06/07/08/09, EXEC-06 and T33–T43. The live canary and rollback are deployment gates, not tests this package claims to have run.

### Baseline source references

The following immutable repository sources were reviewed; proposed new behavior above is not a claim that it exists in this snapshot.

- [docs/domains/line-oa-studio/CHARTER.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/domains/line-oa-studio/CHARTER.md) — LINE job/transport ownership and existing ADR-061 amendment.
- [docs/decisions/ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/decisions/ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md) — Existing LINE ownership, optional Edge, durable queue and delivery semantics.
- [apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js) — Durable claim/settle/send and bounded parallel Server worker.
- [apps/server/src/modules/line-oa-studio/domain/line-execution-budget.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/line-oa-studio/domain/line-execution-budget.js) — 5-second send reserve; compute lease does not extend reply lifetime.

### CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | candidate | Initial documentation proposal; no runtime implementation or activation | uncommitted; baseline cfd5521 | ChatGPT |
| 0.1.1b | 2026-09-18 | approved design | Record owner approval; design unchanged; canonical IDs, governance and runtime gates remain pending | uncommitted; baseline cfd5521 | ChatGPT |


---

<a id="doc-09"></a>

## Document 09 — Self-hosted inference policy and cutover

Source: `drafts/docs/domains/line-oa-studio/features/FR-259-self-hosted-inference-policy-and-cutover.md.template`

```yaml
id: "ZAI:FR-259-NOTE"
title: "Self-hosted inference policy and cutover"
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
domain: line-oa-studio
baseline_commit: "cfd5521e7d004e63ffead1e07f46045f1cdc06f2"
feature: "FR-259"
module: line-oa-studio
source: pending
relations:
  - type: references
    target: "ZAI:FR-259"
  - type: relates_to
    target: "ZAI:FEAT-043"
  - type: relates_to
    target: "ZAI:ADR-099"
  - type: references
    target: "ZAI:ADR-061"
  - type: references
    target: "ZAI:FR-256"
  - type: references
    target: "ZAI:FR-255"
```

## FR-259 — Self-hosted inference policy and cutover

> Design approved by the owner on 2026-09-18; canonical integration and all runtime evidence remain pending.


### Behavior and ownership

LINE OA Studio adds an explicit account-level selection of a qualified self-hosted inference pool while remaining the owner of `LineConversationJob`, admission and final delivery. It does not become the provider/secret authority or a GPU scheduler. CRM, Integration, Agent, MSP and GKS retain their existing writers.

This is a new requirement, not a reassignment of FR-150 (optional Edge execution) or FR-149 (server-owned LINE transport). Existing accounts keep their current configuration until an authorized per-account transition is performed.

### Input, output and failures

#### Proposed configuration matrix

| Execution placement | Model-access policy | Result |
|---|---|---|
| SERVER | LOCAL_ONLY | Existing deterministic Server answer remains unchanged |
| SERVER | EXTERNAL_MODEL_ALLOWED | Existing production provider route remains unchanged |
| SERVER | SELF_HOSTED_ONLY (proposed) | Qualified same-scope pool required; no external fallback |
| EDGE | Existing policies | Existing device contract remains unchanged |
| EDGE | SELF_HOSTED_ONLY (proposed) | Refused in v1; no unsupported enum sent to older devices |

Pool selection is a scoped reference, not an arbitrary URL. An account and selected pool must share the authorized Tenant/Business; data policy must permit the pool's processing boundary. Publisher authority alone must not expose raw credentials; pool management stays in Integration. Model inference on operator-owned hardware is not automatically customer-premise processing.

#### Durable job snapshot

Admission records execution placement, processing permission, `inferencePoolId`, pool/configuration version and selected profile hash together with the existing account/job facts. These proposed fields land in both database schemas and an additive migration, with default behavior preserving old jobs. The job also retains the authoritative reply deadline, delivery permission, transport epoch and execution identity.

A model alias/profile change must not redirect an already-admitted prompt silently. At dispatch, compare the immutable snapshot with current policy and qualification. If incompatible, fence or cancel the job visibly rather than retarget it. An owner may explicitly re-admit a new request under a new policy; the system must not manufacture consent.

Reuse `lineExecutionBudget` through an explicit supported Server contract. At the inspected baseline it reserves 5,000 ms for LINE reply sending and treats negotiated execution leases separately from reply lifetime. Do not multiply or extend the LINE token lifetime because a GPU queue is busy. The copied calculator's current constants are existing behavior, not a newly measured service guarantee.

#### Preserve the existing delivery path

```text
Native signed webhook
  → durable capture / existing admission
  → LineConversationJob
  → SERVER answer with explicit pool snapshot
  → bounded validated answer committed for current execution
  → existing READY / send-intent flow
  → Integration LINE transport
  → accepted-output reconciliation in CRM
```

Out-of-hours answers, staff/catalogue commands, CRM session namespace, opt-in memory receipts and erasure remain in force. Non-text events are not enrolled in a text model merely because the endpoint can accept a JSON body.

Do not add a second message queue. If the existing worker batch waits for all model calls before sending ready answers, adjust bounded scheduling/send ticks in the existing service so one slow inference does not consume another completed job's remaining reply budget. Prove it with tests; merely increasing the Server concurrency environment variable is not a complete deadline solution.

#### Delivery, retries and uncertainty

Reply/Push selection stays the Server's decision. Delayed Push remains opt-in. If permitted and the existing job contract selects it, use its existing retry key and delivery state; no new ungoverned notification path is introduced. Provider acceptance does not prove delivery/read.

An ambiguous model request does not imply LINE was sent. An ambiguous LINE send remains delivery-UNKNOWN and must not be retried as a fresh reply/push. No uncertainty branch recomputes the whole agent turn and repeats already-committed tools. A late answer after lease/configuration/transport-epoch change cannot become a sendable result.

#### Cutover procedure and rollback

1. Record the account's current execution/provider policy and outstanding jobs, without exporting secrets.
2. Qualify both nodes, prove negative auth and private routing, calibrate independent capacities, and run Server-only agent parity tests with delivery stubbed.
3. Pause new computation for the selected account and drain/settle old claims. Existing LINE Server ingress and durable capture remain available; pending work is visible. An unresolved external send/compute attempt requires explicit reconciliation, not a guessed safe retry.
4. Through the owning versioned service, select SERVER + SELF_HOSTED_ONLY and a same-scope qualified pool. Preserve LINE transport ownership and webhook URL for already server-owned accounts.
5. Perform one explicitly authorized live LINE canary. Verify inbound → job → pool admission → selected node/profile → context/answer trace → LINE acceptance → CRM outbound record.
6. Verify B spillover with controlled load, A-down behavior, both-nodes-unavailable behavior and no external fallback. Expand traffic only after the receipts meet the gate.
7. Roll back by quiescing new pool dispatch, fencing/reconciling current attempts and restoring the prior approved execution binding. Never enable two LINE senders, delete Edge data or drop new tables in order to roll back.

A docs merge, image build, database migration and account activation are four different evidence events. The current user instruction authorizes preparing documents only.

#### Proposed failure outcomes

Invalid scope/policy/pool/profile: refuse configuration or dispatch with a bounded code. Capacity unavailable: visibly queued/deferred only within the job deadline, otherwise existing failure mapping. Reply deadline exhausted with Push disallowed: no late send. Credential/model/telemetry failure: do not silently switch to Edge, deterministic placeholder or cloud unless that separate behavior was already explicitly approved for this exact policy.

### Acceptance criteria

- LINE-01: Existing account/provider/Edge flows retain behavior until explicit per-account opt-in.
- LINE-02: An activated pool account completes a real Server-only canary with Edge stopped and exactly one authorized LINE send path.
- LINE-03: Account/job scope, pool/configuration snapshot and current policy are revalidated before dispatch and settlement.
- LINE-04: A 12 GB node under its calibrated capacity admits concurrent independent requests; subsequent new work spills to the 16 GB node under policy, not VRAM summation.
- LINE-05: Out-of-hours and deterministic authorized commands still bypass the model where expected.
- LINE-06: One slow generation does not block sending another ready answer past its deadline; tests cover the existing batch-worker interaction.
- LINE-07: Both nodes down, expired deadline, uncertain model result and uncertain LINE send produce distinct honest states with no hidden fallback or duplicate send.
- LINE-08: Rollback preserves CRM/job/trace evidence, installed Edge capabilities and all secrets; it does not change an existing Server webhook unnecessarily.
- LINE-09: New strict schema fields/enum values are backward-compatible or version-negotiated; older Edge consumers never receive an unsupported policy.

Authority: [[ZAI:ADR-061]], [[ZAI:DOMAIN-LINE-OA-STUDIO]], [[ZAI:FR-256-NOTE]], [[ZAI:RUNBOOK-SELF-HOSTED-INFERENCE-POOL]].

### Baseline source references

The following immutable repository sources were reviewed; proposed new behavior above is not a claim that it exists in this snapshot.

- [docs/domains/line-oa-studio/CHARTER.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/domains/line-oa-studio/CHARTER.md) — LINE job/transport ownership and existing ADR-061 amendment.
- [docs/decisions/ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/decisions/ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md) — Existing LINE ownership, optional Edge, durable queue and delivery semantics.
- [apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/line-oa-studio/application/line-conversation-jobs.js) — Durable claim/settle/send and bounded parallel Server worker.
- [apps/server/src/modules/line-oa-studio/domain/line-execution-budget.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/line-oa-studio/domain/line-execution-budget.js) — 5-second send reserve; compute lease does not extend reply lifetime.

### CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | candidate | Initial documentation proposal; no runtime implementation or activation | uncommitted; baseline cfd5521 | ChatGPT |
| 0.1.1b | 2026-09-18 | approved design | Record owner approval; design unchanged; canonical IDs, governance and runtime gates remain pending | uncommitted; baseline cfd5521 | ChatGPT |


---

<a id="doc-10"></a>

## Document 10 — Inference pool operations projection

Source: `drafts/docs/domains/platform-control/features/FR-258-inference-pool-operations-projection.md.template`

```yaml
id: "ZAI:FR-258-NOTE"
title: "Inference pool operations projection"
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
domain: platform-control
baseline_commit: "cfd5521e7d004e63ffead1e07f46045f1cdc06f2"
feature: "FR-258"
module: platform-control
source: pending
relations:
  - type: references
    target: "ZAI:FR-258"
  - type: relates_to
    target: "ZAI:FEAT-043"
  - type: relates_to
    target: "ZAI:ADR-099"
  - type: references
    target: "ZAI:FR-257"
```

## FR-258 — Inference pool operations projection

> Design approved by the owner on 2026-09-18; canonical integration and all runtime evidence remain pending.


### Behavior and ownership

Platform Control provides a removable, installation-operator-only operational projection of the inference pool. It reads Integration's redacted node/observation contracts and Agent's capacity/attempt summaries. It does not become the source of truth for connection state, secrets, capacity leases, LINE jobs or model selection.

The owning charter currently requires Identity's `isInstallationOperator` for `/control/**`; a Business owner or a role label alone grants no access. Preserve that guard. Business-facing pool selection remains in Integration and LINE OA Studio under their own scoped authorization.

The critical health collector and router are defined by [[ZAI:FR-257-NOTE]], not this removable dashboard. A dashboard outage cannot stop a healthy scheduler, and a healthy dashboard cannot override stale scheduler observations.

### Input, output and failures

#### Proposed surface

`/control/inference` under PlatformControlShell, plus a bounded operator read endpoint registered to this lane. Show operational aggregates only: opaque node code, expected/observed model profile, administrative state, readiness, observation age, running/waiting counts, reserved slots/tokens, KV ratio, bounded error category and calibration status. Do not include prompt/response text, raw LINE IDs, Business documents, keys, database connection strings or unredacted provider errors.

A management link must reauthorize through Integration; it does not inherit secret access from this projection. Drain/resume actions delegate to the owning audited service and require the appropriate capability. No host reboot, arbitrary shell command, GPU clock adjustment, remote model loading or restart endpoint exists in this requirement.

#### Truthful display rules

| Observed condition | Thai presentation intent |
|---|---|
| Eligible and calibrated | พร้อมรับงาน |
| Administrative drain | กำลังหยุดรับงานใหม่ |
| Running/waiting high or reservation cap reached | งานเต็ม / กำลังรอคิว |
| Last sample stale | ข้อมูลสถานะเก่า — ไม่ยืนยันว่าพร้อม |
| Credential refused | ตรวจสิทธิ์ไม่ผ่าน |
| Model/profile mismatch | โมเดลไม่ตรงกับที่กำหนด |
| Metric/exporter absent | ไม่มีข้อมูล — never show zero |
| Request outcome uncertain | ยังยืนยันผลการประมวลผลไม่ได้ |

Readiness, utilization and configured state remain separate fields. Show `observedAt/receivedAt`, units and provenance. Do not show nominal 12+16 GB as one 28 GB model device. Counters mean requests or reservations, not registered users or guaranteed concurrency.

#### History and alerting

Phase one persists the latest bounded observation and redacted state transitions using the existing audit/error conventions; it does not write every two-second sample as a new SQL history row. Optional Prometheus/Grafana can provide bounded time-series history later. vLLM exposes production metrics, and an official Prometheus/Grafana example exists; use a version-tested configuration rather than copying unpinned manifests. [V4] [V5]

Operational alerts, when enabled, use a configured recipient/channel and a deduplicated state transition: unavailable pool, repeated auth failure, sustained deadline misses, or stale observer. Repeated polling must not create alert storms. Recovery is a separate event. No automatic alert delivery or channel provisioning is performed by this document.

If no notification integration is configured, the console must say notifications are not configured; a red badge is not evidence a human was notified. Alert transport is not a dependency of routing correctness.

#### Optional hardware telemetry

Temperature, power, GPU utilization and device-memory counters require an independently configured hardware collector/exporter. They are not assumed to come from vLLM's inference metrics. Mark absent values unsupported/unavailable. The exporter has read-only host-metric access and no Zuri Business data, model prompts, LINE keys or tool-execution privileges. Hardware observations are diagnostics; operating-system shutdown/recovery remains operator tooling. NVIDIA documents the available `nvidia-smi` queries, which vary by GPU/driver. [V6]

### Acceptance criteria

- MON-01: Non-operators cannot read deployment-wide node/attempt data; Business roles do not substitute for `isInstallationOperator`.
- MON-02: Unknown/stale/unverified values are labeled explicitly with sample age, not zero/green.
- MON-03: The projection can be removed without deleting pools, stopping the observer/router, changing grants or losing LINE state.
- MON-04: Viewing or filtering the console performs no model request, tool call or LINE send.
- MON-05: Drain/resume uses owner services with fresh permission/version checks; the UI cannot bypass a revoked node/profile.
- MON-06: Alerts are deduplicated, bounded and truthfully report disabled/unconfigured delivery; no automatic restart is triggered by the display.
- MON-07: Hardware metrics remain unavailable unless a separately authorized exporter actually reports them.
- MON-08: Metrics/history retention and labels contain no conversation payload or secrets; high-cardinality request IDs belong in the existing controlled trace, not metric labels.

[V4]: https://docs.vllm.ai/en/stable/usage/metrics/
[V5]: https://docs.vllm.ai/en/stable/examples/observability/prometheus_grafana/
[V6]: https://docs.nvidia.com/deploy/nvidia-smi/index.html

### Baseline source references

The following immutable repository sources were reviewed; proposed new behavior above is not a claim that it exists in this snapshot.

- [docs/domains/platform-control/CHARTER.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/domains/platform-control/CHARTER.md) — Operator-only removable projections; no critical Business authority.
- [docs/domains/integration/CHARTER.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/domains/integration/CHARTER.md) — Provider/credential ownership, management surfaces, production-provider restrictions.

### CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | candidate | Initial documentation proposal; no runtime implementation or activation | uncommitted; baseline cfd5521 | ChatGPT |
| 0.1.1b | 2026-09-18 | approved design | Record owner approval; design unchanged; canonical IDs, governance and runtime gates remain pending | uncommitted; baseline cfd5521 | ChatGPT |


---

<a id="doc-11"></a>

## Document 11 — Domain-owned inference pool delivery phases

Source: `drafts/docs/roadmap/PLAN-FEAT-043-DOMAIN-PHASES.md.template`

```yaml
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
```

## FEAT-043 — Domain-owned inference pool delivery phases

> Design approved by the owner on 2026-09-18; canonical integration and all runtime evidence remain pending.

### Current identity and ownership

This candidate adds five new FR subjects under one proposed feature. Existing FR-149/150 remain in FEAT-019, and provider connection FRs remain in their existing bundle. They are dependencies, not reassigned members. New numeric IDs are intentionally unallocated in this draft package; bind them only against the current authoritative registries/ledger.

| Candidate requirement | Owning domain | Handoff |
|---|---|---|
| FR-255 | integration | Scoped nodes, secrets, qualification, pools and normalized observations |
| FR-256 | agent | Server orchestration and private model invocation with behavior parity |
| FR-257 | agent | Atomic capacity, preferred-first spillover, observation freshness and uncertainty |
| FR-258 | platform-control | Removable operator-only projection over owned read contracts |
| FR-259 | line-oa-studio | Explicit account policy, immutable job snapshot, delivery preservation and rollback |

### Runtime handoff map

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

### Delivery work packages and gates

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

#### Deferred explicitly

Public developer API keys/billing, cross-Business shared physical-engine pooling, arbitrary remote GPU enrollment, distributed model/VRAM pooling, live KV migration, server-side vision/document extraction, headless CLI migration, hardware auto-remediation and Kubernetes are not prerequisites or hidden deliverables.

### Evidence and release gates

Record test suite/fixture version, source commit, configuration hash, physical GPU/driver, pinned vLLM image and model/tokenizer/quantization revisions for each hardware proof. Record tested prompt/output-length distributions and actual concurrency; do not report hypothetical VRAM arithmetic as measured load capacity.

Software gate uses the current repository verification commands and scoped contract tests. Hardware and live LINE gates are independent: passing a stubbed provider test does not prove a GPU was called, and receiving a LINE HTTP acceptance does not prove the customer read the message.

### Document authority

[[ZAI:ADR-099]] owns the decision. Global registries own numeric FR/FEAT/SEC/SDD/NFR meanings. Domain notes own detailed behavior, [[ZAI:VERIFY-SELF-HOSTED-INFERENCE-POOL]] lists the proposed proof cases, and [[ZAI:RUNBOOK-SELF-HOSTED-INFERENCE-POOL]] governs operational handoff. Generated views and backlinks are not additional requirement sources.

### Baseline source references

The following immutable repository sources were reviewed; proposed new behavior above is not a claim that it exists in this snapshot.

- [AGENTS.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/AGENTS.md) — Documentation layers; immutable requirement IDs; source/derived separation; domain and process rules.
- [docs/FEATURES.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/FEATURES.md) — Feature versus FR distinction and existing bundles; not complete inventory.
- [docs/roadmap/PLAN-FEAT-019-DOMAIN-PHASES.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/roadmap/PLAN-FEAT-019-DOMAIN-PHASES.md) — Existing cross-domain phase plan precedent; phase metadata does not execute ordering.

### CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | candidate | Initial documentation proposal; no runtime implementation or activation | uncommitted; baseline cfd5521 | ChatGPT |
| 0.1.1b | 2026-09-18 | approved design | Record owner approval; design unchanged; canonical IDs, governance and runtime gates remain pending | uncommitted; baseline cfd5521 | ChatGPT |


---

<a id="doc-12"></a>

## Document 12 — Self-hosted inference pool qualification and recovery

Source: `drafts/docs/runbooks/SELF-HOSTED-INFERENCE-POOL.md.template`

```yaml
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
```

## Self-hosted inference pool — qualification, activation and recovery

> Design approved by the owner on 2026-09-18; canonical integration and all runtime evidence remain pending.

### Scope and prerequisites

This runbook is a candidate operational contract, not an installer and not authorization to change production. Two independent GPU computers run vLLM; Zuri Server must have permitted routed access to them. A Server already reachable through ngrok does not automatically gain a route to a private GPU host. Keep existing Docker/LINE overlay settings intact.

Keep the old Edge installation, keys and data untouched. The deployment never requires deleting a repository or extracting on-premise `.env` files. Never run Compose from an arbitrary worktree against the shared production project; use the repository's reviewed deployment procedure and a separate project/origin for a genuinely isolated test environment.

### 1. Record the baseline

Record source commit, current image digest, account execution/provider policy, current LINE transport owner, pending/claimed/ready/sending/uncertain jobs, migrations applied, backup receipt and rollback approver. Use redacted configuration references; do not paste secret values into the evidence packet.

For each node, record GPU model, VRAM reported by hardware, driver/runtime, OS, engine image/version, model/tokenizer revisions, quantization, context configuration, chat template/tool parser, inference origin/allowed ports and maximum enforced execution horizon. `12 GB`, `16 GB` and `9B` alone are not a deployment profile.

### 2. Establish private transport

Provision permitted LAN/VPN routes and endpoint identity. Use verified HTTPS or a policy-approved authenticated encrypted private tunnel. Restrict source access to the Zuri/observer identities; deny direct Internet and unrelated LAN clients. Keep debug/admin/media-download/weight-management routes inaccessible. A monitor exporter, if present, is read-only and separately gated.

No instruction here disables TLS verification, opens all interfaces publicly, forwards home-router ports, or permits arbitrary private IPs. Do not assume Docker loopback means the host GPU. Container-to-host service discovery/addressing must be tested for the chosen deployment network.

### 3. Install and qualify one replica

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

### 4. Calibrate A and B independently

Use synthetic workloads representative of LINE: short chat, longer authorized context, RAG evidence and tool rounds. Pin the same semantic model profile across both nodes; record actual distinct node budgets. Raise admitted concurrency gradually while recording full answer latency, deadline misses, engine queue depth, cache pressure, errors and physical memory.

No generic fixed threshold such as '100 MB per user' or '16 GB handles twice the users' is an acceptance result. KV/token costs vary by model, dtype, context and runtime. A latency percentile needs its workload window and sample count. No OOM does not by itself mean the response-time gate passes.

If another program shares the GPU, either remove it from the inference allocation during the test or record the contention and calibrate an enforced smaller budget. Independent external inference clients are not allowed in the first dedicated-engine deployment.

### 5. Prove Server behavior without sending LINE

Run Agent golden/contract tests through the new private provider using authorized synthetic fixtures, with LINE delivery disabled/stubbed. Check current deterministic commands, retrieval scope, memory receipts, tool validation, output bounds, policy refusal and late-result fencing. Required local-only Edge tools must either stay on Edge or be explicitly unavailable; they cannot disappear silently.

Test two actual Server processes competing for one remaining node slot. Test all nodes unavailable, stale observer data, wrong model, wrong key, engine restart during generation and a lost response after dispatch. No test may automatically call an external hosted model.

### 6. Apply additive state and activate one account

Migration application requires explicit operator authorization. Apply the reviewed SQLite/PostgreSQL/schema changes with correct production roles; record their identities and effects. Never use a destructive reset for rollout.

Drain current computation for the chosen account, reconcile uncertain work and bind the qualified pool through the owning versioned action. Preserve the existing Server LINE webhook and transport owner. New job policy/profile snapshots are immutable. Start the supervised observer and confirm its actual observations, not merely that the process was launched.

Run one owner-authorized canary and trace it end to end. Record selected node/profile, job/execution/attempt/context receipts, validated answer, LINE acceptance and CRM outbound reconciliation. Do not record delivery/read unless the provider actually supplied that evidence.

### 7. Failover, maintenance and recovery

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

### 8. Rollback

Stop new pool dispatch for the selected account, preserve signed ingress and durable evidence, reconcile or fence current attempts, and restore the prior authorized inference configuration. Keep exactly one LINE transport owner. A rollback does not delete reservations, traces, CRM rows or Edge files and does not blindly replay stale jobs.

If a migration cannot be safely reversed, keep additive columns/tables and roll forward with the old path disabled from new use. Record the actual rollback boundary and unresolved compute/delivery outcomes.

### Acceptance receipt checklist

Each activation packet records: approver and scope; source/artifact identities; migration and private-network receipts; per-node qualified profiles; credential negative-test results without values; calibrated capacity and workload evidence; multi-process reservation proof; Agent parity; monitoring freshness; live LINE canary; drain/failure/rollback results; explicitly unverified/deferred capabilities.

Blank or absent evidence means pending, not passed. This documentation package contains no production activation receipt.

### Baseline source references

The following immutable repository sources were reviewed; proposed new behavior above is not a claim that it exists in this snapshot.

- [docs/decisions/ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/docs/decisions/ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md) — Existing LINE ownership, optional Edge, durable queue and delivery semantics.
- [apps/server/src/modules/line-oa-studio/domain/line-execution-budget.js](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/apps/server/src/modules/line-oa-studio/domain/line-execution-budget.js) — 5-second send reserve; compute lease does not extend reply lifetime.
- [README.md](https://github.com/Freshair129/zuri.ai/blob/cfd5521e7d004e63ffead1e07f46045f1cdc06f2/README.md) — Monorepo app boundaries, deployment overlay, built-not-committed llms corpus.

### CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | candidate | Initial documentation proposal; no runtime implementation or activation | uncommitted; baseline cfd5521 | ChatGPT |
| 0.1.1b | 2026-09-18 | approved design | Record owner approval; design unchanged; canonical IDs, governance and runtime gates remain pending | uncommitted; baseline cfd5521 | ChatGPT |
