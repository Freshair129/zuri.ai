---
status: active
superseded_by: null
version: "0.1.0"
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

Use [TESTING](TESTING.md). Model migrations, restricted DB roles, production
configuration and deployment remain separate reviewed operations.

Version diff 0.0 → 0.1.0: records the existing execution boundary and dependencies.
