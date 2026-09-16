---
id: ZAI:PM-SYSTEM-EVIDENCE
title: Project Manager design evidence and review record
version: "0.8.0b"
status: candidate
created_at: "2026-09-15T23:49:58+07:00,RWANG,base 087f3025"
last_update: "2026-09-16T15:39:25+07:00,RWANG"
superseded_by: null
attributes:
  doc_type: design-review
  domain: project-manager
relations:
  - type: references
    target: ZAI:PM-SYSTEM-DESIGN
---

# Evidence & Review

**Version:** 0.8.0b · **Status:** Candidate
Source snapshot: `087f30258a6831865afd751e28804e36505aff30`
Design worktree: `codex/project-manager-system-design-20260915`

## 0. Earlier navigation taxonomy review — historical evidence

**Latest source-semantics review:** [Document 14](14-EXISTING-PROJECT-TAB-SEMANTICS.md) inspects current source `966304624717e6888dd3447e35bc7662f0ff9e0b` and preserves nine declared tabs, fourteen routes and seven Work views. Inventory is an operational read model; Resources/Risks are planned; Team exposes Business Membership authority. A six-file unit-test attempt stopped at sandbox/esbuild config loading, before any tests ran; it is NOT_RUN. No shared Prisma-client regeneration or product mutation was attempted as a workaround.

[Document 13](13-DOMAIN-TAXONOMY-AND-NAVIGATION-BOUNDARIES.md) records the owner's Domain → subdomain/module → tabs clarification. Current source was read at `000b26f1000fe178b06282db83f2ed6cb1b60f47`; targeted diff against the design baseline found no changes in domains.js, ProjectTabs, WorkViewTabs, Sidebar, PM charter or ADR-069/071. Official documentation from Odoo, Microsoft, Jira, Linear, Notion, Trello and monday.com was inspected for comparison, with page links in that supplement.

The earlier contextual-sidebar/removal-of-tabs recommendation is withdrawn. Historical prototype passes below remain evidence about v0.3 only. The new taxonomy's TAX-A1–A10, remapped navigation models and product/UI acceptance are NOT_RUN. Source evidence establishes existing structure; it does not establish usability causation or production readiness. The RCA now distinguishes the confirmed error in our proposal from untested explanations of user confusion.

## 1. Evidence method

Enumerated tracked docs/source/routes/models with `git ls-files`, read parent decisions and peer charters, then inspected relevant source seams. No live provider, production database or external executor was activated or tested. No secret files were read.

Current source presence is reported separately from declaration and runtime readiness. Historical registry/charter prose may lag source, so neither old “implemented” nor old “not built” text alone is treated as current operational proof.

## 2. Parent and peer evidence

All paths below are repository-root relative. They are source pointers, not claims every named feature passed runtime tests here.

