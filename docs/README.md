---
version: "0.1.0"
status: active
---

# Documentation

This index links to the current ZAI source records, their compatibility exports,
and generated navigation views. It is hand-authored so the generated category
indexes do not index themselves.

## Source and identity

- [Canonical ZAI record index](../registry/document-registry/index.json) and its
  per-ID records preserve the published ZAI identities and original row payloads.
- [PRD/SDD compatibility export](PRD-SDD-v1.0.md) and
  [feature compatibility export](FEATURES.md) are generated from those records.
- The approved [reintegration proposal](migrations/document-reintegration/PROPOSAL.md)
  defines how pinned ZNEXT records are treated as provenance. A matching number or
  imported file does not make a ZNEXT record an active ZAI requirement.
- [Reintegration diagrams](migrations/document-reintegration/DIAGRAMS.md) show the
  distinct v1 historical verifier, proposed v2 reader, identity resolution and
  migration gates. [Generated-view contract](migrations/document-reintegration/VIEW-CONTRACT.md)
  defines the feature and category projections.

The migration is in progress: P0 contract approval is complete; P1 compatibility
work and P3 canonical-view work are underway. P2 reconciliation, P4 consumer
updates, P5 integrated acceptance and P6 cutover are not complete. Generated pages
are navigation and traceability projections; a code or test path on a page is not
a test result or an approval.

## Generated navigation

- [Product and feature views](product/README.md)
- [Architecture and decisions](architecture/README.md)
- [Operations, plans and migrations](operations/README.md)
- [Governance, change intake and templates](governance/README.md)

## Existing source entrypoints

- [Product](PRODUCT.md) · [Architecture](ARCHITECTURE.md)
- [PRD and SDD](PRD-SDD-v1.0.md) · [Feature registry export](FEATURES.md)
- [Decision record on pinned requirement identities](decisions/ADR-039-REQUIREMENT-IDS-ARE-PINNED-BY-SUBJECT-ANCHOR.md)
