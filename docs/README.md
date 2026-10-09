---
version: "0.3.0"
status: active
superseded_by: null
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
  distinct v1 historical verifier, implemented v2 reader, identity resolution and
  migration gates. [Generated-view contract](migrations/document-reintegration/VIEW-CONTRACT.md)
  defines the feature and category projections.

The isolated migration branch contains the canonical records, dual-version
readers, compatibility exports, generated views and query tools. The source delta
review covers 23 changed ZAI documents; ZNEXT material remains provenance-only
until subject-level review authorizes an import. [Implementation receipt](migrations/document-reintegration/RECEIPT.md)
records validation and remaining acceptance/cutover gates. Generated pages and
code/test bindings are not test results or delivery approval.

Use `npm run docs:tests-for -- ZAI:FEAT-009`, `npm run docs:impact -- ZAI:FR-091`
and `npm run docs:readiness -- ZAI:FEAT-009` for scoped navigation and binding
reports. See the [tooling contract](migrations/document-reintegration/TOOLING.md).

## Domain ownership and service execution

- [Domain map](DOMAIN-MAP.md) leads to business ownership and each domain charter.
- [Service documentation](services/README.md) explains Core, Conversation Runtime,
  Market Intelligence and SCM execution boundaries and verification responsibilities.
- [Verification policy](architecture/VERIFICATION-POLICY.md) defines scoped evidence,
  conservative expansion and the bounded Runtime shadow pilot.
- [Service map](architecture/SERVICE-MAP.md) is generated from the active project
  inventory, pilot metadata and package scripts with `npm run docs:services`.
- [Pilot delivery and evidence](migrations/scoped-verification/PILOT.md) records
  what has actually been checked and what remains before CI omissions can change.

Domain, service and feature are different axes. A service may execute several
domains; service documents link the canonical requirements rather than duplicate
them. Brand personas and character/design boards remain in the versioned design
kit outside this execution repository.

## Generated navigation

- [Product and feature views](product/README.md)
- [Architecture and decisions](architecture/README.md)
- [Operations, plans and migrations](operations/README.md)
- [Governance, change intake and templates](governance/README.md)

## Existing source entrypoints

- [Product](PRODUCT.md) · [Architecture](ARCHITECTURE.md)
- [PRD and SDD](PRD-SDD-v1.0.md) · [Feature registry export](FEATURES.md)
- [Decision record on pinned requirement identities](decisions/ADR-039-REQUIREMENT-IDS-ARE-PINNED-BY-SUBJECT-ANCHOR.md)

Version diff 0.2.0 → 0.3.0: adds the domain/service documentation layer and scoped
verification entrypoints; preserves canonical records and generated feature views.
