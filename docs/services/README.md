---
status: active
superseded_by: null
version: "0.1.0"
---

# Service documentation

Start with the domain CHARTER for business ownership, then the service document
for execution and test scope. Canonical FR/FEAT records keep their existing homes.
This index does not declare a model moved or a deployment complete.

| Project | Boundary | Verification |
|---|---|---|
| Core / Server | [SERVICE](server/SERVICE.md) | [TESTING](server/TESTING.md) |
| Conversation Runtime | [SERVICE](conversation-runtime/SERVICE.md) | [TESTING](conversation-runtime/TESTING.md) |
| Market Intelligence | [SERVICE](market-intelligence/SERVICE.md) | [TESTING](market-intelligence/TESTING.md) |
| SCM | [SERVICE](scm/SERVICE.md) | [TESTING](scm/TESTING.md) |

[Verification policy](../architecture/VERIFICATION-POLICY.md) governs the pilot.
[Service map](../architecture/SERVICE-MAP.md) is generated from the current
selector's project list, package scripts and pilot metadata; regenerate it with
`npm run docs:services`. No speculative service or empty runbook is created.

Version diff 0.0 → 0.1.0: adds service navigation over existing domain and contract
authority. File Management branch work and external MSP/GKS remain outside this
three-service main baseline; onboarding requires real jobs and consumer evidence.
