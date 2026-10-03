---
doc_type: migration-design
status: implementation
version: "0.1.0"
---

# Generated document views contract

**Version:** 0.1.0
**Status:** Scoped implementation design under the approved reintegration proposal.

## Purpose and authority

`tools/generate-document-views.mjs` builds navigation and feature views from the
canonical ZAI registry plus a versioned document graph. The registry is the source
for IDs, statements, membership and original lifecycle markers. The graph contributes
exact source links and code/test path bindings. A graph edge is not a test result,
document approval, ownership assertion or new requirement declaration.

All outputs are projections, have no issued document IDs, and must not be edited by
hand. The tool does not change canonical records, existing ID ledgers, historical
snapshots or runtime bindings. No ZNEXT candidate is promoted by view generation.

## Inputs and reproducibility

- Read and validate `registry/document-registry/index.json` and every indexed record
  with the existing `readCanonicalRegistry()` API.
- Read `docs/.doc-graph.json` as a versioned input. Require a supported graph
  version and validate every feature `bundles` edge against each canonical FEAT
  record's exact FR membership. Graph discovery is used for navigation and bindings,
  never as a competing declaration source.
- Resolve linked source, code and test paths against the selected repository root.
  An emitted local link must point to an existing file. Do not infer ownership from
  directory names. Source/context links whose graph targets are not materialized in
  the selected repository are omitted; the generator does not invent public URLs or
  expose private/external paths.
- Sort generated paths, IDs, and relation links deterministically. `--check` is
  read-only and fails when an expected output is missing or stale. Optional
  `--root` and `--graph` arguments allow an isolated root and a frozen graph input.

## Feature design and verification views

For each canonical FEAT record, generate `docs/features/<FEAT-ID>/design.md` and
`verification.md` without replacing `feature.md` or any canonical requirement file.
The design view links the canonical FEAT record and, for each FR explicitly listed
by that record, renders the canonical statement as readable Markdown, preserves the
original row's final lifecycle/delivery marker verbatim, and links the exact
canonical FR record. Relative Markdown links in statements or row status text are
rebased from the original registry file to the view. Private or out-of-repository
targets are suppressed in the view; the exact source row remains available in the
linked canonical record. It lists existing typed source/context document relations
from the graph as navigation links when their paths exist locally; relation type and
graph source remain visible.
No relationship is inferred from matching IDs, file locations or names.

The verification view lists current graph `implements` code paths and `verifies`
test paths for those exact FR IDs. Each binding retains its graph source and edge
type. These are traceability paths only: no acceptance criteria, test cases, test
results, or pass claims are generated. Missing or stale local binding paths fail
generation rather than being presented as current evidence.

## Navigation projections and exclusions

Generate these category indexes from existing graph document paths:

- `docs/product/README.md`
- `docs/architecture/README.md`
- `docs/operations/README.md`
- `docs/governance/README.md`

They are navigational groupings, not ownership or authority declarations. Keep
`docs/README.md` hand-authored so it can explain current source authority, link to
the migration contract, and identify these generated indexes without self-indexing.
The shared document graph and preflight metadata discovery exclude exactly the
generated paths above plus `docs/features/FEAT-*/design.md` and `verification.md`;
physical link and control checks still apply.

## Verification and version diff

Tests must cover deterministic rendering, exact FEAT-to-FR membership, preserved
statements/markers, canonical and source links, binding labels, missing graph edges
or files, and read-only stale-output checking. Run the standard-library Node tests
and generator `--check` against the frozen graph before the integrator refreshes the
shared graph. A generated path is not a new canonical source.

0.0 → 0.1.0: defines registry/graph inputs, generated feature and category paths,
evidence limits, graph checks, and deterministic check-mode behavior. This contract
does not approve any change to requirement meaning or historical evidence.
