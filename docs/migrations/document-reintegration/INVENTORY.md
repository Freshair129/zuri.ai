---
doc_type: migration-inventory-design
status: inventory-generated-review-pending
version: "0.2.0"
---

# Document inventory and provenance contract

**Version:** 0.2.0
**Status:** Generated snapshot verified; semantic reconciliation remains pending.

This inventory records source files, declared identities, the pinned zuri-next
crosswalk, and proposal intake. It is an accounting and provenance baseline. It
does not declare semantic equivalence, approve an import, or prove that a mapped
behavior is implemented.

## Pinned inputs

| Namespace | Revision | Inventory role |
|---|---|---|
| `ZAI` | `a34ceaf79c112e02b1bcfdbf0a84122d835b002e` | Existing product documents and issued identity ledger |
| `ZNEXT` | `8f3fa178f05567ae2c3863896d5a99cf6fd96d49` | Candidate documents, registries, tooling, and crosswalk |

The generator reads Git trees and blobs at these full revisions. It does not read
the source worktree contents. Repository locations are command-line inputs only
and are never written to a tracked artifact.

## Scope and accounting

`documents.json` contains every tracked file beneath a `docs/` directory in either
snapshot, plus every tracked Markdown, MDX, reStructuredText, AsciiDoc, or plain
text file elsewhere. This includes historical documents, non-Markdown documents
and assets within documentation trees, proposal packages, and generated files.
Each file has its own source namespace, repository-relative path, full revision,
Git blob object ID, SHA-256 of the raw blob bytes, artifact kind, disposition,
and review state.

`tooling.json` is a separate inventory of the documentation system's source
registries and readers. It includes all tracked zuri-next `registry/**` and
`tools/**` files, plus the zuri-ai document identity, graph, preflight, domain
state, roadmap, and governance verification tools and their directly relevant
tests/configuration. These entries are not counted as documents unless they also
meet the document-file selection rule.

`identities.json` records each declared identity with a qualified namespace,
full source revision, and exact declaration locator (`path`, `blob`, and SHA-256).
`ZAI` identities come from the pinned zuri-ai ID ledger, including retired and
burnt ledger entries. `ZNEXT` identities come from feature and requirement paths,
frontmatter IDs, headings, acceptance-criterion records, component IDs in feature
designs, and domain/service registries. Edge-local requirement IDs come from the
pinned Edge document graph and remain in the `edge` namespace, including compound
families such as `RAG-FR` and `ZPP-AC`. Mentions and navigation links alone do not
create declarations.

`mappings.json` aggregates by the original zuri-ai `legacy_id`: one mapping per
qualified `ZAI` source identity, with a deduplicated set of `ZNEXT` targets. The
mapping direction remains `ZAI` → `ZNEXT`; this is crosswalk lineage, not an
instruction to replace zuri-ai's current authority. `sourceRevision` is the full
zuri-ai pin; `targetRevision` is the full zuri-next pin. `sourceLocator` names
the zuri-ai ledger declaration. `provenance[]` retains one record for every
source CSV data row,
including its original path, zuri-next revision, blob, raw-byte SHA-256, 1-based
data-row ordinal, exact target cell (null when blank), and raw disposition. The
aggregated disposition is the shared raw value when all rows agree, `mixed` when
they differ, or `unmapped` when no crosswalk row exists. Split and blank mappings
remain explicit; they are never collapsed into a single selected target.

`intake.json` records bare `CR-*` proposal files from zuri-ai intake as
`proposal-intake`. Their filename number is not an issued identity, their
`identity` is null, and import never implies acceptance. Governed `ZV2-CR-*`
records remain ordinary ZAI identities and are not reclassified as bare CR
intake.

## Dispositions and review state

File and identity dispositions describe source provenance, not migration
completion. Existing zuri-ai material is `current-source`; zuri-next material is
`incoming-review`; bare CR intake is `proposal-intake`; generated views are typed
as projections while retaining their source disposition. Every imported document
and identity is `reviewStatus: "not-reviewed"` until a later, explicit review
records otherwise. This inventory does not emit `approved-alias` mappings.

