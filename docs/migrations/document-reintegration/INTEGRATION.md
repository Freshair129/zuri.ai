---
doc_type: migration-design
status: implementation
version: "0.3.0"
---

# Canonical registry consumer integration

**Version:** 0.3.0

**Status:** Implementation design within the owner-approved migration contract of 2026-09-29.

## Boundaries

The source of active ZAI requirement and feature statements becomes individual
canonical records. The existing PRD/SDD and FEATURES paths remain deterministic
compatibility exports. The first export is byte-identical to its pinned source;
all historical versions remain available in Git. Canonical edits must regenerate
the exports before the existing graph, ID ledger, runtime readiness and CI checks
can accept the tree. Existing guards still run and the ID ledger is not rewritten.

The registry tool owns export generation. The governance command checks freshness
without writing the compatibility exports: a hand-edited export must fail, not be
silently repaired by the gate. Generated graph/index outputs continue to be rebuilt
after that check. The canonical format/parser is shared with the snapshot reader,
and its runtime module stays inside apps/server for the existing image boundary.

## Snapshot format versions

- Manifest schema 1.0.0 and verifier 1.0.0 retain the exact existing registry-blob
  behavior, required paths, hashes and reference locators. They never follow a
  current crosswalk when reading historical evidence.
- Manifest schema 2.0.0 and verifier 2.0.0 read the canonical index and the FR/FEAT
  records that index declares. Every required record must be in the manifest,
  must match its Git blob SHA-256 at the requested commit, and must declare its
  expected original ZAI ID. Paths must be canonical repository-relative paths.
- A stored proof must match both its snapshot and the supported manifest/verifier
  version pair. Unknown versions, missing records, duplicate identities, invalid
  rows, mismatched namespaces and unresolved feature membership fail closed.
- New references use the canonical record locator and pinned commit. Old references
  keep the legacy export locator. IDs, subject digests, scope checks, immutable
  snapshot IDs and persisted bindings retain their meaning.
- Imported ZNEXT provenance does not become runtime authority through an alias.
Runtime binding still requires an approved canonical ZAI subject in that snapshot.

## Documentary identity graph

The FR/FEAT canonical index remains the runtime requirement projection. Other
issued ZAI identities keep their existing owner registry and source path:
decisions, change envelopes, the risk matrix and the MI SRS are not copied into
parallel wrappers. The existing ID-anchor collector reads those authority files
and supplies their exact source path and subject anchor to generated graph nodes.

The graph and link resolver index every current ZAI identity by its complete
`ZAI:<ID>` key. ADR and issued ZV2-CR IDs reuse their existing document nodes;
embedded RSK and MI-RQ subjects get stable identity nodes that point back to
their exact source row or heading. These documentary nodes support references
and trace links only; they do not become FR behavior or runtime proof. Bare CR
intake files remain unissued proposals, and ZNEXT identities stay a separate
namespace.

Identity-only nodes preserve the source record's lifecycle status for navigation,
but they are not document or obligation nodes and do not require a successor edge.
The supersession check remains scoped to content-bearing documents and requirements;
a closed risk such as RSK-006 can therefore remain visible without inventing a
replacement ID.

Acceptance: every one of the 747 issued ZAI IDs has one qualified graph target;
the distinct MI-RQ-033 and MI-RQ-211 rows resolve separately; exact issued CR
IDs resolve to their parent documents and never to phase artifacts; CR-014
intake does not resolve as ZV2-CR-014; source paths and contents remain unchanged.
The FR/FEAT snapshot reader still accepts only its declared runtime projection.

No database schema or historical row update is required. A capture request selects
its format through the source manifest schema version; it cannot supply or invent
the verification proof. The server derives the verifier version from validated input.

## Verification

Test the existing v1 capture and replay path unchanged. Add v2 capture/replay and
mutation tests covering omitted records, wrong record ID, a copied subject behind
another ID, duplicate index entries, path escape, digest mismatch, unsupported
version pairs and source-namespace refusal. Verify that byte-identical exports
keep existing requirement/feature subject digests and graph evidence stable.

The integration gate runs canonical export checks, source identity checks and the
existing governance chain; focused identity/graph/runtime tests run before broader
checks. The final receipt records actual results and any remaining acceptance gate.

## Version diff

0.1.0 → 0.2.0: extends generated identity resolution to all issued documentary
families while keeping their owner registries, source text and runtime boundary.
0.2.0 → 0.3.0: clarifies that identity-only records retain lifecycle status but
do not acquire document-successor obligations. The FR/FEAT compatibility-export
and snapshot contracts remain unchanged.
