---
doc_type: documentation-requirements-specification
status: proposed
version: "0.1.2"
reviewed_base_revision: "1f1e5a0a7591f4e42646ebc33e78654a4e3477be"
reviewed_at: "2026-10-22"
---

# Zuri documentation requirements specification

**Status: Proposed.** This specification defines document profiles and single-source boundaries for review. It does not amend product requirements, issue IDs, or ownership; move existing sources; approve candidate documents; or claim conformance to an external standard.

## 1. Purpose

Zuri documents answer three separate questions:

- Which business domain owns a rule or capability?
- Which canonical record states a requirement or decision?
- Which service, route, schema, test, plan, or historical artifact implements or explains it?

A folder, filename, navigation item, service name, or generated index alone does not create ownership or requirement membership.

This proposal follows [ADR-025](../decisions/ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md), the active [canonical record format](../migrations/document-reintegration/CANONICAL-FORMAT.md), and the [document registry index](../../registry/document-registry/index.json). It does not replace them.

## 2. Source-of-truth boundaries

| Question | Authoritative source | A view or locator only |
|---|---|---|
| Product purpose, boundary, hierarchy, and surfaces | [PRODUCT.md](../PRODUCT.md) and accepted product decisions | Product summaries in domain, service, or feature documents |
| Requirement statement and lifecycle | The canonical per-ID record at the path selected by the registry and canonical format | Registry index, compatibility export, domain SRS, feature map, trace map, or search result |
| FEAT-to-FR membership | Explicit membership in the canonical FEAT record and registry | Folder name, nearby prose, route, code location, or guessed owner |
| Business-domain ownership | The existing [domain charter](../domains/README.md) and accepted decisions | Service boundary, UI tab, feature folder, or inferred model ownership |
| Service execution across domains | The owning service SERVICE.md and TESTING.md | Domain charter or service map |
| Accepted architecture choice | Accepted ADRs in [decisions](../decisions/) | Candidate, proposal, diagram, plan, or implementation |
| Exact API, event, and data shape | The source-owned schema or contract selected by its accepted authority | Route inventory, diagram, screenshot, or prose summary |
| Implementation and verification | Current code, scoped tests, and dated evidence for the exact revision | Roadmap status, old test receipt, mock, or generated coverage view |
| Current delivery status | [ROADMAP.md](../roadmap/ROADMAP.md) | 24-week projection, HTML snapshot, plans, or old reports |
| File existence | Repository filesystem and Git inventory | README, canonical-ID registry, and generated document graph |

Canonical record locations are defined by CANONICAL-FORMAT.md:

- FEAT: one record at docs/features/FEAT-nnn/feature.md.
- FR with explicit FEAT membership: one record at docs/features/FEAT-nnn/requirements/FR-nnn.md.
- Unbundled FR and NFR, BR, SEC, or SDD: docs/requirements/<ID>.md.

Use that format exactly. The generated registry index locates canonical records; it is not an inventory of every Markdown, JSON, image, or historical file. PRD-SDD-v1.0.md and FEATURES.md are generated compatibility exports, not authoring sources.

## 3. Domain, feature, module, and service

- **Business domain:** business-meaning and ownership boundary; a confirmed domain has one charter under docs/domains/<domain>/.
- **Feature:** product capability represented by a canonical FEAT record and explicit FR membership; a feature can cross service boundaries.
- **Code module:** implementation boundary that may live inside a service; it does not automatically become a business domain.
- **Service:** execution, dependency, and verification boundary that may support several domains.
- **Navigation group:** a user-facing arrangement that can group domains or features without owning business data.

The intended reading experience is domain-first. Canonical records retain the identity-based paths required by the accepted registry format. Do not relocate records to make the tree look domain-shaped. A domain SRS provides a linked reading view.

## 4. Document profiles

