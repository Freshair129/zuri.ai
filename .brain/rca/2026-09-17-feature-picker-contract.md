---
id: ZAI:RCA-2026-09-17-FEATURE-PICKER-CONTRACT
title: Feature relationship forms accept unverified raw identifiers
version: "0.1.1b"
status: beta
created_at: "2026-09-17T18:56:44+07:00,RWANG,052821a7"
last_update: "2026-09-17T19:35:19+07:00,Luna Max"
superseded_by: null
attributes:
  domain: project-manager
  risk: MEDIUM
relations:
  - type: references
    target: ZAI:FR-252
  - type: references
    target: ZAI:PM-PHASE-B-FEATURE-IMPLEMENTATION-PLAN
---

# Feature relationship picker contract

## Symptom and evidence

The approved Phase B relationship editor contract (Plan 24 §7.3) requires a
canonical execution-Domain picker and an active WorkItem picker bound to the
current Project. The current `ProjectFeatureForms.jsx` still renders free-text
identifier inputs: `Primary Domain ID` at lines 677–679 and 721, supporting
`Domain ID` at line 749, `WorkItem ID` at line 782, and graph `WorkItem ID` at
line 846. These controls do not resolve the immutable Domain catalog, verify a
WorkItem's `workstream.projectId`, or protect a selection from a late response
belonging to a previous Project. The first picker implementation also cleared
its rows in an effect only; one render after a Project prop switch could still
expose the previous Project's options or selected label. Its native Domain
select also did not forward `required` or the form's explicit 422 ARIA props.

## Root cause

The relationship forms were authored before the approved picker boundary and
treated identifiers as user-entered strings. Server mutation validation cannot
provide the required selection guidance, same-Project filtering, or safe
handling of an imported unknown Domain during editing. React renders once
before `useEffect` runs, so effect-only clearing leaves old WorkItem state in
the immediate Project-switch frame even when the later response guards are
correct.

## Correction

Add a client-safe picker module beside the forms. `DomainPicker` derives
selectable labels only from `project-domain-catalog.js`, excludes the supplied
primary and duplicate IDs, and retains an existing unknown ID as a disabled
`UNMAPPED` display row. `WorkItemPicker` explicitly searches
`GET /api/work?projectId=...&q=...`, accepts only valid active rows whose
`workstream.projectId` equals the current Project, preserves a previously
validated selection while a search runs, and ignores responses from an older
Project context. The picker now tracks the applied Project identity and masks
rows, selected labels, status text and selection events until that identity
matches the current prop; generation/request guards still reject late
responses. Both native selects forward `required`, `aria-invalid` and a
deduplicated hint-plus-error `aria-describedby`. No global or fabricated
fallback is allowed. The forms remain the mutation owner and consume the
named picker exports in their own approved slice.

## Why it escaped detection

The first Phase B UI pass proved mutation transport and server refusal paths,
but the relationship controls remained raw inputs. Tests therefore exercised
typed server errors after submission without proving that a human selection was
canonical, same-Project, or safe across Project changes.

## Prevention and validation

Focused unit proof covers catalog filtering, unknown-ID preservation, WorkItem
same-Project and active-row normalization, duplicate rejection, bounded query
construction, render-time previous-Project masking, required/ARIA forwarding,
and the rendered labels/search action. The picker module imports no
server-only code and performs no mutation or scope inference; all final
authorization remains in the existing API and W4 mutation transaction.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | beta | Initial canonical Domain and scoped WorkItem picker RCA | `052821a7` | Luna Max |
| 0.1.1b | 2026-09-17 | beta | Added render-time Project identity masking and native required/ARIA forwarding | integrated picker source | Luna Max |
