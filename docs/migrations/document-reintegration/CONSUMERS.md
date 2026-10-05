---
doc_type: migration-consumer-contract
version: "0.2.0"
status: approved
---

# Document consumer compatibility

This contract elaborates P4 of the [approved proposal](PROPOSAL.md). The pinned
[tooling inventory](../../../registry/document-reintegration/tooling.json) records
source locators, not a claim that every file needs a code change. Compatibility
exports preserve the original paths and row grammar; readers can retain that
interface while canonical records become the branch's source.

## Reader boundaries

| Consumer | Intended input and treatment | Verification |
|---|---|---|
| ID ledger, anchors and stability | Existing PRD/FEATURES export, ADR, risk, MI and issued CR source paths; no ledger rewrite | Original anchor/stability tests and full preflight |
| Graph, links and preflight | Exported rows plus indexed canonical locations; exact qualified current identities; original control/link metadata | Graph freshness, link CLI, duplicate-claim, canonical text and retired-rule tests |
| Domain-state, feature map and data-pipeline map | Same typed graph contract; current source and test bindings, with explicit canonical navigation added | Domain-state/data-pipeline tests and committed runtime projection freshness |
| Roadmap evidence, coverage and UI | Existing task/roadmap and requirement IDs; no conversion of task completion into document approval | Roadmap evidence/coverage and read-model tests |
| Source snapshot verifier | v1 pinned legacy blobs; opt-in v2 pinned canonical index and records | Capture/replay, wrong-version, mutation, hash, path and full-corpus tests |
| Snapshot service and feature binding | Server-issued verifier proof and unchanged source namespace/subject digest fields | Snapshot capture integration and feature service/mutation/read-model tests |
| Feature API, forms and read routes | Existing canonical feature keys and immutable snapshot-backed reference DTOs | Feature route/read-model tests; server build |
| SQLite/Postgres schemas, repositories and Phase-B backup | Existing persisted IDs, manifest JSON, verifier versions and proof fields | No schema/data rewrite; original Phase-B migration and backup contracts retained |
| CI related-test selector | Exact bare legacy IDs, explicit ZAI IDs and current `@trace implements`; unsafe/unknown trace selection falls back to full suite | Selector tests and migration fixtures |
| Package/CI entrypoints | Registry and provenance checks before graph/preflight, then focused migration tests | Local governance and Node test suite; hosted CI reported separately |
| LLM corpus and agent instructions | Updated root authoring boundary; original domain charters retained | Deterministic corpus generation/check |
| Historical Edge graph/registry | Original namespaced registry and revision; current explicitly qualified ZAI references resolve only to ZAI | Existing monorepo graph checks and namespace refusal fixtures |
| Retired plugin/harness material | Preserve historical source/inventory and retirement decisions; no resurrection of retired packages | Inventory provenance and existing retired-rule checks |
| Incoming ZNEXT tools, templates and packet formats | Pinned reference source; adapted query/view behavior uses ZAI canonical records and current graph | No imported approval/readiness packet can confer current runtime authority |

The active root `plugins/` directory is absent at the pinned target revision.
Historical harness references therefore remain historical; creating a replacement
package is outside this migration. Existing API schemas and seeds need no textual
ID substitution because no issued ZAI identity or persisted key is renumbered.

## Historical and current references

Original ADRs and issued `ZV2-CR` phase artifacts remain at their original paths.
Their approval text and Git blobs are not rewritten as summaries. Bare CR intake
records stay proposals. Risk and MI registers retain their declared families.
Navigation to ZNEXT requires a source revision and namespace; no broad find/replace
may turn a same-number imported ID into a current ZAI identity.

Canonical feature design/verification pages are generated navigation. Their links
to code and tests record bindings, not successful execution. Generated pages are
excluded from declaration discovery so reading a projection cannot create a second
source; physical link and table checks still apply to them.

Legacy bare global wikilinks such as `[[FR-012]]` continue to resolve to the
declared ZAI requirement, even when its new record has the basename `FR-012.md`.
An explicit Markdown path still resolves to that file. A new canonical filename
must not silently redirect an old identity link to a different graph node.

## Authoring transition

The owner accepted the P6 canonical documentation-writer transition on
2026-09-30; this integration activates it on `main` when the branch merges.
Original source rows, issued IDs and subject anchors remain pinned. Explanatory
canonical edits can be projected with `npm run docs:registry`; stale exports and
modified source-row digests fail the gate. New statements or IDs need a separately
reviewed record migration. The writer transition changes where documentation
edits begin; it does not approve normative ZNEXT adoption or persisted-data
migration.

## Writer rollback proof

The fixture rehearsal covers only records represented by the current canonical
registry and its PRD/FEATURES projections. In the pre-write case, projecting the
canonical record leaves the existing legacy table bytes unchanged, and the strict
projection check then passes. After a synthetic same-ID row update standing in for
a separately reviewed record migration, the generated legacy table retains the
exact updated row. The fixture removes the canonical index and record, then invokes
the unchanged baseline `id-anchors.mjs` row parser to read the projected ID and
statement. The fixture does not model the review itself or switch application
reader selection. This shows the retained export remains parseable in a
rollback-shaped fixture. It does not prove semantic adoption of ZNEXT material or
a rollback of an unreviewed identity, mapping, or historical-evidence change.

For a real post-cutover rollback, freeze canonical writes, save the exact branch
revision and generated exports, run the projection check, and reconcile any
non-table canonical change in an explicit disposition manifest before selecting
the old writer. Do not discard canonical records or use a blind Git revert as a
data rollback. Keep the v1 historical reader and all original snapshots pinned.

## Version diff

0.2.0 → 0.3.0: records owner approval for the P6 canonical documentation-writer
transition while keeping normative ZNEXT adoption and persisted-data migration
separate.
0.1.0 → 0.2.0: records the pre-write and post-write table rollback rehearsal,
including its covered scope and the reconciliation boundary for non-table data.
0.0 → 0.1.0: records intended interfaces for active readers, retained historical
consumers and imported tooling, with the explicit pre-cutover authoring boundary.