| Profile | Applicability | Required sections and source rule |
|---|---|---|
| Product overview | Always | PRODUCT.md: purpose, product boundary, hierarchy, surfaces, invariants, and links to accepted decisions and canonical requirements. Do not restate every FR. |
| Canonical requirement | One per issued FEAT, FR, NFR, BR, SEC, or SDD | Follow CANONICAL-FORMAT.md exactly. Preserve identity, source statement, lifecycle, provenance, and explicit membership. |
| Domain charter | One per confirmed product domain | CHARTER.md: mission, owns/does-not-own, process or subdomain boundaries, collaborations, data authority, and canonical links. Do not infer or mint an ID from a folder name. |
| Domain SRS view | One per domain when canonical requirements are assigned and need a consolidated domain reading view | Document control; purpose and boundary; verified process-to-FEAT/FR map; exact canonical ID/path/lifecycle index; contract and ADR links; test/evidence references; exclusions and conflicts; change history. Normative text and acceptance criteria stay in canonical records. One SRS per domain, never one per feature. |
| Domain PRD | Not required by default | Only if an approved product outcome or market context is absent from PRODUCT.md and the charter. Link canonical records; do not copy their requirements. |
| Feature explanation | Only when rationale, alternatives, constraints, or audience context adds value | Existing feature.md location; exact canonical links. No file is required when no explanation needs preservation. |
| Service documentation | Each service registered by docs/services/README.md | SERVICE.md: responsibility, dependencies, contracts, runtime and failure boundaries. TESTING.md: scoped checks and evidence limits. Neither claims business ownership or duplicates FRs. |
| Decision record | When an architecture or product choice needs alternatives and consequences | ADR lifecycle and template. Candidate or proposal is not binding. |
| API/data contract | When an interface or persisted shape needs precision | Keep the exact schema at its source-owned path; prose and route lists do not replace typed contracts. |
| UX and navigation | When user journeys, visual tokens, routes, or domain navigation need a source | Keep visual system, business hierarchy, and route topology separate; link between them. |
| Plan and roadmap | When work is proposed or sequenced | Plans describe bounded scope and assumptions. ROADMAP.md alone owns current delivery state. Plans do not create requirements or override roadmap status. |
| Operations and historical evidence | When a procedure, migration, receipt, or past decision must be retained | Keep it in its registered operations, changes, migrations, or archive location. Label historical/candidate evidence. |
| Index and template | When readers need navigation or writers need a repeatable shape | Indexes locate files and gaps; templates provide headings. Neither creates rules, IDs, ownership, approval, or delivery status. |

## 5. Domain SRS rules

A domain SRS is a source-linked reading view, not another editable requirement source.

1. Use the domain identifier exactly as declared by its owning source. Missing or conflicting identifiers remain unresolved.
2. Map only source-backed processes and capabilities to canonical FEAT and FR records. Leave ownership unassigned when sources do not decide it.
3. List exact canonical IDs, source paths, lifecycle, applicability, and controlling accepted decisions. Do not paraphrase normative behavior or copy acceptance criteria.
4. Link exact service documents, schemas, APIs, and ADRs.
5. Link tests and dated evidence without treating a link as proof. State revision and result only when verified.
6. Record exclusions and conflicts with their source paths; do not invent a resolution.
7. Keep a change history with the reviewed source revision.

A feature may appear in multiple reader views only when each view points to the same canonical record. Do not create another FR ID or a second copy of the normative statement.

## 6. Layout and navigation rules

- docs/README.md is the entrypoint to authorities and manual indexes.
- docs/domains/<domain>/CHARTER.md is the ownership entrypoint; an applicable SRS sits beside it.
- docs/domains/<domain>/features/ is optional rationale, not an alternate FR registry.
- docs/features/ and docs/requirements/ follow the canonical record format and registry paths.
- docs/services/<service>/ owns service execution explanations and verification rationale.
- docs/decisions/ owns ADRs; docs/plans/ holds individual plans; docs/roadmap/ROADMAP.md owns delivery state.
- docs/templates/ contains shapes only.
- Direct files under docs/ are established entrypoints, compatibility files, machine data, or legacy artifacts, not an open authoring location. The [root-file register](ROOT-FILE-REGISTER.md) lists every tracked direct child at its reviewed revision. Listing proves discoverability only; it does not grant authority or approval. Do not add new standalone documents at docs/ root. First select a registered profile and destination. Relocate existing files only after checking canonical readers, generated navigation inputs, and all path consumers.
- Generated views remain generated and are not edited as source.

A missing index entry is a registration gap, not proof that a file does not exist. Files outside the canonical-ID registry may still be valid decisions, service docs, plans, receipts, contracts, or historical artifacts; classify before moving or deleting them.

## 7. Gap classification

Classify each problem before changing content:

- **Missing artifact:** an applicable profile has no qualifying source.
- **Missing link:** the source exists but an index or parent does not point to it.
- **Conflicting sources:** documents disagree; cite both, follow accepted authority, or leave the conflict open.
- **Unclassified artifact:** purpose, lifecycle, or owner is not evidenced.
- **Stale view:** a projection or snapshot does not match its declared source or revision.
- **Unassigned ownership:** available sources do not establish a domain or service owner.

Do not choose the newest filename, duplicate content under a new title, or invent metadata. Preserve evidence until its consumers and provenance have been checked.

## 8. Current inventory findings

At the reviewed base revision, filesystem enumeration found 15 domain folders and 15 CHARTER.md files. Three domain folders contain SRS.md: asset-management, line-oa-studio, and market-intelligence. The Project Manager SRS is a separate candidate at docs/architecture/project-manager-system/17-SRS.md. No domain folder contains PRD.md.

