---
id: ZAI:FR-252-P4
title: Feature UI and final verification
parent_requirement: FR-252
phase_id: FR-252-P4
phase_order: 4
domain: project-manager
version: "0.1.0b"
status: beta
created_at: "2026-09-17T02:46:11+07:00,RWANG,approved e5ccfd7a"
last_update: "2026-09-17T02:46:11+07:00,RWANG"
relations:
  - type: references
    target: ZAI:FR-252
  - type: references
    target: ZAI:ADR-097
  - type: references
    target: ZAI:PM-PHASE-B-FEATURE-IMPLEMENTATION-PLAN
---

# FR-252-P4 — Feature UI and final verification

## Entry condition and predecessor

W3 read/UI work may run in parallel on frozen DTOs after P1; W5 create/edit/binding forms require P3 writers and P2 CSRF. Preserve one writer for navigation and shared contracts. W6 consumes immutable implementation packets.

## Input

Approved plan24 wireframes/state matrix, FR-250 navigation, FR-251 Domain view and Feature API fixtures. Reuse the authorized Project shell; keep Business planned disclosures and all seven Work views.

## Output and next handoff

One Features entry under Project Delivery Design, accessible list/detail drawer, authorized create/edit/binding forms, lifecycle/restore and allocation explanations with honest unavailable states. Independent Luna Max verification precedes root W7 composition, governance, tests, build and browser checks.

## Failure, retry and acceptance

Prove loading/empty/error/stale Project transitions, redacted refusal, optimistic conflict handling, successful receipt then re-read, keyboard/focus/Back behavior and 390px layout. Existing Inventory/Team/Import/navigation/progress regressions remain gates. Report local, hosted CI and production separately; actual RLS/grant/isolation evidence and separately authorized release are required before production writes.

Current state: PLANNED_NOT_RUN. This registered slice does not claim implementation.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | beta | Register slice of the approved Phase B design; no new behavior | e5ccfd7a | RWANG |
