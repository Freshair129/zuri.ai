---
version: "0.2.0b"
created_at: "2026-09-06T22:10:00+07:00,RWANG,1d132170"
last_update: "2026-09-06T22:22:00+07:00,RWANG"
status: beta
superseded_by: null
attributes:
  domain: marketing
  doc_type: rca
---

# Content integration gaps

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

## UI contract and keyboard findings

Source review found DecisionForm sending null reviewId/expiresAt for REJECT or
REVOKE even though the strict server schema accepts omitted optional strings.
The corrected decision serializer emits those two fields only for APPROVE;
unit proof and the browser approval/revocation flow cover the boundary.

The browser mobile keyboard case reached Library but lost focus. ContentPage
keyed its collection by both Business and tab. MarketingTabs focused the next
link before navigation, then the new key destroyed that focused node. Keying by
Business only preserves the tab DOM during navigation and still resets state
when Business changes. Keep the keyboard focus assertion; do not replace it with
an URL-only check.

Production rendered multiple brief references to the same PM task with the same
React key. Each projected row needs both brief and task identity. The search
field also appeared on Production/Library without those views consuming its
value; expose it only on Briefs, where filtering is implemented. These are
bounded UI corrections, without adding PM mutations or new filter capabilities.

These issues escaped local source-string UI tests because those tests could not
exercise form submission, browser focus or reconciliation. Browser coverage now
uses real source/rights/PM choices, revision/history, independent human review,
approval, Library navigation and revocation, with mobile and keyboard checks.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | beta | Record integration failures, evidence and bounded correction | See git history | RWANG |
| 0.2.0b | 2026-09-06 | beta | Document decision payload, keyboard identity and projection UI causes | See git history | RWANG |
