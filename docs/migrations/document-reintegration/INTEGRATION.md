---
doc_type: migration-design
status: approved
version: "0.1.0"
---

# Canonical registry consumer integration

**Version:** 0.1.0

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

0.0 → 0.1.0: specifies compatibility-export authority, canonical consumer checks,
versioned snapshot readers and regression evidence without changing business behavior.
