---
domain: agent
module: src/modules/agent
owns_models: []
owns_routes:
  - src/app/api/agent/**
---

# Domain charter — agent

The LINE/AI runtime: the webhook seam, per-turn AuthContext, binding-only scope
resolution (FR-052), MSP vault access, model transport (OpenRouter), activation
gates, canary and golden evaluation. The agent is an orchestration layer — per
the architecture spec §21 it consumes other domains' capabilities and is never
a database superuser.

## Boundaries

- **Owns no Prisma models by design.** Its durable state lives in the
  production Postgres runtime (`zuri_core.line_channel_binding`,
  `line_activation_event`, MSP vaults) behind the binding resolver and vault
  ports — deliberately outside the shared Prisma schema.
- Production scope comes only from a server-owned binding; client-supplied
  tenantId/businessId is rejected before any turn work (FR-052, SEC-010).
- Never executes anything arriving in a plan/envelope — plans are data
  (BR-007, SEC-002).
- Replies flow back to the sole LINE transport owner (zuri-cli, BR-011); this
  domain never consumes a replyToken itself (FR-050).
- MSP is episodic memory, GKS is canonical knowledge, ERP state is operational
  truth — never confused (spec §17–19); conversation content never becomes
  canonical knowledge without governance.

## Public contract

- `POST /api/agent/line-webhook` — the one inbound seam (FR-028).
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
