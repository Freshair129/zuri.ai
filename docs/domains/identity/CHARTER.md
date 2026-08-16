---
domain: identity
module: src/modules/identity
owns_models:
  - ExternalIdentity
  - IdentityLinkToken
  - ExternalRef
---

# Domain charter — identity

Who a principal is and what they may see: external identity resolution
(lineUserId → Person), link tokens, principal classification
(CUSTOMER / MEMBER / OWNER), the viewer gate, and PDPA erasure.

## Boundaries

- External ids are never primary keys — internal UUID + human `code` +
  ExternalRef mapping (BR-002). This domain owns that mapping discipline for
  everyone.
- Erasure (FR-022) revokes identities and redacts the global Person; it is the
  only flow allowed to do so.
- Does not run agent turns and does not ingest messages — it answers "who is
  this and what are they allowed to see", nothing else.

## Public contract

- `resolveLineIdentity` — the one resolver; no other site may resolve a
  lineUserId on its own (see the identity impact scan, archived).
- `classifyPrincipal`, the viewer gate, `erasePrincipal`.

## Known shared-write exceptions (debt, visible on purpose)

- Writes `Person` (owned by crm) during linking and erasure — recorded in both
  charters; target state is a crm contract call.
