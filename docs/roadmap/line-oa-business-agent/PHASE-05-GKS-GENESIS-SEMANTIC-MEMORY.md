---
title: "Phase 5: GKS and GenesisBlockDB Semantic Memory"
doc_id: "PLAN-LINE-OA-PHASE-05"
status: "candidate"
version: "0.1.0b"
created_at: "2026-08-14T02:12:07+07:00,ATHER"
last_update: "2026-08-14T02:12:07+07:00,ATHER"
owner: "Boss (บอส)"
attributes:
  domain: "knowledge-memory"
  doc_type: "phase-plan"
  scope: "GKS canonical knowledge persisted and indexed by GenesisBlockDB"
---

# Phase 5: GKS and GenesisBlockDB Semantic Memory

## Objective

Promote reviewed stable knowledge from operational data and MSP episodes into GKS canonical
entities/relations, persisted and indexed by GenesisBlockDB for graph/vector/temporal retrieval.

## Required ADR before implementation

This phase changes the previously approved persistence topology. The ADR must supersede the
GKS-owned SQLite production decision and reconcile the direct MSP-to-Genesis promotion tool.

Target topology:

```text
MSP -> GKS service -> GksPersistencePort -> GenesisBlockDB
```

GKS alone mints `gks:` canonical identities. GenesisBlockDB persists/indexes canonical IDs supplied
by GKS. Its WAL remains engine authority; its internal SQLite is a projection and is never opened
directly by MSP, GKS consumers, Supabase, or Zuri domain code.

## Dependencies

- Phase 4 accepted;
- cross-repository ADR approved in MSP, GKS, GenesisBlockDB, and Zuri authority docs;
- `GksPersistencePort` conformance and migration/rollback plan approved.

## In scope

- semantic candidate review/promotion with provenance, scope, confidence, temporal validity, and
  idempotency;
- GKS canonical entity/relation IDs, deduplication, mappings, and graph version;
- GenesisBlockDB adapter covering WAL, graph, vector, embedding, HNSW, and indexed retrieval;
- tenant/business authorization evidence from MSP;
- retract/tombstone/valid-until behavior;
- parity, performance, backup, restore, and adapter conformance tests.

## Out of scope

- moving operational CRM facts into GKS when they should remain live Zuri/Supabase queries;
- direct Supabase-to-Genesis dual writes;
- direct MSP-to-Genesis canonical promotion;
- using `pgvector` as a GenesisBlockDB replacement;
- group proactive behavior or actions.

## Acceptance criteria

- exactly one canonical writer mints `gks:` IDs;
- GKS scope rules deny cross-tenant access without explicit MSP evidence;
- promotion is atomic/idempotent and hash conflicts fail closed;
- graph/vector results retain canonical refs, provenance, validity, and graph version;
- Genesis restart/restore preserves or rebuilds required indexes from durable authority;
- SQLite and Genesis are never simultaneous canonical production writers.

## Success and exit criteria

- conformance suite passes against test and Genesis adapters;
- retrieval evaluation covers semantic, entity, relation, and temporal queries;
- migration/rollback rehearsal passes without losing canonical mappings;
- security and architecture review approve the single-authority topology;
- Phase 6 remains unauthorized until separately approved.

## Rollback

Stop promotion, keep MSP episodes and candidate receipts, restore the last approved GKS adapter,
and do not reassign canonical IDs during rollback.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | candidate | GKS canonical authority with Genesis persistence proposal | working-tree | ATHER |
