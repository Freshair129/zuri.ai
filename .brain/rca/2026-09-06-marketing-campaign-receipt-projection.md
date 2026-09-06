---
version: "0.1.0b"
created_at: "2026-09-06T20:12:00+07:00,RWANG,9b4eaa98"
last_update: "2026-09-06T20:12:00+07:00,RWANG"
status: beta
superseded_by: null
---

# Campaign receipt projection must use the authorized PM read port

## Symptom

Pre-integration source review found that Campaign list phase and detail receipt
choices could disagree with the selected execution projection. A receipt rejected
by the PM adapter could still appear in `plan.handoffs`, while a valid nullable-
Tenant Business Workspace could be omitted. This was identified before delivery;
no production exposure or server import is claimed.

## Evidence

The initial core commit `9b4eaa98` implemented `safeHandoffs` using a second
`validateHandoff` function. That validator checked selected row fields and target
scope but did not validate PlanImportReceipt or its PLAN_IMPORTED audit. The
detail projection filtered `plan.handoffs` with this weaker result and invoked the
PM adapter only for the selected execution. The collection did not invoke that
adapter. The duplicate validator also required exact Workspace.tenantId equality,
whereas both existing PM/handoff services allow a null value and resolve Tenant
through the owning Business.

The adapter in `49e56b82` already validates the immutable Marketing receipt,
normalized PM import hash, execution/audit provenance and target authorization.
Its nine real-service tests pass, including nullable-Tenant Workspace reads.

## Root cause

Parallel integration duplicated the receipt trust decision at two strengths.
The weaker prefilter was mistakenly treated as sufficient authority to expose
receipt fields and derive execution phase. Separately, an unavailable execution
helper reused the Results shape, violating the pinned nullable handoff/roadmap DTO.

## Why the issue escaped detection

The initial core commit preceded integration with the completed PM adapter and
its tests. Component-level availability handling did not exercise the whole
Campaign detail/list response with a damaged PM receipt.

## Proposed prevention

Use the actual authorized PM adapter for every exposed receipt candidate, cache
its result within one projection call, and derive list/detail phase and selection
from READY results only. Return the pinned execution unavailable shape. Remove
temporary missing-module fallbacks and unused public mutation aliases. Add
Campaign service regressions proving invalid PM receipts do not appear through
`plan.handoffs`, that list/detail agree, and that nullable-Tenant Workspaces work.
Final integrated evidence is recorded in the Campaign phase report.

## Resolution evidence

Commit `2b0c0bd7` removes the weaker validator and temporary adapter fallback,
reuses READY adapter results for exposed receipt choices and list/detail phase,
and returns the exact execution unavailable DTO. `9ecae329` adds service/route/
contract regressions, including damaged PM receipt filtering and archived-plan
binding refusal. The integrated full suite passed 3,930 tests (14 skipped).
