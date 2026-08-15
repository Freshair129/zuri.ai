---
title: "Phase 4: MSP Episodic Memory"
doc_id: "PLAN-LINE-OA-PHASE-04"
status: "candidate"
version: "0.1.0b"
created_at: "2026-08-14T02:12:07+07:00,ATHER"
last_update: "2026-08-14T02:12:07+07:00,ATHER"
owner: "Boss (บอส)"
attributes:
  domain: "agent-memory"
  doc_type: "phase-plan"
  scope: "principal thread session transcript and episodic memory"
---

# Phase 4: MSP Episodic Memory

## Objective

Give the agent scoped conversational continuity through MSP-owned thread, session, event,
transcript, summary, and episodic-memory records without promoting raw conversations into GKS.

## Dependencies

- Phase 3 identity and permission accepted;
- retention/consent/erasure rules approved;
- MSP persistence and AuthContext contracts approved.

## Ownership

- Zuri Identity owns principal/customer/membership identity.
- MSP owns thread/session/event/episode/context/provenance/retention state.
- A thread is not a customer: one group thread may have many participants and sessions.
- Raw transcript stays in MSP storage. Stable semantic facts require a later governed promotion.

## In scope

- `ChannelThread`, `ThreadParticipant`, `ConversationEvent`, `Session`, `Episode`, summary,
  context-resolution receipt, retention and tombstone records;
- principal-keyed and thread-scoped retrieval;
- append-only ingest, idempotency, replay, bounded summarization, and context budget;
- `MspPersistencePort` with SQLite local adapter and Postgres/Supabase-compatible cloud adapter;
- export/erase/retention enforcement and audit linkage.

## Out of scope

- semantic entity/relation authority;
- GenesisBlockDB persistence;
- proactive group replies or write actions;
- OmiChat UI.

## Issue #11 amendment

MSP retrieval consumes the structured AuthContext and explicit authorized vault set
from Phase 3. A group thread is a shared lifecycle container with many participants;
it is never the owner of a private vault. Private ownership is scoped by tenant,
principal, agent and workspace, with project scope only when the approved MSP contract
requires it. Session and instance identifiers are provenance only. The existing
principal-only adapter is compatibility mode and cannot silently merge tenants,
principals or agents. See `ADR-022` and `FR-057`.

## Acceptance criteria

- events cannot cross tenant/business/thread authorization boundaries;
- restart does not lose committed events or duplicate episodes;
- context resolution is bounded, provenance-linked, and policy-filtered;
- erase/revoke/retention invalidates future retrieval;
- storage adapter replacement passes the same conformance suite;
- MSP schema/migrations cannot affect Zuri CRM database ownership.

## Success and exit criteria

- multi-turn DM recall works across restart with correct principal identity;
- group-thread fixture preserves multiple participants without choosing one customer owner;
- retention/erasure/security/replay tests pass;
- Phase 5 semantic promotion candidates are defined but not written;
- Phase 5 remains unauthorized until a new ADR is approved.

## Rollback

Disable persistent recall, fall back to bounded current-turn context, stop summarization/promotion
candidate generation, and retain auditable tombstones according to policy.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | candidate | MSP episodic-memory ownership and gates | working-tree | ATHER |
| 0.2.0b | 2026-08-15 | beta | Issue #11 amendment: explicit authorized vault set and group participant isolation | working-tree | ATHER |
