---
doc_type: filesystem-inventory
status: active
version: "0.3.2"
checked_at: "2026-10-30"
checked_base_revision: "d804d28be37aa3b155da3144df99a2299856974e"
---

# Direct files under `docs/`

This register classifies the 42 tracked files directly under `docs/` at the
reviewed base and records one visual companion added by this change (43 files in
the resulting worktree). The entries record observed purpose, representative
exact-path readers found in the repository, and a safe disposition. Reader paths
are evidence of reference, not proof that a document is authoritative or current.
The inventory excludes nested, untracked, and ignored files; enumerate the
affected filesystem again before any later move or deletion.

| File | Observed role and status | Reader evidence | Disposition |
|---|---|---|---|
| [`.client-mutation-baseline.json`](../.client-mutation-baseline.json) | Machine baseline used by the documentation preflight; the file itself has no lifecycle field. | `apps/server/scripts/doc-preflight.mjs`; migration manifest. | Keep at the consumed path; update only through its owning baseline workflow. |
| [`.enum-copy-baseline.json`](../.enum-copy-baseline.json) | Machine baseline for enum-copy checks; not a prose specification. | `apps/server/scripts/doc-preflight.mjs`; migration manifest. | Keep at the consumed path; do not hand-edit to clear a check. |
| [`.id-ledger.json`](../.id-ledger.json) | Pinned issued-ID subject ledger; AGENTS.md documents the sanctioned `docs:ids` writer and prohibits manual edits. | `AGENTS.md`; document-ID tooling and registry migration manifests. | Keep fixed; change only through the sanctioned ID-ledger command and review. |
| [`.membership-writer-baseline.json`](../.membership-writer-baseline.json) | Machine baseline for canonical membership-writer checks. | `apps/server/scripts/doc-preflight.mjs`; migration manifest. | Keep at the consumed path; update only through its owning baseline workflow. |
| [`.roadmap-coverage-baseline.json`](../.roadmap-coverage-baseline.json) | Machine baseline for roadmap coverage checks. | `apps/server/scripts/doc-preflight.mjs`; migration manifest. | Keep at the consumed path; do not treat the baseline as delivery status. |
| [`.roadmap-evidence-baseline.json`](../.roadmap-evidence-baseline.json) | Machine baseline for roadmap evidence checks. | `apps/server/scripts/doc-preflight.mjs`; `apps/server/scripts/untracked-docs.mjs`; `docs/roadmap/ROADMAP.md`. | Keep at the consumed path; distinguish baseline evidence from current roadmap state. |
| [`.route-anchor-baseline.json`](../.route-anchor-baseline.json) | Machine baseline for route/document anchor checks. | `apps/server/scripts/doc-preflight.mjs`; route and domain tests. | Keep at the consumed path; update only with reviewed route/anchor evidence. |
| [`.route-viewer-baseline.json`](../.route-viewer-baseline.json) | Machine baseline for route-viewer checks. | `apps/server/scripts/doc-preflight.mjs`; `docs/PRD-SDD-v1.0.md`; route tests. | Keep at the consumed path; do not hand-edit as a substitute for implementation evidence. |
| [`.rwang-progress.md`](../.rwang-progress.md) | Historical GenesisRAG17 implementation progress, `version: 0.2.0b`, `status: beta`; its scope-complete wording and beta state need separate reconciliation. It is not byte-identical to the archive copy. | Migration source manifest and reintegration document inventory. | Preserve as evidence; do not infer current implementation state from its wording. Reconcile status only against dated code/test evidence. |
| [`.schema-migration-baseline.json`](../.schema-migration-baseline.json) | Machine baseline for schema-migration checks. | `apps/server/scripts/doc-preflight.mjs`; schema appendix and migration/design records. | Keep at the consumed path; it is not the current schema source. |
| [`.unreachable-state-baseline.json`](../.unreachable-state-baseline.json) | Machine baseline for unreachable-state checks. | `apps/server/scripts/doc-preflight.mjs`; Server Prisma schemas; ADR-077. | Keep at the consumed path; update only through reviewed evidence. |
| [`.viewer-fixture-baseline.json`](../.viewer-fixture-baseline.json) | Machine baseline for viewer-fixture checks. | `apps/server/scripts/doc-preflight.mjs`; Server unit/integration tests. | Keep at the consumed path; do not replace test evidence with a baseline edit. |
| [`ARCHITECTURE-DIAGRAMS.md`](../ARCHITECTURE-DIAGRAMS.md) | Architecture diagram collection with dated material; it is a view/evidence set, not the sole architecture authority. | `docs/architecture/README.md`; `docs/SYSTEM-DIAGRAM.md`; ADR-085; roadmap HTML. | Keep linked as a diagram set; confirm diagram revision before using it as current implementation evidence. |
| [`ARCHITECTURE-NOTES.md`](../ARCHITECTURE-NOTES.md) | Notes explicitly titled for `zuri-v2-lab`; historical architecture context rather than current implementation contract. | `docs/architecture/README.md`; PRD compatibility export; migration manifest. | Preserve as historical context and label its scope; do not use it to override accepted ADRs or current code. |
| [`ARCHITECTURE-TARGET-MODULAR-MONOLITH.md`](../ARCHITECTURE-TARGET-MODULAR-MONOLITH.md) | Draft target modular-monolith architecture; ADR-025 adopts its domain taxonomy, not every target statement. | `AGENTS.md`; `docs/architecture/README.md`; blueprint builder and PM architecture docs. | Keep as a draft target; cite the exact accepted ADR when deriving current constraints. |
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | Active current-build-boundary and architecture overview (`version: 1.0.1`). It is a summary, not a replacement for source-owned contracts. | `AGENTS.md`; architecture index; blueprint tooling; governance spec. | Keep as a linked overview; reconcile claims with accepted ADRs and implementation. |
| [`DATA-FLOW-ATLAS.html`](../DATA-FLOW-ATLAS.html) | Static visual companion generated from the 2026-10-25 checkout; 22 chain statuses and two blocked GitHub projection edges are a dated registry snapshot, not fresh deployment evidence. Its production-target note was added from ADR-114 on 2026-10-26 and does not establish target activation. | `docs/README.md`; `docs/DATA-PIPELINE-MAP.md`; `apps/server/runtime/data-pipeline-map.json`; ADR-114. | Keep as a derived view; refresh from canonical architecture, domain and pipeline sources, and preserve their status labels and authority. |
| [`DATA-PIPELINE-MAP.md`](../DATA-PIPELINE-MAP.md) | Beta data-pipeline map (`version: 1.1.0b`); ADR-085 names it in the knowledge/data-pipeline boundary. | ADR-085; `apps/server` code/tests; roadmap and system diagram. | Keep at its consumed path; validate individual flow claims against code/contracts before treating them as shipped. |
| [`DB-MIGRATION-NOTES.md`](../DB-MIGRATION-NOTES.md) | SQLite-to-PostgreSQL migration notes; historical migration evidence, not the current physical schema authority. | Server scripts/tests; database appendix and ERD; roadmap and runbooks. | Keep at its consumed path; use current Prisma schemas for current physical shape. |
| [`DOMAIN-MODEL.md`](../DOMAIN-MODEL.md) | Domain-model overview; explicitly points to `apps/server/prisma/schema.prisma` as current physical-model authority. | `scripts/build-llms-full.mjs`; roadmap projections; blueprint tooling. | Keep as a domain-model explanation; preserve the stated schema boundary and reconcile contradictory model drafts. |
| [`ERP-MODULE-MAP.md`](../ERP-MODULE-MAP.md) | ERP module mapping/reader view; it does not by itself establish domain ownership. | Domain charters; roadmap; PRD/FEATURES compatibility exports; `llms.txt`. | Keep as navigation/context; defer ownership to accepted domain charters and ADRs. |
| [`EXECUTION-MODES.md`](../EXECUTION-MODES.md) | Seven canonical execution-mode definitions referenced by the current agent/product instructions. | `AGENTS.md`; blueprint tooling; roadmap and plan artifacts. | Keep as the shared mode reference; do not add modes without an accepted change to its authority. |
| [`FEATURES.md`](../FEATURES.md) | Generated compatibility export of feature records; `AGENTS.md` says not to hand-edit it. | `AGENTS.md`; blueprint tooling; PM specifications and many repository readers. | Keep at the compatibility path; edit canonical records and regenerate through the approved writer workflow. |
| [`GAP-ANALYSIS-ZURI-GOVIBE.md`](../GAP-ANALYSIS-ZURI-GOVIBE.md) | Cross-repository comparison dated 2026-08-31; capability counts and recommendations describe that snapshot. | `docs/roadmap/ROADMAP.md`; reports; migration inventory. | Preserve as historical analysis, not current implementation status or an active plan. ADR-009 governs the GoVibe relationship; ADR-024 governs the standalone product boundary. |
| [`GOVERNANCE-LINK-METADATA.md`](../GOVERNANCE-LINK-METADATA.md) | Beta metadata/linking guidance for document relations and IDs. | `AGENTS.md`; governance index; change-request review records. | Keep as the applicable metadata guide subject to accepted migration/registry contracts. |
| [`GOVERNANCE-MODEL-SOURCES.md`](../GOVERNANCE-MODEL-SOURCES.md) | Active evidence rules for binding domain charters to repository-owned model sources. | `docs/README.md`. | Keep; newly linked from the main documentation entrypoint. |
| [`GOVIBE-INTEGRATION.md`](../GOVIBE-INTEGRATION.md) | Historical 2026-08-12 proposal for ongoing GoVibe governance/integration; it predates ADR-009. | `docs/GAP-ANALYSIS-ZURI-GOVIBE.md`; migration inventory and gap reports. | Preserve as history. ADR-009 supersedes its proposed ongoing integration with an optional owner-run one-time bootstrap and no live dependency. ADR-024 separately governs Zuri's standalone-product boundary; do not conflate them. |
| [`INTERFACE-INVENTORY.md`](../INTERFACE-INVENTORY.md) | Candidate interface inventory (`version: 1.42.0b`); it does not replace route or schema contracts. | `apps/server/scripts/doc-preflight.mjs`; `docs/ROUTES-SITEMAP.md`; governance index and route tests. | Keep at its path while consumers exist; treat candidate claims as unaccepted unless separately approved. |
| [`KNOWLEDGE-INGESTION-17-STAGE-FLOW.md`](../KNOWLEDGE-INGESTION-17-STAGE-FLOW.md) | Beta execution-flow explanation for the 17-stage ingestion pipeline. | Server runtime/domain-state; roadmap; features export; system diagram. | Keep distinct from the stage specification; verify runtime details against code and tests. |
| [`KNOWLEDGE-INGESTION-17-STAGE-SPEC.md`](../KNOWLEDGE-INGESTION-17-STAGE-SPEC.md) | Beta stage-level specification (`version: 1.4.7b`); distinct from execution flow and user-facing surfaces. | Architecture diagrams; repository README/`llms.txt`; gap analysis and other source docs. | Keep as the stage contract candidate; do not merge it with the flow or surface inventory. |
| [`KNOWLEDGE-INGESTION-SURFACES-AND-USER-FLOWS.md`](../KNOWLEDGE-INGESTION-SURFACES-AND-USER-FLOWS.md) | Beta inventory of ingestion surfaces and user flows; separate concern from stage behavior. | ADR-085; data-pipeline map; feature design and domain feature records. | Keep distinct and link to the stage spec/flow; do not duplicate their normative clauses. |
| [`PRD-SDD-v1.0.md`](../PRD-SDD-v1.0.md) | Generated compatibility export of canonical requirement records; it currently has a `draft` label, which describes the export metadata, not authority to hand-edit rows. | `AGENTS.md`; Server preflight and tests; repository readers. | Keep at its compatibility path; update source records through the approved registry flow, then regenerate. |
| [`PRODUCT.md`](../PRODUCT.md) | Active product boundary, purpose, hierarchy, and surface overview (`version: 1.5.0`). | `AGENTS.md`; repository README and `llms.txt`; registry and migration tooling. | Keep as product-level authority within accepted ADR precedence; avoid copying its requirements elsewhere. |
| [`README.md`](../README.md) | Hand-authored `docs/` entrypoint (`version: 0.4.0`). | Repository README; architecture index; blueprint tooling; `llms.txt`. | Keep as the human navigation root; link to canonical sources and indexes. |
| [`ROUTES-SITEMAP.md`](../ROUTES-SITEMAP.md) | Route/shell topology view. It is distinct in scope from the domain-to-subdomain navigation map. | `docs/SITEMAP-DOMAIN-NAV.md`; interface inventory; route tests and gap reports. | Keep separate from domain navigation; verify current routes against code and inventory. |
| [`schema.local.prisma`](../schema.local.prisma) | Logical/local starter schema, not the current Server physical schema; older manifest/source records still name it. | Migration source manifest and schema documentation. | Preserve provenance; use `apps/server/prisma/schema.prisma` for current Server model truth. Relocation/removal requires reconciling historical consumers. |
| [`SITEMAP-DOMAIN-NAV.md`](../SITEMAP-DOMAIN-NAV.md) | Domain-to-subdomain navigation map used as an accepted grouping source by Server configuration/structural checks; not route topology. | `apps/server` domain configuration/tests; `docs/ROUTES-SITEMAP.md`; interface inventory and plans. | Keep at the consumed path; do not collapse with `ROUTES-SITEMAP.md`. |
| [`STD-Multi agent workflow S-01.md`](../STD-Multi%20agent%20workflow%20S-01.md) | Retired developer-team controller proposal. `source-pins.json` preserves an admitted historical preimage hash; it does not assert that the current file bytes equal that hash. The runbook path is a navigation-only retirement pointer. | `docs/architecture/delivery-control/RETIREMENT.md`; `docs/runbooks/S-01.md`; ADR-113. | Preserve its historical source and pin; do not implement or treat its controller, global enforcement, or Mission Control closeout as active. |
| [`SYSTEM-DIAGRAM.md`](../SYSTEM-DIAGRAM.md) | System diagram snapshot; its code/test annotations associate it with verification, but the diagram itself is not runtime evidence. | Server related-test selection; data-pipeline map; registry and migration records. | Keep while referenced; confirm diagram freshness against source before claiming current topology. |
| [`UI-DESIGN-SYSTEM.md`](../UI-DESIGN-SYSTEM.md) | Zuri Heritage v2 design-system reference; ADR-010 is the accepted token decision. | Roadmap HTML/Markdown; PM interaction specification; `llms.txt` and change records. | Keep at the linked path; ADR-010 controls accepted tokens, and implementation remains subject to UI verification. |
| [`UI-PAGE-DIMENSIONAL-ATLAS.html`](../UI-PAGE-DIMENSIONAL-ATLAS.html) | Monochrome, NTS schematic drawing atlas for the 117 routes in interface inventory v1.43.0b, generated from source snapshot `d804d28`; unknown viewport extents remain `[TBD]`. | `docs/README.md`; `docs/INTERFACE-INVENTORY.md`; `docs/UI-DESIGN-SYSTEM.md`. | Keep as a derived visual companion; the inventory and application source remain authoritative for routes and geometry. |
| [`zuri_workspace_system.md`](../zuri_workspace_system.md) | Workspace/Space design explanation dated 2026-08-17; its old “implementation pending” label is stale for the core schema and authority flows, while FR-066 still tracks a Profile/Home UX correction. | `DOMAIN-MODEL.md`; current Server schema, services and unit tests; FR-043/066/067. | Keep as an explanatory design note, not a complete acceptance report. Current paths and evidence are linked in the document; preserve the remaining FR-066 UX follow-up. |
| [`ZURI-HARNESS-PLUGIN-SPEC.md`](../ZURI-HARNESS-PLUGIN-SPEC.md) | Harness/plugin specification superseded by ADR-110; retained references include code/roadmap evidence. | Migration registry; roadmap and repository annotations. | Keep as superseded history; ADR-110 controls current behavior. |

