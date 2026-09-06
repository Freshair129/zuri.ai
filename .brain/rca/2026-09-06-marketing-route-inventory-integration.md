---
version: "0.1.0b"
created_at: "2026-09-06T19:10:00+07:00,RWANG,5316827d"
last_update: "2026-09-06T19:10:00+07:00,RWANG"
status: beta
attributes:
  domain: marketing
  doc_type: root-cause-analysis
---

# RCA — Marketing route inventory integration

## Symptom

The integrated Marketing slice compiled, but full tests rejected the domain list,
command-palette route expectations and browser warm-up coverage. Governance also
rejected Appendix A's old handler count before the full test run.

## Evidence

`test-results/marketing/integrated-test.log` records three failures: the explicit
domain expectation omitted `marketing`; the palette expected `/growth` to stay
reserved; warm-up omitted `/growth/strategy`. The new routes are two page handlers
and three API handlers. `integrated-govern.log` initially reported declared 153
versus actual 156 API handlers. OpenAPI route enumeration additionally requires
five new operations across those three API paths.

## Root Cause

Parallel lanes delivered their own implementation and targeted tests, while
shared inventories still encoded the prior reserved Growth slot. Regenerating
the graph updates derived projections but cannot update explicit test expectations,
the browser warm-up list or the hand-maintained OpenAPI inventory.

## Why the issue escaped detection

Lane tests did not exercise every shared registry. The full root verification
gate caught the omissions before delivery; a successful lane build was not
treated as integrated acceptance.

## Proposed prevention

For domain activation, reconcile page/API enumeration, palette visibility and
denial, warm-up, explicit domain expectations and Appendix A together. Preserve
the enumeration assertions. Run governance and the complete tests after the
merge. The corrected inventory tests passed 26 tests across four files.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | beta | Record integrated inventory failures and corrective checks | See git history | RWANG |
