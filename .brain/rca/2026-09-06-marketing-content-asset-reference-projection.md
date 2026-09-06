---
version: "0.1.0b"
created_at: "2026-09-06T00:00:00+07:00,Codex"
last_update: "2026-09-06T00:00:00+07:00,Codex"
status: "under review"
attributes:
  domain: "marketing-content"
  doc_type: "root-cause-analysis"
  scope: "Historic creative asset detail and lifecycle phase projection"
---

# RCA - Marketing content asset detail projected current references

## Symptom

Requesting a historic marketing content version through the asset-detail endpoint returns
the requested immutable version together with references resolved from the brief's current
version. A source file, rights proof, or production receipt can therefore appear to belong
to the historic version when it belongs to a later revision. The same DTO can report
`PRODUCTION` while a valid approval exists because the production check runs first.

## Evidence

- `getMarketingContentAsset` loads the requested revision but calls `toReferences`, which
  resolves `currentVersion(aggregate)` rather than the requested revision.
- The returned `brief` is intentionally a current brief projection, so its references are
  current by design; the asset-detail response has no separate requested-version references.
- `phaseForContent` checks `references.production.status === 'READY'` before approval and
  review, so a ready PM receipt masks a valid approval or matching review.
- Existing tests cover immutable revisions and source invalidation, but do not compare two
  revisions with different source files and rights or assert phase precedence when production
  is ready.

## Root Cause

The service conflated two projections: the current brief summary and the requested immutable
asset version. It also encoded phase precedence in infrastructure-read order rather than the
approved lifecycle order. Both defects are projection logic errors; persistence and source
metadata resolution already provide the version-bound inputs needed to fix them.

## Why the issue escaped detection

The initial integration tests used one shared file asset and asserted current brief approval,
so a current-version reference could satisfy the historic asset assertion without exposing
the mismatch. The phase tests exercised approval and review without a simultaneous ready PM
reference, leaving the ordering defect unobserved.

## Proposed prevention

1. Resolve requested-version references separately and expose them at the asset-detail
   response top level while keeping `brief.references` current.
2. Keep lifecycle precedence explicit and test it with ready production plus approved and
   review states.
3. Add a two-revision regression that changes both file and rights, then hides the old source
   and verifies the historic projection becomes unavailable without borrowing current data.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | under review | Recorded historic asset-reference projection and phase-ordering defects before fix | working-tree | Codex |
