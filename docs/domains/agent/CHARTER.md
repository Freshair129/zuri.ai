---
version: "0.2.0b"
status: active
last_update: "2026-09-07T23:18:03+07:00,RWANG"
id: ZAI:DOMAIN-AGENT
relations:
  - type: relates_to
    target: ZAI:ADR-061
  - type: relates_to
    target: ZAI:ADR-070
  - type: relates_to
    target: ZAI:PLAN-FEAT-019-PHASES
  - type: relates_to
    target: ZAI:FR-149-P3
  - type: relates_to
    target: ZAI:FR-150-P2
  - type: relates_to
    target: ZAI:FR-171-NOTE
domain: agent
module: src/modules/agent
owns_models:
  - AgentTraceEvent
owns_routes:
  - src/app/api/agent/**
---

# Domain charter — agent

ADR-061 adds a server-answer adapter for the server-owned LINE job worker (FR-149); direct native ingress and job state are owned by line-oa-studio / Integration. BR-011 forwarding remains explicit legacy only; server-enabled accounts reject it. No Edge or binding bearer is required to compute a server answer.

The LINE/AI runtime: the webhook seam, per-turn AuthContext, binding-only scope
resolution (FR-052), MSP vault access, model transport (OpenRouter), activation
gates, canary and golden evaluation. The agent is an orchestration layer — per
the architecture spec §21 it consumes other domains' capabilities and is never
a database superuser. Under ADR-070 and FR-171 it also owns the one local,
scoped `AgentTraceEvent` journal for execution evidence and read-only playback.

## Boundaries

- **Owns one Prisma model for execution evidence.** `AgentTraceEvent` is the
  one local, scoped, append-only journal under ADR-070/FR-171. It stores
  execution references, exact retained input snapshots, hashes, usage and
  receipt evidence; it does not become authority for CRM, LINE delivery, MSP,
  GKS or Edge state. The agent still does not own the production Postgres
  runtime (`zuri_core.line_channel_binding`, `line_activation_event`) or MSP
  vaults; those remain behind binding and vault ports.
- Native SERVER has no private-memory adapter in FR-171 v0.3. Its trace uses
  empty memory refs plus `EXCLUDED_BY_POLICY` and never fabricates MSP session
  or memory-version ids.
- Production scope comes only from a server-owned binding; client-supplied
  tenantId/businessId is rejected before any turn work (FR-052, SEC-010).
- Never executes anything arriving in a plan/envelope — plans are data
  (BR-007, SEC-002).
- Legacy replies flow back to zuri-cli under BR-011/FR-050. Server-enabled
  conversations return bounded text to the Studio worker, which invokes the
  Integration-owned LINE port under ADR-061; Agent never owns sending.
- MSP is episodic memory, GKS is canonical knowledge, ERP state is operational
  truth — never confused (spec §17–19); conversation content never becomes
  canonical knowledge without governance.

## Public contract

- `POST /api/agent/line-webhook` — this lane's inbound seam (FR-028). It is no longer
  the product's only LINE inbound seam: a `serverEnabled` account is refused here and
  enters through the Studio's native `POST /api/line-oa/accounts/[id]/webhook`
  (FR-149, ADR-061), which never calls `handleAgentTurn`.
- `handleAgentTurn` — one end-to-end turn; identity resolution and policy
  checks happen before any memory-port call (FR-057).
- `GET`/`POST`/`DELETE /api/agent/heartbeat` — the Business-scoped Edge Device
  liveness view (FR-141, ADR-041 D3): trusted viewer on every method, registry
  keyed by the viewer's owned Business, process-local per instance by decision,
  registration/transition/removal audited. It is a cache of a device's last
  heartbeat, not a pairing record — durable pairing is undeclared.
- `createPostgresLineBindingStatusReader` / `createLineBindingStatusReaderFromEnv`
  / `readLineBindingStatusLabel` (`line-binding-status.js`, FR-147) — the
  read-only view of `zuri_core.line_channel_binding` other lanes may consume:
  Tenant/Business/code-scoped, state columns only, through the same read role
  and RLS path as the turn. It answers ACTIVE / NOT_ACTIVE / NO_BINDING /
  UNKNOWN and nothing finer, and mutates nothing — activation stays the
  operator path of ADR-020. First consumer: the LINE OA Studio account's
  `effectiveStatus` (FR-146, ADR-060 D3).

## Design docs in this domain

The former `docs/ai-system/` set lives here: intent pipeline, prompt registry,
PDPA/ethics governance, model lifecycle.

## FEAT-019 execution handoffs

See [the domain phase map](../../roadmap/PLAN-FEAT-019-DOMAIN-PHASES.md) and [[ZAI:ADR-061]]. Phase ownership does not change this charter's model/route manifest. Server transport is independent of Edge execution; BR-011/FR-050 describe retained legacy forwarding only.

## FR-171 execution trace handoff

See [the Execution Trace & Replay contract](features/FR-171-execution-trace-and-replay.md),
[the native SERVER checklist](features/PHASE-FR-171-P1-native-server-line-journal.md)
and [[ZAI:ADR-070]]. The initial lane is the native SERVER LINE journal and the
owner-only read-only playback route. MSP Soul sessions and runtime assembly,
GKS retrieval and the optional Edge adapter remain external phase gates; this
charter does not authorize direct writes to their repositories or databases.

## CHANGELOG

| Version | Date | Summary | Agent |
|---|---|---|---|
| 0.1.0b | 2026-09-06 | Added document metadata and FEAT-019 handoff navigation; existing domain manifest retained | RWANG |
| 0.2.0b | 2026-09-07 | ADR-070/FR-171 approved the single AgentTraceEvent journal and read-only playback boundary; the agent now owns that one local model while MSP, GKS and Edge remain external authorities | RWANG |
