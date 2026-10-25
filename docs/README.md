---
version: "0.21.0"
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
- [Engineering assessments](../reports/README.md) link the
  [2026-10-23 code/requirements gap assessment](../reports/gap-analysis-2026-10-23/README.md),
  [Thai parser/chunking experiment](../reports/oxr-thai-2026-10-25/README.md),
  [local Thai parser alternatives](../reports/oxr-thai-2026-10-25/alternatives/README.md),
  [real-document/native follow-up](../reports/oxr-thai-2026-10-25/real-native/README.md),
  [PaddleOCR-VL v1 parser-by-projection follow-up](../reports/oxr-thai-2026-10-25/paddleocr-vl-v1/README.md),
  [Hyper-Extract v1 candidate-evidence/native TEXT follow-up](../reports/oxr-thai-2026-10-25/hyper-extract-v1/README.md),
  [Hyper-Extract relation-evidence audit/companion pass](../reports/oxr-thai-2026-10-25/hyper-relation-audit-v1/README.md),
  [Hyper-Extract held-fact source audit/geometry recheck](../reports/oxr-thai-2026-10-25/hyper-fact-audit-v1/README.md),
  [Hyper-Extract source-native extraction/native comparison](../reports/oxr-thai-2026-10-25/hyper-extraction-repair-v1/README.md),
  [Hyper-Extract held-cell source/PDF-derived retrieval audit](../reports/oxr-thai-2026-10-25/hyper-held-cell-audit-v1/README.md),
  [economy PDF-native held-cell follow-up](../reports/oxr-thai-2026-10-25/hyper-economy-cell-repair-v1/README.md),
  and [GenesisRAG17 E5 fixed-batch resource experiment](../reports/oxr-thai-2026-10-25/e5-microbatch-v1/README.md).
  They record dated findings and verification limits without creating requirements or plans.
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

- [Proposed File Manager → Knowledge Vault → GenesisRAG17 → Agent flow](change-requests/integration/line-knowledge-memory-unified-flow-20261024.md)
  specifies local uploads, storage boundaries, customer/staff audiences, typed evidence
  and separate ingestion/Agent query sequences with explicit component ownership
  for review with unchanged price/stock authority;
  it does not amend canonical requirements or activate production memory.

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

Version diff 0.7.0 → 0.8.0 (2026-10-25): identifies separate ingestion and Agent
query views in the existing proposal, preserving component and permission boundaries.

Version diff 0.6.0 → 0.7.0 (2026-10-24–25): links the proposed unified LINE
Knowledge/Memory specification, extended with File Manager/Vault sources and
customer/staff audiences, without changing requirements or activation authority.

Version diff 0.8.0 → 0.9.0 (2026-10-25): links the isolated Thai OXR/parser/chunking assessment; no runtime or authority change.

Version diff 0.9.0 → 0.10.0 (2026-10-25): links local parser alternatives on the frozen Thai corpus; no production change.

Version diff 0.10.0 → 0.11.0 (2026-10-25): links public real Thai documents and isolated native ingestion/query evaluation; no production change.

Version diff 0.13.0 → 0.14.0 (2026-10-25): links the Hyper-Extract v1 candidate-evidence/native TEXT follow-up; no graph adoption or production activation.

Version diff 0.14.0 → 0.15.0 (2026-10-25): links the Hyper-Extract relation-evidence audit and bounded companion pass; no relation adoption, retrieval improvement or production activation.

Version diff 0.18.0 → 0.19.0 (2026-10-25): links the separate 37-row economy PDF-native retrieval follow-up; historical held OCR and production authority remain unchanged.

Version diff 0.19.0 → 0.20.0 (2026-10-25): links the paired E5 fixed-batch
resource experiment; embedding vectors and native retrieval results match,
with no application or production change.

Version diff 0.20.0 → 0.21.0 (2026-10-26): links the data-flow atlas as a visual
companion to the canonical data-pipeline map; the atlas does not establish
production acceptance or replace its source registry.
