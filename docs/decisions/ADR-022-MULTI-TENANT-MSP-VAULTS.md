---
version: "0.3.0b"
created_at: "2026-08-15T00:00:00+07:00,ATHER"
last_update: "2026-10-04T09:44:57+07:00,Codex"
status: "beta"
superseded_by: null
attributes:
  domain: "identity-security-memory"
  doc_type: "architecture-decision"
  scope: "Issue #11 principal-scoped MSP vault resolution"
---

# ADR-022 — Multi-tenant principal-scoped MSP vaults

**Status:** Accepted for implementation; production MSP rollout remains gated

## Context

Issue #11 exposes a security gap in the original FR-025 shortcut. Zuri currently
derives one MSP vault from `tenant × principal`, while a LINE group can contain
multiple principals and one principal can use multiple agents, workspaces, or
projects. A `threadId`, model claim, or raw LINE subject must never become a vault
owner or authorization input.

The current `resolveLineIdentity()` and `assembleAgentContext()` seams also need to
separate transport authentication, business identity, authorization, and memory
retrieval. The model is an untrusted consumer of already-filtered context; it cannot
grant itself a vault or widen a scope.

## Decision

1. `zuri-cli` remains the LINE transport authority: signature verification,
   normalization, dedupe, and reply delivery.
2. Zuri resolves `ExternalIdentity → Person → Membership` and constructs an
   immutable per-turn `AuthContext`. Tenant and business scope come from the
   server-owned binding, never from client or model values.
3. The policy engine evaluates membership, tenant/business scope, thread audience,
   session assurance, capability, sensitivity, consent, retention, and policy
   version before any MSP retrieval.
4. On every private-memory turn, Zuri calls the GoVibe/MSP `msp_vault_resolve`
   API-010 contract with the server-derived AuthContext and current authorization
   facts. MSP returns the canonical authorized vault set and permissions. Zuri
   does not invent or accept arbitrary vault IDs from a request or model.
5. Zuri's private-memory adapter uses only the returned
   `workspacePrivateVaultId` for API-009 episodic reads/writes. The returned
   Global/Shared IDs remain part of the resolved set for dedicated readers and
   governed knowledge paths; they are never silently folded into private memory.
6. Private memory ownership is `Tenant × Principal × Agent × Workspace` (with an
   optional project dimension only when the approved MSP contract requires it).
   Thread, session, instance, and event are provenance/lifecycle dimensions, not
   private-memory owners.
7. Group threads retain participant identity. Private context is never merged across
   participants. A shared thread vault is allowed only when the policy engine grants
   it for the requested capability and sensitivity.
8. Authorization is recalculated on every turn. Cached sessions may carry an
   assurance/version receipt, but a stale session or model context cannot survive a
   membership or identity revocation.
9. Existing principal-only memory keys remain an explicitly enabled compatibility
   adapter only. Migration
   must be explicit, tenant-bound, agent-bound, auditable, and must fail closed when
   the MSP contract is unavailable. No silent cross-tenant or cross-agent merge is
   allowed.

## Per-turn contract

```text
verified transport event
  -> ExternalIdentity / Person
  -> Tenant / Business / Membership
  -> Thread participants / Session assurance
  -> effective policy decision
  -> authorized vault set
  -> MSP context resolution
  -> bounded model/tool context
  -> disclosure gate
  -> response
```

The API-010 request uses the canonical snake_case wire shape:

```text
{
  actor,
  access_context: {
    tenant_id, business_id?, principal_id, agent_id,
    instance_id?, project_id, workspace_id, thread_id?, session_id?, policy_version?
  },
  authorization: {
    membership_active, allowed, allow_global_private?,
    allow_tenant_global_private?, allow_shared?, read, write_private, write_shared
  }
}
```

An omitted resolver response, denied permission, missing required scope, or MSP
transport failure fails closed before any API-009 retrieval or write. Legacy
`scopeKey` resolution is available only through an explicit compatibility mode.

The `AuthContext` contains server-derived `transport`, `actor`, `scope`,
`conversation`, `request`, and `policy` fields. Raw `lineUserId`, inbound scope
claims, prompt text, and model output are never authorization authorities.

### Memory API boundary clarification — 2026-10-04

This API-010 → API-009 contract governs private episodic-memory reads and writes.
API-011 `msp_thread_*` calls serve the separate session/thread tier described by
[ADR-091](ADR-091-CHAT-RECORD-AND-AGENT-MEMORY-SPLIT-AND-THE-CONTEXT-COMPOSER.md).
An API-011 grant or session receipt does not authorize API-009 access, and an
API-010 vault set does not authorize API-011 session projection.

For API-009 episodic, passport or cross-thread memory, the per-turn policy must
allow access, the Customer's consent must be `GRANTED`, and the audience must be
`DIRECT`; otherwise private-memory retrieval is denied. A missing or untrusted
consent, policy or owner value fails closed. The session-tier path follows
ADR-091's separate policy, receipt and erasure gates.

This clarification does not enable either path. Production activation requires
the signed API-010 contract used by Zuri to be present on MSP main, the relevant
trusted policy/consent inputs and erasure evidence to be implemented and
verified, and a separately accepted rollout record.

## Supabase/RLS boundary

When these records are exposed through Supabase, every exposed table remains RLS
protected and policies must use persisted server authority. Authorization claims in
user-editable metadata are not valid policy input. RLS is defense in depth; the
application policy decision and MSP vault authorization still run before retrieval.

## Consequences

- Same LINE group, different principals: separate private vaults.
- Same principal, different agents: separate private vaults.
- Revocation is effective on the next turn, not after a model/session cache expires.
- The existing `Conversation.customerId` remains a legacy CRM association and is not
  promoted to group-thread ownership.
- Phase 4 must own thread/session/event persistence; Phase 5 cannot promote raw
  conversation text into canonical GKS memory without a separate policy decision.

## Rollback

Disable private MSP recall and writes, retain bounded current-turn context, preserve
policy/audit receipts and tombstones, and keep the existing transport and Phase 1
public-knowledge path production-disabled. The compatibility adapter may be used
only when explicitly enabled for a bounded migration or local test.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.3.0b | 2026-10-04 | accepted | Clarifies API-010 → API-009 episodic memory is distinct from API-011 session memory and records the consent, contract and activation gates | working-tree | Codex |
| 0.2.0b | 2026-08-15 | beta | Approved API-010 canonical vault resolution and explicit compatibility boundary | working-tree | ATHER |
