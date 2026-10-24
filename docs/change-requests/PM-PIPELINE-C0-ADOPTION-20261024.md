---
id: ZAI:PM-PIPELINE-C0-ADOPTION-20261024
doc_type: source-row-migration
status: approved
version: "0.1.0"
relations:
  - type: references
    target: ZAI:PM-PIPELINE-CONTRACT-FOUNDATION
  - type: references
    target: ZAI:ADR-035
---

# Pipeline C0 adoption and canonical clarification

## Approval

On 2026-10-24 the product owner explicitly approved C0 v0.1.5 D1–D6 at
commit `1b76049a0dce40a4a65cb68dac5f5f3154495203`, authorized canonical
source reconciliation and C1 implementation with isolated SQLite/PostgreSQL
runtime-role race/recovery tests and independent review. Production is excluded.

## Exact source migration

Preserve ZAI:FR-082/083/084/085 and ZAI:BR-017 identities, subject anchors,
paths and FEAT membership. Migrate the four FR source-preserved wrappers to reviewed
migration against the approved commit; do not relabel changed rows historical.
FR-082/083 retain their statements and become approved planned requirements.
FR-084 makes strict V1/provenance/CAS and legacy SQL NULL explicit.
FR-085 clarifies typed ordering successors and aggregate release scope
through the accepted supplement sections4–5; related/lineage edges do not hold.
BR-017 retains its unchanged source row and gains an explanatory link to the
accepted FR-085 interpretation; its general successor rule remains valid.
No new requirement identity or membership is issued. Planned is not delivered.

ADR-035 implementation disposition accepts the exact normative supplement;
C1 is selected, with C2–C4 subject to their sequential implementation prerequisites.
The supplement's original examples and source baseline remain pinned provenance.
Its global graph lock covers preserved cross-Tenant legacy bridges; no implicit
legacy repair or production activation is authorized.

## Validation and review

Regenerate the registry, compatibility exports, graph and feature views serially.
Run canonical parser/migration readers and governance, then C1 behavior, provider,
recovery, build and browser checks. Independent review binds the composed patch.
