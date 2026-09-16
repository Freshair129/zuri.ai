---
version: "0.1.0b"
created_at: "2026-09-16T03:23:25+07:00,RWANG,source 0f5a47fc"
last_update: "2026-09-16T03:23:25+07:00,RWANG"
status: candidate
superseded_by: null
attributes:
  domain: project-manager
  doc_type: root-cause-analysis
---

# Assigned-item count does not establish active workload or capacity

## Symptom

The owner requires assigned work to support person/team staffing, scheduling and performance. The existing field name `activeWorkItems` can be read as open workload, while the source query counts all nondeleted assigned items.

## Evidence

At source `0f5a47fcf2b8b4e846edbc67f2a051c6673e4b83`, `apps/server/src/modules/project-manager/application/project-team-service.js` lines 84–86 calls `workItem.count` with `deletedAt: null`, `assigneeRef` and `workstream.projectId`; it has no status predicate. The inspected WorkItem schema has dates and progress weight but no typed capacity calendar or effort history. `project-team-service.test.js` covers scope and Membership operations, not active-count or staffing formulas. This is a bounded source inspection, not evidence that every other test lacks related coverage.

## Root Cause

An assigned-row inventory count was named as active work and is exposed without a status/cohort definition. A count alone also carries no effort, working availability or accepted-delivery evidence from which capacity and performance can be calculated.

## Why the issue escaped detection

The inspected service test checks authorization/membership behavior. The earlier design review verified the tab and route existed but had not traced the count predicate into an explicit workload contract. Those checks cannot establish staffing semantics.

## Proposed prevention

PMR-033 defines open/WIP/accepted status mapping, effort/calendar completeness, assignment history, evidence-based metrics and acceptance case C. Preserve the old field contract until an approved amendment; add a clearly typed workforce projection instead of relabeling the count as capacity. Documentation only; no bug fix or runtime validation claimed.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-16 | candidate | Record count-query limitation and prevention in workforce requirement | source 0f5a47fc; uncommitted | RWANG |