| Evidence | Finding / design consequence |
|---|---|
| [PRODUCT](../../PRODUCT.md), [PM charter](../../domains/project-manager/CHARTER.md) | PM owns scope/planning and one intake path; preserve existing services |
| [ADR-025](../../decisions/ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md), [FEATURES](../../FEATURES.md) | Domain ownership and feature bundles are separate; IDs immutable |
| [ADR-026](../../decisions/ADR-026-AGENT-TOPOLOGY-FOR-THE-VISUAL-OFFICE.md) | Domain desks, two layers, single writer/lease; developer agents distinct from LINE runtime |
| [ADR-076](../../decisions/ADR-076-ERP-CANONICAL-ORGANIZATIONAL-HIERARCHY-AND-SCOPE-VOCABULARY-ALIGNMENT.md) | Group/Organization/Business labels, Workspace restored, Branch never Tenant |
| [Target architecture](../../ARCHITECTURE-TARGET-MODULAR-MONOLITH.md) | Domain taxonomy/ownership adopted; older runtime/database proposals remain draft unless separately accepted |
| [Integration charter](../../domains/integration/CHARTER.md) | Owns general Pipeline ledger and credential boundary; avoid duplicate PM run authority |
| [Agent charter](../../domains/agent/CHARTER.md) | Business LINE turn/context/evidence orchestration; no database superuser |
| [Platform Control charter](../../domains/platform-control/CHARTER.md) | Operator projection separate from Business Project Manager |
| [FR-070](../../domains/project-manager/features/FR-070-stable-execution-domain-and-tag-identities.md) | Plan IDs, execution IDs, primary domain and technical owner already distinguished |
| [FR-019](../../domains/project-manager/features/FR-019-enterprise-api.md) | API generated from runtime Zod schemas; visual layer must reuse authority |
| [FR-082 pipeline canvas](../../domains/project-manager/features/FR-082-pipeline-canvas.md) | Work dependencies have their own contract/acceptance semantics; architecture graph remains a separate projection |
| [ADR-081](../../decisions/ADR-081-GENERATED-VIEWS-ARE-BUILT-NOT-COMMITTED.md) | Generate/check docs; do not hand-maintain or commit generated views |
| [ADR-089](../../decisions/ADR-089-BROWSER-WRITE-ONLY-CREDENTIAL-VAULT-AND-SELF-SERVE-LINE-OA-ONBOARDING.md) | Reuse SecretStorePort and lifecycle; new provider profile does not bypass write-only storage |
| [PRD-SDD](../../PRD-SDD-v1.0.md) | FR-242 covers new credential kinds, not full provider registry/gateway; new requirements still needed |

## 3. Source seams inspected

| Root-relative source | Status in this review |
|---|---|
| apps/server/src/modules/project-manager/application/ and import/ | SOURCE_PRESENT; services/read models and one import writer enumerated |
| apps/server/src/modules/project-manager/api-docs/openapi.js | SOURCE_PRESENT; OpenApiGeneratorV3 and route inventory read |
| apps/server/src/app/api/docs/route.js | SOURCE_PRESENT; generated spec and authentication seam read |
| apps/server/prisma/schema.prisma | SOURCE_PRESENT; PipelineRun/Step, IntegrationProvider/Connection/Credential fields inspected |
| apps/server/src/modules/agent/model-provider-catalog.js | SOURCE_PRESENT; public LINE allowlist and local-eval provider separation read |
| apps/server/src/modules/agent/context-composer.js | SOURCE_PRESENT by enumeration; not revalidated live |
| apps/server/tests/integration/openapi-docs.test.js | TEST_FILE_PRESENT; not executed during this docs-only task |
| apps/server/tests/unit/integration/secret-store-port.test.js and credential tests | TEST_FILES_PRESENT; not evidence of current live vault operation |
| apps/server/scripts/doc-graph.mjs and doc-preflight.mjs | Existing governance entrypoints inspected and baseline executed |

New fleet inventory/lease profile/gateway operations in this package are **PROPOSED**. Enumeration of the named current module/route inventories did not establish a complete implementation of this proposed contract; no blanket claim is made that the repository lacks all agent or workflow infrastructure.

## 4. Standards used

