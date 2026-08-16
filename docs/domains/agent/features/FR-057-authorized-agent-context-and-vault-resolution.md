---
domain: agent
feature: FR-057
module: agent
source: v2-native
version: "0.2.0b"
created_at: "2026-08-15T00:00:00+07:00,ATHER"
last_update: "2026-08-15T10:00:00+07:00,ATHER"
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
- Every canonical MSP turn calls GoVibe API-010 `msp_vault_resolve` with the
  server-derived AuthContext and current authorization facts before API-009 memory
  retrieval or write.
- API-010's `workspacePrivateVaultId`, Global Private IDs, Shared IDs, and
  permissions are consumed as opaque MSP authority; Zuri never derives replacement
  vault IDs from `scopeKey` in canonical mode.
- Revoked identity or membership denies the next turn even when a prior session exists.
- Unauthorized vault IDs, raw channel handles, and arbitrary scope claims fail closed.
- Legacy principal-only MSP keys may be read only through an explicit compatibility
  adapter with an audit receipt; they are never silently merged.
- API-010 denial, malformed resolution, missing required project/workspace scope, or
  transport failure denies private retrieval/writes before any API-009 call.

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
8. The canonical adapter calls API-010 and uses only its returned Workspace Private
   vault ID for private API-009 memory operations.
9. API-010 Global/Shared IDs and permissions are retained as a resolved set and are
   never widened from client/model/thread input.

## Out of scope

- Changes to GoVibe/MSP canonical schemas or migrations; those remain owned by
  GoVibe/MSP and are consumed through API-010.
- GKS semantic promotion;
- proactive group replies or write actions;
- production LINE activation.

## Related decisions

`ADR-007 §P3/P6/P7`, `ADR-018`, `ADR-022`, `FR-021..029`, `FR-051..052`,
`PHASE-03-IDENTITY-PERMISSION`, and `PHASE-04-MSP-EPISODIC-MEMORY`.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.2.0b | 2026-08-15 | beta | Approved canonical API-010 MSP resolver integration boundary | working-tree | ATHER |
