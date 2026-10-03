# Standalone FR capability classification

## Symptom

Product Readiness counts explicit FEAT bundles and independent FRs as Features,
even though the requirement and product-capability namespaces are distinct.

## Evidence

Audit base: `fad8ec6252941ca3de01afdb3116484f86b366c3`. The PRD declares 272 FRs;
FEATURES declares 45 FEATs covering 158 distinct FRs. The remaining 114 FRs
have readiness metadata. There are no duplicate memberships, repeated FRs in a
bundle, unknown bundled FRs or missing standalone metadata at this base.

The ambiguous terminology appears in FEATURES (including its revision notes),
ADR-025 D11, the FR-124 note and the Phase B commit-provenance contract (Doc27).
`domain-state.mjs` carries that terminology into its projection comment; the
source-verifier test fixture repeats it. ProductReadinessDashboard counts both
types under Features. DomainMapView consumes the same mixed list.

## Root Cause

ADR-025 D11 equated independent FRs with Features for display convenience. The
projection has distinct wire kinds (`bundle`, `requirement`), but its collection
and aggregate names encouraged consumers to collapse their semantic identities.
`doc-graph.mjs` also deduplicates edges before validating repeated FR membership;
preflight checks unknown FRs and duplicate FEAT IDs but not multiple FEAT owners.

## Why the issue escaped detection

Tests proved projection completeness and readiness calculations, but did not
assert semantic labels or reject multiple FEAT membership. Deduplication hid
repeated FR references inside a FEAT before graph consumers could inspect them.

## Proposed prevention

Use the owner's supplied specification: canonical Standalone FR terminology,
strict membership validation before edge deduplication, a graph-derived per-FR
inventory in TRACE, and rendered Feature / Standalone FR tests. Preserve schema
2.0 wire fields and derive semantic kinds from IDs in the read model. Reuse the
existing live-document enumeration for a terminology guard; archive records are
excluded. No FR/FEAT IDs, subjects, memberships, evidence or use cases change.

## Verification correction

The first browser run exposed an over-broad new assertion: full-text search for
FR-046 also matches three other FRs whose prose references that ID. The Playwright
trace records a strict-locator violation over four Standalone FR badges. Scope
the assertion to the card containing the exact ID; preserve existing full-text
search behavior. This is a test-locator defect, not a readiness classification defect.