- [OpenAPI 3.0.3](https://spec.openapis.org/oas/v3.0.3.html): chosen compatibility profile, not a claim it is the latest standard
- [Swagger UI configuration](https://swagger.io/docs/open-source-tools/swagger-ui/usage/configuration/): documentation/submit/auth-persistence configuration
- [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) and [authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization): pinned candidate MCP profile
- [Ollama authentication](https://docs.ollama.com/api/authentication) and [vLLM compatible server](https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/): local/private inference boundaries

Sources were checked during design. Capabilities/versions must be probed again for the exact adapter release selected at implementation; source documentation is not a deployment attestation.

## 5. Verification record

Baseline `npm run govern` completed with exit 0: 0 critical, 22 warning, 24 info; 404 docs; five existing dangling test fixture references. Most baseline link warnings concern generated `llms-full.txt` not yet built in a fresh worktree. These are not new design failures.

Final document and contract verification is recorded below after authoring. Product acceptance suites remain PLANNED / NOT_RUN; no application source, Prisma schema, canonical registry subjects or production configuration is changed by this package.

### Original 0.1.0b contract and visual checks — 2026-09-16 Asia/Bangkok

| Check | Result | Limits |
|---|---|---|
| OpenAPI structure and references | VALID: 52 paths, 72 operations, 98 schemas; Swagger Parser 12.1.0 | Describes proposed additions; not API runtime acceptance |
| Workflow JSON Schema and example | VALID with Ajv 8 / Draft 2020-12 | Example is explicitly synthetic and cannot dispatch |
| Workflow semantic sample | DAG, role/domain bindings, input dependencies and result output resolve | Broader runtime cases remain PMT implementation tests |
| Executable payload rejection | Unknown command field rejected by schema | Does not prove executor sandbox behavior |
| Architecture model | 15 nodes / 20 directed typed edges, all refs and write owners resolve | Target logical graph, not live topology |
| Requirement traceability | 32 PMR → 32 PMT families; operation IDs resolve | PMR/PMT are proposal IDs, canonical promotion pending |
| Local document links | 34 local Markdown links resolved in repository context | External citations were read during design; not continuously monitored |
| Mermaid | 8 diagrams parsed and rendered with Mermaid 11.16.1 in Playwright Chromium | Screenshots/vector output are review artifacts outside tracked source |

Two sequence-diagram labels used semicolons that Mermaid interpreted as statement separators; the renderer caught them and the labels were corrected before final verification. The diagrams' meaning did not change.

### Original 0.1.0b governance and scope

After staging only this package, `npm run govern` completed with exit 0: **0 critical, 1 existing warning, 24 info** across 413 documents. The remaining warning is the same five dangling test-fixture references present in the baseline; no new warning remains. `docs:llms` builds the previously missing generated corpus. Runtime route count (281), test file count (745) and 669 pinned canonical IDs are unchanged.

The reviewed change adds 14 source documents/contracts in this architecture package. Generated graph/corpus and rendered diagram artifacts are not staged. Application tests, live providers, executor hosts, migrations, deployment and activation remain NOT_RUN / NOT_CHANGED in this task.

### Navigation refinement 0.2.0b — 2026-09-16 Asia/Bangkok

The same baseline SHA was verified against the primary checkout. The two owner-supplied screenshots were inspected, followed by the live source navigation definitions, project route templates, ADR-011/012/036/069/071/076, the PM charter and navigation tests. [Navigation refinement](09-NAVIGATION-REFINEMENT.md) now provides the complete menu mapping and the narrow candidate amendment to the prior persistent-sidebar rule.

| Check | Result | Limits |
|---|---|---|
| Current-page coverage | 8 Business sidebar destinations; 14/14 project page templates; 7 existing Work views; 7 canonical modes | Static source enumeration, not runtime coverage |
| Navigation model | 41 unique local destination IDs; 25 source-page references resolve; referenced PMR IDs resolve | Candidate model, not imported by application |
| Contract checks after refinement | OpenAPI/workflow/architecture/traceability remain valid; all local package links resolve | Previous API/run contracts retain 0.1.0b |
| Diagram rendering | All 9 Mermaid blocks render, including G07 navigation/scope | Review SVG/PNG output only |
| Interactive review artifact | 11 check groups pass in Playwright Chromium 1148 | Tests the local documentation prototype only |
| Desktop/mobile behavior | Existing entries, Work/mode selection, separate Domain/Feature pages, proposed states, shared-registry link, mobile drawer focus and view selector checked | 390 px and 756 px reflow plus 1512 px desktop; not a browser 200% zoom certification |
| Browser requests/errors | No JavaScript errors; only the local review HTML was requested | No product API, provider or production access |
| Governance after refinement | Exit 0; 414 docs; 0 critical, 1 existing warning, 24 info | Same five dangling fixture IDs; 281 routes, 745 test files and 669 canonical IDs unchanged |

The focus check initially read the active element before the native dialog close event ran after re-rendering a menu selection. A diagnostic recorded the immediate body focus with no close event, then focus on the new menu opener when the event arrived. The verifier now waits for that explicit focus condition; it retains the same focus assertion and adds no arbitrary sleep.

Review artifacts are outside the repository under the task's local `pm-design-qa` directory: `navigation-review.html`, `navigation-model-verification.json`, `navigation-preview-verification.json`, `contract-verification.json` and `diagram-verification.json`. The preview is local, not a public share link.

The complete staged proposal contains 16 package files (10 Markdown documents plus 6 machine-readable contracts) and one separate navigation RCA. This refinement adds 3 source files and updates 4 earlier proposal documents. Application source, route handlers, tests, database schema, canonical registries and deployment state remain unchanged. Product NAV-T01–T14 tests remain **PLANNED / NOT_RUN**.

### UX/UI and wireframes 0.3.0b — 2026-09-16 Asia/Bangkok

The owner supplied a Business Goal / UX Goal / journey reference and a vertical-form comparison. Both images were inspected. The design adopts the planning structure and form-reading principles while retaining Zuri Heritage; image claims about fixation counts are not treated as PM research. The accepted UI Design System, globals.css, edit-only ProjectModal and objective-first projects/new page were read against the candidate contracts.

| Check | Result | Limits |
|---|---|---|
| UX/UI source deliverable | Three new documents: strategy/journeys, UI interactions, wireframes/screens; one candidate machine model | Candidate documentation; no app code |
| Screen coverage | 37 screen families; all 41 PM destination IDs plus one shared Business registry entry (42 total); 10 journeys | Screen/model coverage, not product implementation |
| Form binding | 13 forms / 83 fields; names, requiredness, enums, bounds and scalar/date-time/array control compatibility checked | 12 candidate schemas plus existing objective-first creation; nested editor/server validation still required at implementation |
| Contrast | Chosen body/action pairs pass calculated normal-text threshold; white-on-amber and old blue-body pair rejected for that role | Token calculation, not full WCAG certification |
| Browser artifact | 14 check groups PASS; 148 visits across 37 screens at 1512/1024/756/390 px; 58 variants; 8 state scenarios | Playwright Chromium 1148; docs prototype only |
| Interactions | Screen/API search, 10 journeys, native form error focus, conditional MCP/provider fields, fractional risk input, keyboard graph selection, node/edge inspector, key metadata separation and mobile drawer focus pass | Synthetic records; no real mutations or provider probes |
| Graph/API presentation | 15 nodes / 20 edges available as accessible lists; selected graph projections; all 72 operations searchable from the same OpenAPI | Wireframe is a proposed API Explorer, not installed Swagger runtime |
| Runtime isolation of artifact | No JavaScript errors; only local HTML requested; no product/external API requests; no local/session storage writes | CSP preserved; one-time secret field disabled/synthetic |
| Document contracts | OpenAPI 52 paths / 72 operations / 98 schemas, workflow example/schema, architecture and 32 PMR→PMT families remain valid | Existing API/run contracts retain version 0.1.0b |
| Diagrams | All 11 Mermaid blocks parse/render; new journey diagrams use vertical layout | Local SVG/PNG review output |
| Governance | Exit 0; 417 docs, 0 critical, 1 existing warning, 24 info; 281 routes, 745 tests, 669 canonical IDs unchanged | Same five dangling fixture IDs as baseline |

The SVG activation and filter visibility defects, schema/control corrections and Business review-scope mismatch are documented in the [artifact RCA](../../../.brain/rca/2026-09-16-pm-wireframe-interaction-defects.md). The final checks retain the keyboard/visibility assertions. Native dialog verification waits for the explicit collapsed-and-focused opener condition after the close event; it neither adds arbitrary delays nor relaxes CSP.

**Contract gate:** Enumerating the 52 candidate paths and 98 schemas confirmed that ReviewInput is Project-scoped and has no Business routing-policy review operation. WF-37 inspects policy references and disables policy administration. Bind an owner contract before P3 enables this action; never reuse a Project review grant. OAuth client credential forms and executor enroll/revoke owner bindings also need their profile-specific review before those controls are implemented.

The complete proposal now stages 20 package files (13 Markdown + 7 machine contracts) and two RCA records, 22 files total. This UX/UI increment adds five files including its RCA and updates the earlier package entry/review documents. Generated governance outputs and browser artifacts remain outside the staged diff under ADR-081. No application source, route, test, database schema, canonical ID ledger or production configuration changed.

Local review files: ux-ui-wireframes.html, ux-ui-model-verification.json, ux-ui-preview-verification.json, contract-verification.json and diagram-verification.json in the task pm-design-qa directory. Product NAV-T01–T14 and UI-T01–T14, native browser zoom, assistive-technology review, live APIs/hosts, deployment and user research remain PLANNED / NOT_RUN. This is a local artifact, not a public or Claude share URL.

## 6. Approval checklist

**UX/UI supplement:** review [UX goals/journeys](10-UX-STRATEGY-AND-JOURNEYS.md), [UI interactions](11-UI-SYSTEM-AND-INTERACTIONS.md), [screen/form specs](12-WIREFRAMES-AND-SCREEN-SPECS.md) and their contract gates. Approval of layout does not authorize unbound policy administration or deployment.

**Current priority:** review [Navigation refinement](09-NAVIGATION-REFINEMENT.md), NAV-D1–D8, all existing-route mappings and NAV-P1 acceptance. This approval may be navigation-only. It proposes an explicit amendment to ADR-011's persistent Business-sidebar presentation while keeping the Business shell-scope ceiling. It is not approval of the full-system checklist below.

The owner is reviewing these concrete choices:

1. Scope: zuri-ai PM extension with separate Domain/Feature views and two execution kinds
2. Boundaries: PM definitions/UI; Integration durable execution/provider ports; Identity keys/authority; existing Agent/Knowledge/Platform Control boundaries preserved
3. ADR-026 domain desks and two layers retained; no adaptive scheduler or recursive fleet hierarchy in initial scope
4. Pipeline ledger reuse with an isolated PM workflow profile and explicit compatibility tests
5. Self-host inference gateway and MCP as separate connector contracts; public LINE allowlist unchanged
6. Candidate SLO/retention/budget defaults and the P0–P7 delivery order
7. P0 registration of new canonical IDs and phased implementation entry gates

Approval of documentation is not a claim of accepted runtime readiness. Code, schema changes, external connections, deployment and activation require the corresponding concrete slice/release authorization.

## 7. Out-of-scope observations

- Some charter/PRD status prose is older than source presence; reconciled here as evidence status, not edited broadly
- The primary checkout is a shared detached reference tree; work is isolated per CLAUDE.md
- Baseline governance warnings were retained and compared; unrelated debt is not rewritten to make this proposal look clean

## 8. Workforce requirement evidence — 16 September 2026

- New source snapshot: primary checkout HEAD `0f5a47fcf2b8b4e846edbc67f2a051c6673e4b83`; read-only. Candidate remains on isolated base `087f3025`.
- Inspected actual WorkItem, Team/TeamMembership/ProjectTeam, Employment, Team service, FR-036/042/064/089/193 and PM charter. `activeWorkItems` counts nondeleted assigned rows without a status predicate; old field is not a reliable open-work metric. Focused `project-team-service.test.js` covers Membership behavior, not workload formulas. No claim that the entire repository lacks other related tests.
- [15 Workforce planning & performance](15-WORKFORCE-CAPACITY-SCHEDULE-AND-PERFORMANCE.md) captures PMR-033 with G14, six candidate screens, twelve metrics, typed eight-operation contract and sixteen acceptance cases. Requirement intent comes from the owner; implementation design is not yet approved.
- Local verification: both OpenAPI candidates VALID (60 paths / 80 operations / 125 schemas), 33 requirement/test families, 16 Markdown documents and 14 Mermaid diagrams. Synthetic workload/performance examples validate; documented arithmetic, unknown-field rejection and partial/zero-capacity shapes checked. Four review tabs, person/team selection, plan preview/reset, schedule, metric evidence, keyboard tabs and incoming review link passed; 1440/390/780px layouts have no document overflow, broken anchors or page errors. Product tests PLANNED / NOT_RUN; these checks exercise documents and the synthetic artifact only. The staged document governance pass completed with exit 0, zero critical findings and one unchanged warning for five existing fixture references; canonical IDs remain unchanged. The final diagram layout is rechecked after its readability revision. No retry of the earlier shared-node_modules unit startup failure, no product mutation or production claim.
- External design basis: Microsoft Research SPACE publication opened successfully; Asana official help search extract available, direct page returned CSS error. These support design reasoning only, not claims that our proposed feature is implemented.

## 9. API/spec completeness audit — 16 September 2026

[16 Spec readiness & API reference](16-SPEC-READINESS-AND-API-REFERENCE.md) enumerates the candidate files and records SPEC-G01–G09. Both OpenAPI files validate structurally: 60 paths, 80 operations and 125 API schema definitions. This count is not a database model count or evidence that all workflow contracts are complete. No functional contract was changed by this audit.

The local review adds actual Swagger UI 5.32.15 with a definition selector, parameter/request/response/schema rendering and linked synthetic response examples. Package assets are pinned and locally served; installation scripts/analytics are disabled. Viewer uses read-only configuration and a local-source request whitelist. Browser evidence is recorded in local `swagger-verification.json`; no application API is called and product tests remain NOT_RUN.

## 10. SRS, tables/ERD and blueprint — 16 September 2026

Added documents 17–19 and three supplemental machine contracts. The catalog separates 31 baseline Prisma models (also present in Postgres; scalar source blocks cross-checked against primary 4ca28c1df4a68894e9a5d9ceb4afb20fe996a686) from 54 proposed logical records. It includes expanded field dictionaries, nine focused ERDs, five blueprint diagrams, 33 requirement/acceptance mappings and 10 use cases. No new canonical IDs or application/schema/API definitions were added by this supplement.

The composite-key extraction finding and source-preserving correction are recorded in the [documentation RCA](../../../.brain/rca/2026-09-16-pm-schema-extraction-composite-key.md).

Verification artifacts are local to pm-design-qa: contract-verification.json, diagram-verification.json and spec-blueprint-verification.json. Checks cover source parity, reference/key resolution, SRS mapping, rendered diagrams and local review interaction. They are document/artifact evidence; product tests, DB migrations, RLS/grants and production behavior remain NOT_RUN. SPEC-G01–G09 remain explicit implementation-entry gaps, with additional design detail for allocation, metric shapes and persistence. Existing historical navigation artifacts are not promoted by these checks.

## 11. Multi-agent planning snapshot — before first-wave execution

Two separate `gpt-5.6-luna` agents using reasoning effort `max` produced bounded planning reports: one for spec closure, one for delivery sequencing. A third Luna Max agent independently reviews the composed [delivery plan](20-MULTI-AGENT-DELIVERY-PLAN.md) and its JSON. Root retains final review, shared-file composition and publication. Exact reviewed digests and verdicts are recorded in the task verification receipts; this document does not substitute for those receipts.

The deliverable is a candidate plan. All work packages remain PLANNED; product implementation, migrations, service tests and production activation remain NOT_RUN. Planning coverage does not close SPEC-G01–G09 or approve code generation. The public review export remains a separate document-sharing artifact.

## 12. First document-closure wave — package v0.9.0b

Current source baseline is `eddd3dd8d884a0b19a65f9a3019758c05c815b48` in the isolated `codex/pm-delivery-20260916` worktree. A later registry refresh to `fd9a505240f15bcc10f8359f54259516abb1cbca` preserved six unrelated requirement-status corrections; it changed no navigation source. PRD is 1.230.0b and candidate navigation is registered as ADR-096 / FR-250. This is not owner approval of the new application behavior.

Luna Max document workers submitted bounded contract and core-navigation packets. Independent Luna Max verification rejected early attempts. Root repaired six reproduced contract gaps, composed the accepted artifacts, reconciled registry rows and checked the final documentation prototype. Failed attempts and exact-revision receipts remain in the local `pm-execution-qa` evidence directory.

| Evidence | Result | Limit |
|---|---|---|
| Existing navigation/access unit baseline | 62 tests in 6 files passed | Before new application behavior |
| Existing browser navigation / Work / Inventory | 20 product scenarios + 1 warmup passed; zero skipped/flaky/failure | Isolated port 3158 and synthetic SQLite; not production |
| Local application build after composition | Compiled, lint/type checks and 93 generated pages passed | Engineering build only; no new application implementation |
| D01 contract gate | 148 checks passed; independent PASS_WITH_LIMITATIONS | Three covered operations; other transport/input/lifecycle gaps remain open |
| D02 navigation gate | 35 checks passed; independent PASS_WITH_LIMITATIONS | Core bindings only; deferred screens cannot generate routes |
| Composed documents | 23 package Markdown, 15 contracts, 30 Mermaid blocks, 33 requirement families, 80 operations / 132 API schemas | Structural/ref/link checks, not new service tests |
| Documentation artifact | 39 HTML pages, 150 served files, 900 local links; no missing links, page errors, external requests or failed responses | Local browser proof at 1440 and 390 pixels |
| Interactive navigation demo | 6 modules, all 8 Business/14 Project routes, 7 Work views, shared Import, back navigation and keyboard passed | Standalone documentation simulation |
| Governance | Zero critical, one unchanged warning; corpus regenerated and checked | Warning is the five pre-existing test-only dangling references |

G01 has bounded human-allocation design reconciliation. G05 retains generic API CSRF owner binding and other operation/provider transport work. G06 retains deferred screens, Workforce screens and G14. G02–G04 and migration/service-test work remain open. Full application `npm run verify`, hosted CI, new service tests, migration and production activation are NOT_RUN.

The prior planning JSON remains a non-executable plan, not a live status database. Read [21 Contract foundation](21-CONTRACT-FOUNDATION.md), [22 Navigation baseline](22-NAVIGATION-IMPLEMENTATION-BASELINE.md), and [16 Readiness](16-SPEC-READINESS-AND-API-REFERENCE.md) for the resulting scope and remaining gates.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-16 | candidate | Baseline provenance, evidence limits, review decisions and validation record | base 087f3025 | RWANG |
| 0.2.0b | 2026-09-16 | candidate | Separate navigation refinement evidence and approval from the larger system proposal | base 087f3025 | RWANG |
| 0.3.0b | 2026-09-16 | candidate | Add UX/UI source/contract evidence, 37-screen artifact checks, explicit scope gaps and review handoff | base 087f3025 | RWANG |
| 0.4.0b | 2026-09-16 | candidate | Add current-source taxonomy evidence, primary vendor comparison and limits of historical prototype checks | source 000b26f1 | RWANG |
| 0.4.1b | 2026-09-16 | candidate | Record tab semantics, source provenance and unit startup limitation separately from document validation | source 96630462 | RWANG |
| 0.5.0b | 2026-09-16 | candidate | Record owner workforce request, live source gaps, candidate contract and artifact verification scope | source 0f5a47fc; uncommitted | RWANG |
| 0.5.1b | 2026-09-16 | candidate | Audit contract completeness and record local Swagger verification separately from product behavior | design base 087f3025; uncommitted | RWANG |
| 0.6.0b | 2026-09-16 | candidate | Add SRS table ERD blueprint provenance and explicit static validation boundary | design base 087f3025; uncommitted | RWANG |
| 0.7.0b | 2026-09-16 | candidate | Record actual Luna planning roles and exact-revision evidence boundary | design base 087f3025; uncommitted | RWANG |
| 0.8.0b | 2026-09-16 | candidate | Record executed Luna document wave, rework findings, independent gates, root composition and local-only evidence | base eddd3dd8; registry reference fd9a5052 | RWANG |
