---
status: active
superseded_by: null
version: "0.2.0"
---

# Core / Server boundary

[apps/server](../../../apps/server/package.json) contains the Next.js UI/public
routes, control plane, business modules and private service façades. Domain
[charters](../../DOMAIN-MAP.md) own business meaning and model writes. Service
extraction does not turn Server into an authority-free proxy.

Core retains authoritative identity, scope, consent and protected writers through
the applicable domain contracts. Conversation Runtime consumes Core ports under
[ADR-106](../../decisions/ADR-106-CONVERSATION-RUNTIME-SERVICE-EXTRACTION.md).
MI and SCM have their own boundaries; do not infer that all of their consumers or
production cohorts have cut over from the presence of a service package.

Independent Server installation uses its own lockfile and generated Prisma
clients. Server test fixtures must not share a mutable database or a dependency
installation with another worktree. SCM's generated kernel still has hand-edited
inputs in Server; changing those inputs reaches the SCM verification boundary.

## Knowledge pipeline execution

Knowledge owns the admission-to-serving capability outcome, as recorded in its
[charter](../../domains/knowledge/CHARTER.md). The user is sole product owner,
developer and operator; component roles are decision boundaries rather than
separate staffing requirements. External GKS retains canonical knowledge and
quality authority; MSP retains trust/relay and the native worker physical writes.

Server's `src/platform/integrations/core/genesisrag17-*` files execute source
dispatch, evidence import and receipt-required completion. Business admission,
scope, source lineage and corpus serving remain Knowledge responsibilities.
Process location is not a transfer of business ownership or GKS authority.

The shared `knowledge-runtime-loop.mjs` schedules source/admission process
passes. It exposes process-local status and bounded jittered infrastructure
backoff, contains diagnostic-observer failures and drains current work on stop.
Its retry budget selects cooldown scheduling; it does not create a new durable
attempt, fabricate success or abandon admitted work. Domain rejection and
job-specific retry classification remain in their existing owners. Restart
resets only process diagnostics; durable recovery reads the existing ledger.
See [operations](../../runbooks/GENESISRAG17-OPERATIONS.md).

Use [TESTING](TESTING.md). Model migrations, restricted DB roles, production
configuration and deployment remain separate reviewed operations.

Version diff 0.0 → 0.1.0: records the existing execution boundary and dependencies.

Version diff 0.1.0 → 0.2.0: adopts the approved Knowledge accountability and
solo staffing model; explains existing Core orchestration and bounded worker
lifecycle without changing wire/data authority.
