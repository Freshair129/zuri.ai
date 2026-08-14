---
feature: FR-057
module: agent
source: v2-native
version: "0.1.0b"
created_at: "2026-08-15T00:00:00+07:00,ATHER"
last_update: "2026-08-15T00:00:00+07:00,ATHER"
status: "beta"
---

# FR-057 — Authorized agent context and vault resolution

## Requirement

For every LINE agent turn, Zuri MUST resolve the verified external identity and
current tenant/business membership before retrieval, derive an immutable policy
context, and pass MSP only the explicitly authorized vault set. The model, prompt,
thread label, session cache, and client payload MUST NOT widen that set.

## Rationale

FR-025 correctly stopped using a raw LINE user ID as memory ownership, but its
`tenant × principal` key is not sufficient for multi-agent, multi-workspace group
conversations. Issue #11 requires principal isolation without treating a thread as
one customer or allowing prompt injection to select another vault.

## Required behavior

- External identity is a lookup key, never a principal, agent, or vault ID.
- An unlinked or pending identity receives only the safe onboarding response and no
  private memory.
- Staff/customer classification and Membership scope are server-derived.
- A group thread keeps each participant's private context separate.
- `agentId`, `workspaceId`, and `projectId` are server-owned context, not user/model
  supplied authority.
- Revoked identity or membership denies the next turn even when a prior session exists.
- Unauthorized vault IDs, raw channel handles, and arbitrary scope claims fail closed.
- Legacy principal-only MSP keys may be read only through an explicit compatibility
  adapter with an audit receipt; they are never silently merged.

## Acceptance criteria

1. Same principal/agent/workspace recalls the same private vault.
2. Different principals in one LINE group receive different private vaults.
3. Different tenants, agents, workspaces, or unauthorized projects cannot recall one
   another's vaults.
4. Revoking the identity or Membership denies the next turn.
5. A stale session, prompt, model output, or client vault ID cannot restore access.
6. Restart or horizontal instance changes do not make `instanceId` the memory owner.
7. Context passed to the model is policy-filtered and carries a policy decision receipt,
   not raw authorization secrets.

## Out of scope

- MSP canonical vault schema changes before the GoVibe/MSP contract is consumed;
- GKS semantic promotion;
- proactive group replies or write actions;
- production LINE activation.

## Related decisions

`ADR-007 §P3/P6/P7`, `ADR-018`, `ADR-022`, `FR-021..029`, `FR-051..052`,
`PHASE-03-IDENTITY-PERMISSION`, and `PHASE-04-MSP-EPISODIC-MEMORY`.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-15 | beta | Owner-approved Issue #11 feature boundary | working-tree | ATHER |
