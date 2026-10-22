---
status: active
superseded_by: null
version: "1.0.0"
artifact_kind: resolved-source-projection
source_revision: "18008b774fc54febd23ca675d142f15da7d67db5"
---

# Build blueprint

This folder is a portable, hash-bound resolved projection of the canonical
Zuri.ai product and system baseline at the source revision recorded above. The
canonical requirement records, accepted ADRs, domain charters, service contracts
and schema remain the sources of truth. This blueprint helps another team build
to those sources; it is not a second writable registry, a new approval, or a
claim that all target behavior is already implemented.

Read the chapters in this order:

1. [Scope and precedence](SCOPE-AND-PRECEDENCE.md) defines which current source
clauses are in the minimum target profile, what controls conflicts, and how
historical, planned and implemented states are kept distinct.
2. [Architecture](ARCHITECTURE.md) defines ownership, trust boundaries,
transactions, runtime and external-system ports.
3. [Data and contracts](DATA-AND-CONTRACTS.md) defines the rules for identity,
serialization, authorization, errors, versions, and use of the exact schema and
API sources.
4. [User experience](UX.md) describes user journeys and observable recovery
states.
5. [Acceptance](ACCEPTANCE.md) gives observable target scenarios and explains
how the requirement matrix binds each source statement to evidence clauses.
6. [Reconciliation](RECONCILIATION.md) summarizes conflict rationale using
local navigation labels. `R01` and similar labels are not canonical IDs. The
operative profile inclusion and clause-resolution rules live in
[`resolutions.json`](resolutions.json); the Markdown table is not a second rule
source.

## Rebuild package

For implementation handoff, regenerate these source-bound artifacts from the
selected canonical revision and record their source hashes in a manifest:

- the exact set of in-profile canonical records, including their unchanged
  original rows and explicit feature membership;
- the complete raw Prisma schema and its model/field/enum/relation dictionary;
- the API operation census and source machine schemas, preserving whether each
  operation has an accepted typed contract or is only present in a route
  inventory;
- a source-linked obligation/oracle index that binds each included canonical
  statement and applicable amendment to one or more local acceptance scenarios;
  the index is not a set of fully decomposed executable test cases, and
  supporting test references remain separate;
- separate product-state, developer-delivery-plan and as-built evidence views.

Compute record counts from the pinned registry and the profile rules; never copy
a historical count into the package. The manifest binds every included or
excluded source row to its original path, identity, statement hash and selected
revision. A changed source hash requires rebuilding and reviewing the resolved
projection before implementation continues.

The acceptance scenarios give cross-cutting observable examples. A receiving
team derives concrete fixtures and assertions for its own implementation from
the exact source statement, controlling resolution, typed contract and schema.
Historical test references are navigation only and do not constitute new PASS
evidence.

The API operation inventory is useful for coverage and navigation. It is not an
exact DTO contract when its source describes a route inventory or omits handler
fields. Exact accepted endpoint contracts and typed machine schemas govern wire
behavior; internal implementation fields remain constrained by canonical
behavior and authorization but may be chosen by the owning implementation.

## State and plan separation

Business product state machines and human project planning are part of product
behavior. Developer task status, implementation sequencing, owners, dates, CI
results and historic test receipts belong in separate delivery artifacts. They
cannot change the normative baseline or prove acceptance. Existing code and
test evidence describe as-built behavior only; they do not shrink the target
profile or establish provider activation.

## Source authority

Use [scope and precedence](SCOPE-AND-PRECEDENCE.md) when a document is stale,
candidate, source-preserved or contradicted by a later accepted decision. Keep
canonical identities and statements intact. This projection adds no FR, NFR,
BR, SEC, SDD, FEAT or ADR identifier and does not change any feature's source
membership.
