---
status: active
superseded_by: null
version: "0.1.0"
date: "2026-10-05"
---

# Authored standalone FR presentation prerequisite

## Symptom

The first composed graph generation after successful record issuance refuses FR-278/279/280. No receiver/database operation occurred.

## Evidence

`domain-state.mjs:418` throws `Readiness metadata is missing projected features: FR-278, FR-279, FR-280`. The FEATURES source template contains complete presentation entries for the pre-existing standalone FRs but none for the three newly issued subjects.

## Root Cause

New standalone FRs are valid canonical records but also become readiness projection candidates. The migration fixtures exercise registry/query/views with synthetic graphs; they did not invoke the full domain-state projection with its required primaryDomain/useCase metadata.

## Why the issue escaped detection

Pre-issuance full governance uses the original corpus. Only composed governance exercises these additional standalone candidates, so it correctly blocked publication.

## Proposed prevention

Add three presentation-only entries to the owning FEATURES source template and regenerate exports. Use Identity for the approved credential subject and Marketing for intake/read subjects. Do not change feature membership, canonical statements or old presentation entries. Keep the issuance receipt as historical operation evidence; a later presentation edit causes expected reapply output-drift refusal, not authority to rewrite the receipt. Require composed graph and strict governance before publication.
