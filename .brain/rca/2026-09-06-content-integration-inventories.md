---
version: "0.1.0b"
created_at: "2026-09-06T22:10:00+07:00,RWANG,1d132170"
last_update: "2026-09-06T22:10:00+07:00,RWANG"
status: beta
superseded_by: null
attributes:
  domain: marketing
  doc_type: rca
---

# Content integration inventory omissions

## Symptom

Integrated tests rejected the OpenAPI route inventory; governance rejected the
Production status list. Neither result reached a release or production database.

## Evidence

The initial integrated full run had 3,967 passing tests and one failure in
`tests/integration/openapi-docs.test.js`: the document listed 161 paths while the
enumerated route tree had 165. The four missing paths were Content collection,
brief detail, asset detail and reference choices. The first integrated governance
run reported one CRITICAL: ContentCollection copied WORK_STATUSES without PLANNED,
BLOCKED or CANCELLED. Logs are under ignored `test-results/marketing/`.

## Root cause

The new API handlers were registered in the human appendix but omitted from the
separate machine route inventory in `api-docs/openapi.js`. The Production UI
declared a local subset of PM statuses instead of importing the canonical enum.

## Why the issue escaped detection

The bounded service and UI tests exercised their own behavior but did not run the
cross-repository route parity and enum-copy gates. Full tests and governance
detected both before delivery.

## Proposed prevention and fix

Register all four real Content paths in the existing machine inventory; retain
the enumeration-based parity test. Import canonical PM WORK_STATUSES in the UI,
including blocked and cancelled work. Keep both full tests and governance as
delivery gates; do not expand baselines or weaken assertions.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | beta | Record integration failures, evidence and bounded correction | See git history | RWANG |
