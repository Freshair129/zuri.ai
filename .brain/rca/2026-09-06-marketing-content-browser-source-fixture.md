---
version: "0.1.0b"
created_at: "2026-09-06T22:58:00+07:00,RWANG,fe0558ec"
last_update: "2026-09-06T22:58:00+07:00,RWANG"
status: beta
attributes:
  domain: marketing
  doc_type: rca
---

# Content browser fixture selected an unfingerprinted file

## Symptom

Full browser regression passed 107 tests but failed both Content tests on POST
creation (marketing-content.spec.js lines 102 and 255). Focused Content had passed.

## Evidence

Read-only inspection of the isolated e2e-3148.db found exactly three FileAsset rows,
all prior FR-058 EXTERNAL_URL fixtures with ACTIVE status, version 1 and null SHA-256.
The Content helper selected the first ACTIVE row without checking the fingerprint.
Content service lines 155–158 correctly reject an asset without a valid fingerprint.

## Root Cause

The test helper confused file lifecycle state with Content source eligibility. The
contract requires ACTIVE state, a positive version and a valid 64-hex SHA-256 hash.

## Why the issue escaped detection

On a clean focused run the helper creates a fingerprinted file. In the full suite,
earlier Files tests supply ACTIVE external references with no fingerprint, causing
the helper to reuse an ineligible asset instead of exercising the creation flow.

## Proposed prevention

Require the existing Content eligibility fields when reusing a fixture; otherwise
create the same fingerprinted test asset through the Files API. Keep production
validation unchanged. Verify with FR-058 followed by Content and the full browser
suite, retaining zero-flaky enforcement. This is a test fixture correction within
the approved monorepo verification scope.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | beta | Document full-suite Content fixture contamination and eligibility correction | See git history | RWANG |