## Findings and limits

- Git enumeration at the reviewed base found 41 tracked direct files. This
  change adds one visual companion; the resulting worktree has 42 tracked direct
  files and no extra direct file. It also has the 20 registered direct directories.
- Exact-name reference scanning found path consumers for these sources, but a
  textual match does not prove semantic use. Dynamic paths and generated
  navigation must be checked before moving a source.
- `SITEMAP-DOMAIN-NAV.md` and `ROUTES-SITEMAP.md` cover different axes. The root
  S-01 remains a candidate. `runbooks/S-01.md` now points readers to it and to
  the active delivery policy; the old partial copy no longer competes as a
  second procedure. The source-pin hash is a historical preimage, not a claim
  about the current file hash.
- The Workspace design note's generic “implementation pending” label was stale:
  current schema, service and unit-test paths establish the core model and
  authority flows. The note now leaves the FR-066 Profile/Home UX correction
  explicitly open rather than claiming the entire flow is done.
- The GoVibe integration proposal and gap analysis are dated historical
  artifacts. ADR-009 governs the GoVibe development-time boundary; ADR-024
  governs Zuri's standalone-product boundary. They answer different questions.
- No file was moved or deleted in this pass. Several files have exact code,
  test, writer, registry, or generated-navigation path consumers. The inventory
  is not deletion approval and is not a recursive filesystem census.

## Version diff

0.1.0 → 0.2.0 (2026-10-22): Resolves the named S-01 duplicate, Workspace
currentness, and GoVibe lifecycle classifications using existing policy,
implementation, and accepted-decision evidence; keeps candidate and historical
authority boundaries explicit without inventing requirements.

0.2.0 → 0.3.0 (2026-10-26): records the visual data-flow atlas as a dated
derived view and reconciles the direct-file count; source authority stays in the
canonical architecture and pipeline records.

0.3.0 → 0.3.1 (2026-10-26): updates the architecture overview version and dates
the atlas production-target note separately from its 2026-10-25 flow/status
snapshot; the atlas remains a derived view, not deployment evidence.

0.3.1 → 0.3.2 (2026-10-30): records the 117-page UI dimensional drawing atlas
as a derived visual companion and refreshes the direct-file enumeration from
`d804d28`; interface and source authority remain unchanged.