Crosswalk disposition and semantic review are separate fields. The crosswalk's
original row labels (`migrated`, `split`, `merged`, `retired`, or `dropped`) are
preserved as `sourceDisposition`; each mapping's `reviewStatus` remains
`not-reviewed`. A source ID absent from the crosswalk receives an explicit
`unmapped` record with empty targets and no fabricated CSV provenance.

## Manifest shape and deterministic generation

All JSON manifests use schema version `1`, stable lexicographic ordering, UTF-8,
two-space indentation, and a final newline. They contain no generation time,
absolute path, document body, inferred semantic equivalence, or private
discrepancy narrative. Repository-relative paths use `/` on every platform.
SHA-256 is calculated over the exact raw bytes returned by `git cat-file blob`;
it is distinct from the Git blob object ID.

The CLI has three operations:

| Operation | Inputs | Purpose |
|---|---|---|
| `--generate --zai-repo <path> --znext-repo <path>` | Both repositories, each containing the pinned object | Rebuild all manifests exclusively from the two pinned Git object databases |
| `--verify-sources --zai-repo <path> --znext-repo <path>` | Both repositories | Recheck each pinned revision, path, blob ID, and raw-byte SHA-256 against Git objects |
| `--check` | Committed manifests only | Offline CI validation of schema, counts, ordering, unique qualified identities, source coverage, crosswalk provenance cardinality, mapping target declarations, and intake rules |

`--check` does not claim that external pinned repositories are available or
re-read. CI can validate the committed snapshot without a zuri-next checkout;
source freshness is checked only by the explicit source-verification operation.
Missing target declarations, duplicate conflicting identities, conflicting
mapping cardinality, malformed rows, or a pinned revision mismatch fail closed.

## Generated structural counts

The document selector records 2,433 files: 1,531 from ZAI and 902 from ZNEXT.
It includes 1,159 ZAI files and 899 ZNEXT files under any `docs/` directory; the
remaining selected files are tracked documentation text outside those trees.
The separate tooling inventory has 367 records: 320 ZAI and 47 ZNEXT.

The identity manifest contains 747 ZAI ledger identities, 2,873 ZNEXT declared
identities, and 142 Edge namespace identities. ZNEXT family counts are:

| Family | Count | Family | Count |
|---|---:|---|---:|
| AC | 958 | ADR | 107 |
| API | 266 | ARCH | 1 |
| BR | 89 | BRD | 1 |
| CMP | 287 | DOM | 14 |
| EVT | 3 | FEAT (including parts) | 132 |
| FR | 411 | NFR | 101 |
| PLAN | 1 | PRD | 1 |
| PROC | 1 | RB | 5 |
| SDD | 97 | SEC | 35 |
| SRV | 9 | STD | 5 |
| TC | 349 | | |

The pinned crosswalk inventory contains 23 CSV files, 808 data rows, 647
distinct ZAI source IDs, 720 distinct ZNEXT targets, 27 blank target cells, and
81 sources with more than one distinct target. A further 100 ZAI ledger IDs have
no crosswalk source row: ADR 1, FR 1, MI-RQ 72, RSK 16, and ZV2-CR 10. Each gets
an explicit `unmapped` mapping record with no CSV provenance. The resulting 747
mapping records account for every ZAI ledger identity. The intake inventory has
16 bare CR proposal files; each remains unissued and unapproved.

These are structural counts only. They do not measure semantic review, behavior
coverage, or implementation completeness.

## Verification and limits

The focused Node test suite passes 4/4 tests. It verifies reproducibility from
Git objects, exact snapshot pins, missing target rejection, duplicate/conflicting
mapping handling, split and blank preservation, Edge namespace separation, and
the rule that bare CR intake has no identity and remains a proposal. `--check`
passes using only the committed manifests. `--verify-sources` reproduces every
manifest from the two pinned Git object databases and verifies source blob IDs
and raw-byte SHA-256 values. These checks do not complete the later
content-by-content reconciliation.

## Version diff

| Version | Change | Status |
|---|---|---|
| 0.2.0 | Generated and verified file, tooling, identity, mapping, and proposal-intake manifests; added fixture coverage | Inventory implemented; semantic review pending |
| 0.1.0 | Defined pinned inputs, inventory scopes, provenance schemas, conservative dispositions, and CLI operations | Approved design |
