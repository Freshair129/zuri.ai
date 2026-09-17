---
id: ZAI:RCA-2026-09-17-W5-PROVENANCE-REVIEW-HARDENING
title: W5 provenance review hardening
version: "0.1.0b"
status: beta
created_at: "2026-09-17T17:22:00+07:00,Luna Max"
last_update: "2026-09-17T17:22:00+07:00,Luna Max"
attributes:
  domain: project-manager
  doc_type: rca
  scope: isolated-worktree
---

# W5 provenance review hardening

## Symptom

The initial bounded W5 implementation could accept a stored snapshot while a
second ProjectRepository row for the same Project and Repository existed. Its
evidence cache also keyed only on scope, commit and manifest identifiers, so a
malformed persisted proof or manifest could reuse a previously materialized
result within one evidence-port instance. The exported SourceManifest schema
and explicit FEAT resolver did not independently enforce the manifest byte
bound or prove every referenced FR existed.

## Evidence

Static review of the initial source found the read binding query constrained by
the stored ProjectRepository id rather than the complete Project/Repository
pair. The cache key omitted the persisted proof and manifest values. Focused
adversarial tests then exercised the corrected cases: an ambiguous two-link
transaction, a proof verifier-id mismatch after a valid lookup, an over-sized
Unicode manifest and an invalid key with a Git runner that must not be called.
The final focused run passed 14/14 tests.

## Root cause

The implementation treated immutable identifiers as a sufficient binding
predicate and treated the manifest hash as a sufficient cache identity. Those
shortcuts omitted current cardinality and the rest of the typed persisted
proof/manifest tuple from the read boundary. Schema byte validation was left
only to normalization, and FEAT membership was checked without joining each
listed FR to the committed PRD registry.

## Why detection escaped

The first tests used one active ProjectRepository row, one valid proof and
manifest per port, and valid FEAT rows. Those fixtures did not distinguish an
exact pair query from a cardinality query or exercise reuse across malformed
stored evidence.

## Prevention

`proveDatabaseBinding` now queries the complete Project/Repository pair and
requires exactly one row; evidence cache keys include snapshot, proof and
manifest identity; `zSourceManifest` checks the byte bound; and explicit FEAT
resolution requires every referenced FR to exist in the same verified PRD.
The focused adversarial tests remain in the W5 unit packet and root's composed
read tests should retain malformed-proof and inactive/ambiguous-binding cases.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-17 | beta | Document review findings and fail-closed prevention before W5 handoff | uncommitted | Luna Max |
