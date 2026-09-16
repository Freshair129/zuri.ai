---
id: ZAI:FR-253-NOTE
title: Knowledge base console
feature: FR-253
domain: knowledge
module: knowledge
source: v2-native
version: "0.1.1b"
status: approved
created_at: "2026-09-17T04:00:00+07:00,RWANG,base 099ebc8f"
last_update: "2026-09-17T05:10:00+07:00,RWANG"
relations:
  - type: references
    target: ZAI:FR-253
  - type: relates_to
    target: ZAI:FEAT-013
  - type: references
    target: ZAI:TASK-ZAI-047-CONSOLE-PLAN
---

# FR-253 — Knowledge base console

Boss approved the [TASK-ZAI-047 specification](../../../plans/TASK-ZAI-047-KNOWLEDGE-CONSOLE.md) on 2026-09-17. Implementation and evidence follow that specification; production activation is separate.

## Behavior and ownership

The knowledge lane provides `/knowledge/console`: source/version library, FR-071 run evidence, corpus generations and generation-bound cited search. Existing admission and corpus services remain the mutation/query authorities. A Files inventory is not a knowledge-source registry, and the architecture map is not telemetry. No GKS contract change or second source store is needed for zuri-admitted sources.

## Input, output and failures

Lists use Business/Project scope, bounded cursor pagination and allowlisted DTOs. Every source reference is checked against current authority before disclosure. Citation evidence resolves the exact immutable chunk/parsed/raw identity, with no fallback to current file bytes. Empty, error and runtime-unavailable states are distinct.

## Acceptance criteria

The full [acceptance and verification plan](../../../plans/TASK-ZAI-047-KNOWLEDGE-CONSOLE.md#6-acceptance-implementation-order-and-verification) applies, including more-than-100-row pagination, revoked/deleted/forbidden sources, scope changes during reads, and real isolated browser admission through native publication to all three citation evidence layers.

## CHANGELOG

Local implementation, native publication receipts and verification outcomes are recorded in the [phase report](../../../../.brain/reports/2026-09-17-task-zai-047-knowledge-console.md). Production deployment and runtime activation are not part of these local results.

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.1b | 2026-09-17 | approved | Link isolated implementation and native acceptance evidence; scope unchanged | uncommitted | RWANG |
| 0.1.0b | 2026-09-17 | approved | Declare the approved TASK-ZAI-047 console under FEAT-013 | uncommitted | RWANG |