This is an inventory, not a claim that all 12 domains without SRS must receive one. Map canonical ownership first. The three existing domain SRS documents contain local AM-RQ, LOS-RQ, or MI-RQ labels and distinguish them from global IDs. This proposal does not adopt, rewrite, or delete those clauses. See the [domain inventory](../domains/README.md).

The same filesystem enumeration found 41 tracked direct files and 20 direct folders under docs/. The [root-file register](ROOT-FILE-REGISTER.md) records each file's declared status, known path readers, disposition, and unresolved lifecycle or authority conflicts; the [directory register](DOCS-DIRECTORY-REGISTER.md) records the entrypoint serving every direct folder. Six folders had a direct README at the reviewed base; this pass adds five local indexes (domains, plans, roadmap, templates, prompts), leaving nine folders without a direct README. Each of those nine has a named generated or canonical index, or the existing `archive/00-START-HERE.md`. Several root files have exact code/test path consumers or generated-index links, so relocating them requires updating readers and regenerating the affected views together.

The root-file review reconciled three previously open classification gaps using existing authorities and current source evidence. The S-01 runbook path now points to the candidate root standard and the active delivery policy without duplicating workflow text. The Workspace design note now records that core model/authority flows are implemented while the FR-066 Profile/Home UX correction remains open. The GoVibe integration proposal and its gap report are labeled as historical material: ADR-009 governs GoVibe's development-time relationship, while ADR-024 governs Zuri's standalone-product boundary. No requirement or new architecture decision was invented.

The 24-week Markdown identifies itself as a derived projection from ROADMAP.md. Its HTML is a static historical snapshot measured at commit 7d8c9d0 on 2026-08-23, not a current rendering. See the [roadmap index](../roadmap/README.md).

## 9. Authoring workflow and checked boundaries

Before creating, replacing, moving, or deleting a document, enumerate files at the affected filesystem scope. Compare tracked and untracked paths, read the exact existing file and current diff, then inspect its parent authority and known readers. README, the canonical-ID registry, and generated graph are not a complete filesystem inventory.

The initial inventory phase established profiles and indexes without changing generator behavior. In a separately authorized follow-up on 2026-10-22, the existing `docs:graph` and `docs:preflight` scripts were updated to enforce only these source boundaries:

- `docs:graph` reads requirement and feature meaning, lifecycle, and membership from canonical per-ID records resolved through `registry/document-registry/index.json`. `PRD-SDD-v1.0.md` and `FEATURES.md` remain compatibility exports and are not semantic inputs.
- `docs:preflight` validates the canonical index and records, checks the direct `docs/` file and directory registers against live filesystem entries, and reports drift without moving or deleting anything.
- Domain SRS validation is opt-in through `doc_type: domain-srs-view`. It checks the declared source charter, required profile sections, exact canonical record paths, the document graph's normalized canonical lifecycle (`current`, `planned`, or `superseded`), and FEAT-to-FR membership. Legacy SRS files without that marker are not reinterpreted; missing SRS coverage is not inferred as a gap or failure.
- An SRS domain identifier must match `domain_id` explicitly declared by its charter. If the charter has no such identifier, the SRS remains unresolved until the authority is reconciled; the checker does not derive an owner or ID from a folder name.

These checks do not make this proposed specification an accepted product requirement, create a requirement that every domain needs an SRS, or authorize cleanup of an unregistered path. The graph and preflight commands still have their existing generated-output behavior; do not describe them as read-only. Focused tests can exercise the new validators without regenerating live graph, preflight, or governance outputs.

## 10. References

- [ADR-025 — Domain-driven documentation architecture](../decisions/ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md)
- [Canonical document record format](../migrations/document-reintegration/CANONICAL-FORMAT.md)
- [Document link metadata](../GOVERNANCE-LINK-METADATA.md)
- [Reconciled build blueprint](../architecture/blueprint/README.md)
- [Product overview](../PRODUCT.md)
- [Domain index](../domains/README.md)
- [Service documentation index](../services/README.md)
- [Roadmap index](../roadmap/README.md)

## Version diff

0.0 → 0.1.0 (2026-10-22): Defines Zuri document profiles, authority boundaries, linked domain SRS structure, file-system gap classes, and observed domain/roadmap gaps. Proposed only; no canonical requirement or ID changes.
0.1.0 → 0.1.1 (2026-10-22): Records the completed source reconciliations for S-01, Workspace implementation status, and historical GoVibe artifacts without adding requirements or architecture decisions.
0.1.1 → 0.1.2 (2026-10-22): Records the separately authorized canonical-registry graph source, direct-filesystem inventory checks, and opt-in linked-SRS validation boundaries.
