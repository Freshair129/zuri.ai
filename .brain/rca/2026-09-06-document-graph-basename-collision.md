---
version: "0.1.0b"
created_at: "2026-09-06T18:41:54+07:00,RWANG,06cadb76"
last_update: "2026-09-06T18:41:54+07:00,RWANG"
status: beta
attributes:
  domain: agent-governance
  complexity: C-2
  risk: MEDIUM
---

# RCA — equal document basenames share graph IDs

## Symptom

M3 inventory found distinct SRS, CONTEXT-MAP and README files sharing graph IDs.
Namespace qualification alone cannot distinguish nodes already duplicated within Server.

## Evidence

- Approved inventory at 8db6fe85: 1,908 node records, 1,903 unique IDs. Duplicate
  occurrences: CONTEXT-MAP three, SRS three, README two; zero dangling endpoints.
- `scripts/doc-graph.mjs` builds document IDs from `path.basename(file, '.md')`.
  Legacy control links also use a basename Map and reconstruct the source ID from basename.
- A CLI fixture with equal basenames in two directories fails before correction:
  711 records but only 705 unique IDs. This includes real copied documents and the new pair.
- The corrected regression checks distinct nodes, intended relative-path targets,
  old-ID ambiguity, stable unique identities, and duplicate publication rejection.

## Root Cause

Basename identity loses directory provenance. A Map keyed by that ID silently overwrites
one record with another. Existing endpoint checks can find the shared ID and report no
dangling edge while the destination remains ambiguous.

## Why the issue escaped detection

The resolver tested ambiguous aliases on supplied node fixtures, but the CLI generator
did not assert globally unique node IDs. Domain CHARTER files had a special case; other
repeated basenames did not. Source-path completeness and ID uniqueness were not tested together.

## Correction and prevention

Under the owner-approved M3 specification, qualify colliding document IDs by normalized
source path before building edges. Preserve unique IDs and business registries. Rebuild
legacy targets from source-relative paths, reject ambiguous fallback, record previous ID
and source path per migrated node, and reject duplicate node IDs before publication.
Regenerate all views through governance. No Edge import or visibility change is included.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | beta | Confirmed identity loss and owner-approved M3 correction | base 06cadb76 | RWANG |
