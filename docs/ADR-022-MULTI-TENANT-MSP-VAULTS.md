---
version: "0.1.0b"
created_at: "2026-08-15T00:00:00+07:00,ATHER"
last_update: "2026-08-15T00:00:00+07:00,ATHER"
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
4. MSP receives a structured context plus an explicit authorized vault set. The
   canonical vault identifier and registry remain MSP/GoVibe authority; Zuri does
   not invent or accept arbitrary vault IDs from a request or model.
5. Private memory ownership is `Tenant × Principal × Agent × Workspace` (with an
   optional project dimension only when the approved MSP contract requires it).
   Thread, session, instance, and event are provenance/lifecycle dimensions, not
   private-memory owners.
6. Group threads retain participant identity. Private context is never merged across
   participants. A shared thread vault is allowed only when the policy engine grants
   it for the requested capability and sensitivity.
7. Authorization is recalculated on every turn. Cached sessions may carry an
   assurance/version receipt, but a stale session or model context cannot survive a
   membership or identity revocation.
8. Existing principal-only memory keys remain a compatibility adapter only. Migration
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

The `AuthContext` contains server-derived `transport`, `actor`, `scope`,
`conversation`, `request`, and `policy` fields. Raw `lineUserId`, inbound scope
claims, prompt text, and model output are never authorization authorities.

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
public-knowledge path production-disabled until the compatibility adapter is reviewed.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-15 | beta | Owner-approved Issue #11 vault and authorization boundary | working-tree | ATHER |
