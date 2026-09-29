---
version: "0.1.0"
status: implementation
---

# Documentation reintegration implementation receipt

**Version:** 0.1.0
**Status:** Local migration candidate; owner acceptance and P6 pending.

The [approved proposal](PROPOSAL.md) is implemented on an isolated ZAI branch.
The original ZAI source is pinned to
`a34ceaf79c112e02b1bcfdbf0a84122d835b002e`; ZNEXT provenance is pinned to
`8f3fa178f05567ae2c3863896d5a99cf6fd96d49`. No primary checkout, persisted
history, published ID, database or deployment is changed by this branch.

## Version diff

| Before | Migration candidate |
|---|---|
| PRD/SDD and feature table source | 539 source-preserving per-ID canonical records and byte-identical compatibility exports |
| Separate ADR, risk, MI and issued CR records | Original authority retained for the other 208 issued IDs; all 747 ZAI IDs inventoried |
| Unqualified crosswalk interpretation | Namespaced provenance, all 808 raw mapping rows, strict reviewed one-to-one resolution, split/ambiguous refusal |
| Historical manifest reader | Existing v1 interpretation plus separate v2 canonical manifests; stored proofs are not rebound |
| Table and graph navigation | 96 generated feature/category views plus scoped tests-for, impact and binding-readiness queries |
| Historical source comparison | 23 individually reviewed ZAI document deltas, pinned hashes, source anchors and code/test paths |

All 16 bare CR intake files remain proposals. Neither their presence nor a
crosswalk allocates an issued CR, approves a decision or proves delivery.

## Scope and authority

The complete incoming ZNEXT inventory has an explicit provenance-only disposition:
902 document entries, 47 tooling entries and 2,873 identities. The
[disposition overlay](../../../registry/document-reintegration/dispositions.json)
does **not** claim content-by-content semantic equivalence or approve normative
import. The bounded P2 work reviews the 23 ZAI changes since the original source
baseline and accounts for all imported provenance. Further specification adoption
requires subject-level review under the existing document lifecycle.

Current ZAI statements, status, row bytes, historical locators and the ID ledger
are preserved. Explanatory wrapper edits can refresh their derived file digest;
changing a requirement's meaning or admitting a new canonical record requires a
reviewed migration. The current branch is not an unrestricted writer cutover.

## Verification

Local evidence covers registry and export round trips, inventory/source pins,
qualified identity and ambiguity refusal, v1 replay, actual v2 Git-blob reads,
snapshot capture, feature consumers, graph/link parity, CI selection, projections,
query refusal fixtures, generated-view freshness and the server build.

| Local check | Result |
|---|---|
| Migration Node suite | 51/51 passed |
| Historical/v2 verifier and document-link regressions | 44/44 passed |
| Generated OpenAPI contract | 18/18 passed |
| Feature consumer regressions | 34/34 passed |
| Pinned inventory source verification | Passed for both source Git object databases |
| Canonical exports and 96 generated views | Deterministic checks passed |
| Server build | Passed |

Graph comparison preserves 242/242 code and test coverage and the 10 pre-existing
dangling links. The 47 removed relation triples are 42 filename-prefix follows
matches and five fixture/transitive verification matches; exact qualified
annotations retain their intended evidence. No historical record is rewritten.

The integration runner records exact command results outside the tracked source.
The full governance gate must retain its baseline of zero critical findings,
one warning and 34 informational findings. Code and test requirement coverage
remains 242/242; rule coverage remains 179/189. Generated bindings are not evidence
that every bound test was executed.

Hosted CI, full monorepo/E2E verification, deployment and production acceptance
are not claimed. The independent review applies to the composed implementation
revision recorded in the delivery report; this document does not grant approval.

## Remaining gates

Owner acceptance of the local evidence, any further normative ZNEXT adoption,
P6 canonical-writer cutover and merge remain explicit decisions. Before any
post-cutover rollback, stop and reconcile new-format writes; do not reinterpret
them with v1 or reset a shared checkout. Existing v1 evidence remains bound to its
original revision, path and hash. No persisted-data migration is performed here.
