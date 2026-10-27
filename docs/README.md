---
version: "0.7.8"
status: active
superseded_by: null
---

# Documentation

This index links to the current ZAI source records, their compatibility exports,
and generated navigation views. It is hand-authored so the generated category
indexes do not index themselves.

## Rebuild blueprint

Use the [reconciled rebuild blueprint](architecture/blueprint/README.md) for the
minimum source profile, six specification chapters, exact contracts and source
precedence. Its operative projection rules preserve canonical IDs and separate
retired or deferred clauses from product requirements. Delivery state, developer
plans and historical test receipts are separate from the build specification.

## Documentation profiles and file indexes

- [Proposed documentation requirements specification](governance/DOCUMENTATION-REQUIREMENTS-SPEC.md) defines product,
  domain, feature, service, SRS, decision, plan, and evidence profiles.
- [Domain inventory](domains/README.md) records charters, declared identifiers,
  and observed SRS coverage.
- [Plans location and retained-source index](plans/README.md) records the plan
  cleanup and the contracts/evidence still held at legacy paths; the
  [roadmap index](roadmap/README.md) separates delivery state from projections.
- [Engineering assessments](../reports/README.md), including the
  [2026-10-23 code/requirements gap assessment](../reports/gap-analysis-2026-10-23/README.md),
  record dated findings and verification limits without creating requirements or plans.
- [Knowledge lifecycle and serving assessment](../reports/knowledge-readiness-2026-10-26/README.md)
  records the bounded storage/access review, executed checks and remaining
  main-dev qualification separately from whole-system completion.
- [Compact self-host reconciliation](../reports/compact-selfhost-2026-10-27/README.md)
  links current requirements/code and retained audit findings to
  [accepted ADR-115](decisions/ADR-115-COMPACT-SELF-HOST-PROFILE.md) and its
  [approved implementation plan](plans/COMPACT-SELF-HOST-IMPLEMENTATION-20261027.md).
  Safe Compact continuation includes isolated TEST core, private Asset/catalog and
  explicit PostgreSQL Marketing intake work;
  production, live credentials and release actions remain separate.
  The [2026-10-28 Task4 requalification](../reports/compact-selfhost-2026-10-27/task4-requalification-20261028.md)
  records the private S3 integrity correction and real pricing-catalog consumer checks.
- [Template index](templates/README.md) lists document templates and their
  scope.
- [Root-file register](governance/ROOT-FILE-REGISTER.md) enumerates every
  tracked file directly under `docs/` at the reviewed base, records known path
  readers, and calls out lifecycle, duplicate-source, and authority conflicts.
- [Directory register](governance/DOCS-DIRECTORY-REGISTER.md) enumerates all
  20 direct folders under `docs/` and names the local, generated, or canonical
  index that serves as each folder's entrypoint.

These indexes are navigation aids, not a complete filesystem census. Before
asserting a file is absent or replacing or deleting one, enumerate tracked and
untracked files in the affected directory and inspect the exact file and its
references.

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

- [Approved GenesisRAG17 ownership and reliability design](change-requests/knowledge/genesisrag17-ownership-reliability-20261023.md)
  and [implementation plan](change-requests/knowledge/genesisrag17-implementation-20261023.md)
  retain four repositories, Knowledge capability accountability and explicit
  component authority. [Operations](runbooks/GENESISRAG17-OPERATIONS.md) explains recovery and qualification.
- [Domain index](domains/README.md) lists confirmed charters and observed
  coverage.
- [Project Manager linked SRS](domains/project-manager/SRS.md) is an approved
  reading view over canonical records, peer contracts and evidence limits;
  the wider PM system design retains its separate candidate status.
- [Project Manager implementation plans](plans/PROJECT-MANAGER-IMPLEMENTATION-20261023.md)
  propose the remaining source reconciliation, verification, qualification and
  gated Pipeline Builder work for review before coding.
- [Service documentation](services/README.md) explains Core, Conversation Runtime,
  Market Intelligence and SCM execution boundaries and verification responsibilities.
- [Model-source evidence rules](GOVERNANCE-MODEL-SOURCES.md) define how domain
  charters bind owned models to Prisma or a repository-local SQL/Prisma source.
- [Verification policy](architecture/VERIFICATION-POLICY.md) defines scoped evidence,
  conservative expansion and the bounded Runtime shadow pilot.
- The service map is an optional generated projection from active project
  inventory, pilot metadata, and package scripts. Its absence is not evidence
  that a service or its documentation is absent.
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
- [Prompt artifacts](prompts/README.md)

## Existing source entrypoints

- [Product](PRODUCT.md) · [Architecture](ARCHITECTURE.md)
- [Data-flow atlas (visual companion)](DATA-FLOW-ATLAS.html) · [Canonical data-pipeline map](DATA-PIPELINE-MAP.md)
- [PRD and SDD](PRD-SDD-v1.0.md) · [Feature registry export](FEATURES.md)
- [Decision record on pinned requirement identities](decisions/ADR-039-REQUIREMENT-IDS-ARE-PINNED-BY-SUBJECT-ANCHOR.md)

Version diff 0.3.0 → 0.4.0: adds the reconciled rebuild blueprint entrypoint;
preserves canonical records and generated feature views.

Version diff 0.4.0 → 0.5.0 (2026-10-22): adds documentation profile and
filesystem indexes, identifies exact root and directory registers, and links
model-source evidence while keeping generated navigation and canonical records
separate.

Version diff 0.5.0 → 0.6.0 (2026-10-23): links the dated code/requirements
assessment and the explicit plan-cleanup inventory. Canonical authority and
delivery status remain in their existing sources.

Version diff 0.6.0 → 0.7.0 (2026-10-26): links the data-flow atlas as a visual
companion to the canonical data-pipeline map; it does not establish production
acceptance or replace the source registry.

Version diff 0.7.0 → 0.7.1 (2026-10-26): links the bounded Knowledge lifecycle
and serving assessment, keeping findings and test evidence separate from adoption.

Version diff 0.7.7 → 0.7.8 (2026-10-28): links the bounded Task4 requalification;
canonical requirements, historical qualification and production authority remain separate.
