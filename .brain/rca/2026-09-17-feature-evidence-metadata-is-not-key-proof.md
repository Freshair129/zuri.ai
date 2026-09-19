---
id: ZAI:RCA-2026-09-17-FEATURE-KEY-PROOF
title: Snapshot metadata alone cannot prove a canonical Feature key
version: "0.2.0b"
status: beta
created_at: "2026-09-17T15:22:00+07:00,RWANG,052821a7"
last_update: "2026-09-17T15:26:15+07:00,Luna Max"
attributes:
  domain: project-manager
  risk: HIGH
relations:
  - type: references
    target: ZAI:FR-252
  - type: references
    target: ZAI:PM-PHASE-B-FEATURE-IMPLEMENTATION-PLAN
---

# Metadata is not canonical key proof

## Symptom and evidence

W3 project-feature-read-routes.test.js creates a snapshot with
verificationProof and sourceManifest both "{}" and a Feature with the invented
canonicalFeatureKey "feature.explicit.a". It expects AVAILABLE evidence and a
PINNED requirement in the read result. The read-model evidence selection uses
membership in availableSnapshotIds, populated from metadata validationStatus,
rather than proof of the requested key and revision in the committed registry.

## Root cause

Snapshot identity/metadata availability and canonical key verification were
treated as the same condition. A VALID label without a complete typed proof,
manifest and bound source evidence cannot establish the selected requirement.

## Why it escaped detection

The initial fixture asserted positive evidence using only a fabricated status
and malformed proof objects. W5's real commit verifier had not been implemented.

## Correction and prevention

Keep snapshot metadata listing separate from canonical key evidence. W3 must
return UNAVAILABLE key evidence and null canonicalSubject until the approved
W5 shared evidence port verifies the bound commit, manifest, namespace, key,
membership and revision. A malformed stored proof must never be promoted.
Retain explicit keys/IDs under current scope and preserve the metadata GET
contract. The read model now keeps `evidenceState: UNAVAILABLE` for any stored
canonical pair and `bindingState: UNAVAILABLE` for every W3 requirement
binding; the fixture uses a null pair and validates the independent metadata
listing. W5 must provide real Git fixtures for positive proof.

## Validation

Focused W3 verification passed after the correction: `npm test -- --run
tests/unit/project-feature-read-model.test.js
tests/integration/project-feature-read-routes.test.js` executed 2 files and
11 tests, with `assert-tests-ran` confirming all 11. The integration suite
also proves a VALID metadata row can be listed without promoting key or
requirement evidence. `node --check` passed for the changed read model and
both owned test files. No production change.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | beta | Document source-proven conflation of metadata and key evidence; preserve explicit unavailable state | 052821a7 | RWANG |
| 0.2.0b | 2026-09-17 | beta | W3 keeps key and requirement evidence unavailable until W5 proof; focused 11-test validation passed | 052821a7 | Luna Max |
