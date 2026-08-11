# Contract Tests — freezing V1's endpoint behaviour before reimplementing it

| Field | Value |
|-------|-------|
| **Version** | 0.1.0 |
| **Status** | Skeleton — to be filled by `TASK-V2-CONTRACTS` |
| **Last Updated** | 2026-08-12 |

## Why this is mandatory, not optional

ADR-003 keeps V1's endpoint contracts and swaps the internals underneath, so the
lifted UI keeps working (192 `fetch('/api…')` call sites). **Both repos are plain
JavaScript** — no compiler enforces that contract. Without recorded fixtures, a
response-shape change surfaces as a broken page in a live shop, and nobody can tell
whether the fault is in the lifted UI or the new backend.

Rule (ADR-003 §D6): **record the fixtures before touching any internals.**

## Method

For each endpoint a lifted page depends on:

1. Capture real request/response pairs from V1 (representative + edge cases:
   empty list, missing optional fields, error shape).
2. Store as fixtures keyed by endpoint + case.
3. Run the same requests against V2's reimplementation; diff the response shape
   (keys, types, nullability, ordering where the UI relies on it).
4. Differences are either fixed or explicitly accepted with a note in the table
   below — never discovered later in production.

## Coverage table

| Endpoint | Used by (pages) | Fixtures | V2 status | Accepted differences |
|---|---|---|---|---|
| _(to be filled by TASK-V2-CONTRACTS, per module at cutover time)_ | | | | |

Priority follows the cutover order in `CUTOVER-RUNBOOK.md`: endpoints for the module
being cut over next are recorded first. Endpoints belonging to "drop" modules in
`PARITY-INVENTORY.md` are never recorded — they retire with V1.
