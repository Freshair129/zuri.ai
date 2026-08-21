---
domain: agent
version: "0.1.0b"
status: "candidate"
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

## Design docs in this domain

The former `docs/ai-system/` set lives here: intent pipeline, prompt registry,
PDPA/ethics governance, model lifecycle.
