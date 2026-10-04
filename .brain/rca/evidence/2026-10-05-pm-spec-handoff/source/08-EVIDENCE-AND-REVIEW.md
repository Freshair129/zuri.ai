---
id: ZAI:PM-SYSTEM-EVIDENCE
title: Project Manager design evidence and review record
version: "0.9.28b"
status: candidate
created_at: "2026-09-15T23:49:58+07:00,RWANG,base 087f3025"
last_update: "2026-10-03,Codex, record exact MA-D01 v0.1.8b, MA-D02 A4 bundle and NFR applicability reviews under delivery-plan v0.9.38b; preserve candidate-only and execution gates"
superseded_by: null
attributes:
  doc_type: design-review
  domain: project-manager
relations:
  - type: references
    target: ZAI:PM-SYSTEM-DESIGN
---

# Evidence & Review

**Version:** 0.9.28b · **Status:** Candidate · **Version diff:** 0.9.27b to 0.9.28b records exact MA-D01 v0.1.8b, MA-D02 navigation/fixtures v0.4.3b and UX v0.4.4b candidate review outcomes, plus GPT-6-Sol/Astra NFR scope concurrence under plan v0.9.38b; exact rollback is verified and all owner/G0/SPEC/dispatch/implementation gates remain unchanged.
Historical source snapshot: `087f30258a6831865afd751e28804e36505aff30`
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
| Architecture model | 28 nodes / 35 directed typed edges (G01 + candidate G14), all refs and write owners resolve | Target logical graph; G14 remains candidate/codegen disabled |
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
| Graph/API presentation | 28 nodes / 35 edges available as accessible lists; selected graph projections; all 72 operations searchable from the same OpenAPI | G14 operations remain candidate; not installed Swagger runtime |
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

## 13. Current-source execution DAG review — package v0.9.6b

**Accepted program baseline:** `a34ceaf79c112e02b1bcfdbf0a84122d835b002e`; the earlier `087f3025` design base is historical. On 2026-09-30 the local `origin/main` ref was `5582ec5811f4d7f9e5986be2287703692da2613b`, after the prior local observation `cd3c9f304dca6903daa38792278116275ad969fd`. Enumerating `cd3..5582` found two changed paths: `.brain/rca/2026-09-29-watchdog-crash-loop-and-ki17-volume-loss.md` and `apps/server/deploy/knowledge-storage/README.md`; both are outside this PM packet scope. This local-ref observation does not verify remote freshness. Exact packet source baselines and SHA-256 inputs are pinned separately in [the delivery plan](contracts/delivery-plan.candidate.json).

The initial inventory enumerated the PM architecture folder and all 33 PMR proposal files, plus 1,121 Server source files and 958 Server test files. This establishes the repository scope and candidate mapping; it is not a runtime acceptance result. The plan maps all 33 PMRs to existing canonical requirements, candidate-only work, new candidate subjects, or explicit owner holds. PMR-013 is registered as FR-272 in the requirement index; its acceptance trace remains `PLANNED_NOT_RUN` because full A-01–A-12 acceptance is incomplete.

The current Phase-B binding is 194 models, with schema SHA-256 `32eb25fc477a50457014e2e8b106fd58a4d5eed0666b46a3e98e7bcba66330d4`, target-schema fingerprint `9dfbf9b736a46b2191cc8c72b843b090563af0198359b7015b5654dd08506aa0`, and inventory-file SHA-256 `e72d3830b9a3941052269102375a4d063e756315c8c14c999d087d861172893f`. The local receipt, [.brain/reports/fr252-phase-b/phase-b-current-schema-proof.json](../../../.brain/reports/fr252-phase-b/phase-b-current-schema-proof.json), binds those values and all six required producer hashes; its corrected SHA-256 is `4309c1d1cae85bd071ab7a3e64540bb80d640c1f33befd60d0ebc08e340a0da4`. Synthetic acceptance commands passed in a new loopback-only PostgreSQL 17 container with no mounts or volumes; the container was removed. One initial fixture attempt failed because its proof timestamp differed from its row timestamp; only the task-owned fixture was corrected. No source/schema/test edits were made. The automated test suite did not run. Terra returned REWORK on the initial four-producer receipt, then approved the corrected six-producer receipt with limitations for synthetic CLI/database verification only. The 2026-09-17 receipt binds older file bytes and remains historical.

The `@tested` annotation in `approval-gateway.js` was corrected to the existing integration test only. The missing unit-test path was a metadata mismatch; this correction does not establish the unclosed FR-272 acceptance cases.

| Decision gate | Decision | Limit |
|---|---|---|
| Terra task decision, 2026-09-29 | APPROVE v0.9.0b candidate DAG, 33-row mapping, and the 43-package acyclic plan; PM-DOC-RECONCILE may close after this record and governance, without allocating canonical IDs | No packet may start before its own MA-D08/G0 gate |
| Astra high-impact review, 2026-09-29 | APPROVE bounded RCA, owner-contract drafting and synthetic acceptance preparation; hold implementation until each packet has its approved contract and G0 | No external provider activity, foreign-owner writes, existing-data migration, release, deployment or activation |
| Astra file-boundary ruling, 2026-09-29 | MA-D01 and PMR-033 may prepare in parallel only through distinct candidate JSON paths; canonical workforce/OpenAPI files stay read-only and root-composed; MA-D03 waits for both accepted proposals to be composed | Separate worktrees alone do not establish file ownership; no dependency edge is needed with exclusive paths |
| Root dependency receipt, 2026-09-29 | Bind MA-D01 candidate SHA-256 `066c37485a0cd466002a64e7774e107c4c1390df3cd67a0647f754dbb3a75683` and `CANDIDATE_READY_FOR_REVIEW` for MA-D06 candidate-design input | Does not accept MA-D01 owners or canonical workforce docs; MA-D03 remains blocked |
| Terra G0 with Astra concurrence, 2026-09-29 | GO `contracts/pmr-029-ops-acceptance.candidate.json` and `contracts/ma-d06-provider-agent-ledger.candidate.json` as separate author packets | Candidate-only, pinned cd3 inputs; owner approvals and execution proof remain open/NOT_RUN |
| Terra package decision, 2026-09-29 | REWORK PM-PHASEB-RECOVERY-REBIND because the first receipt bound only four producer scripts while the package requires six | Reissued receipt adds both backup producer hashes; same CLI/database acceptance reused because producer files did not change; final package decision pending |
| Terra package decision, 2026-09-29 | APPROVE_WITH_LIMITATIONS PM-PHASEB-RECOVERY-REBIND at the exact corrected receipt and baseline | Synthetic local verification only; no product completion, automated-suite coverage, real database restore, provider, deployment or production claim |
| Independent candidate review, 2026-09-29 | Luna Max PASS and Terra/Astra APPROVE_WITH_LIMITATIONS for PMR-020, PMR-026, PMR-029, PMR-031 and PMR-032 at their pinned candidate hashes | Candidate review only; exact digests and source-baseline reconciliations remain in `contracts/delivery-plan.candidate.json`; owner and canonical acceptance stay open |
| PMR-025 candidate review receipt, 2026-09-29 | Luna CONDITIONAL_CANDIDATE_ONLY; Terra and Astra APPROVE_WITH_LIMITATIONS for candidate SHA-256 `2efcd0d8c794dccbe12828a776a117a4a2d639d65df7b2e50aa4691b5d6cc23a` | All 44 input hashes match baseline `cd3c9f304dca6903daa38792278116275ad969fd`; 41/44 match the pre-receipt coordinator snapshot. The three deltas are document 20 SHA-256 `b3fbe804f985a4fcccb980cccd31620086e3e57ee6bf5a0c1f4cd321d4dd270f`, `pm-requirement-index.json` SHA-256 `7091a09660dcb2ce27dbaed640221391040544b01224fe0261a440ed8c487f42`, and delivery-plan SHA-256 `d55ffc0cb81a99828ec24261f72fd9d0f31ff41fd1df0c44305ad6a58617c868`; all five owner areas and ten contract questions remain OPEN/UNASSIGNED |
| Independent candidate review, 2026-09-29 | Luna Max PASS; Terra/Astra approval with limitations for the PMR-033 predecessor at its pinned candidate hash | The predecessor remains historical and does not unlock MA-D03 until owner acceptance and root composition |
| PMR-033 v0.1.1 exact candidate review, 2026-09-30 | Luna Max PASS; Terra GO-WITH-LIMITS; Astra APPROVE_WITH_LIMITATIONS for `pmr-033-workforce-source.v0.1.1.candidate.json` SHA-256 `288682367b5be0fc3dc3905ad484ebde86dfc6bb05cb9f9f9e83bf91c74ef577`; reviewed plan SHA-256 `89aa8569b6a4f12eadffac4345a3690371f4a536a6b65b1666a1d7f8990b8d66` | 31/31 raw-worktree-byte pins matched at review. Recording this receipt changes only the candidate's delivery-plan pin; 31/31 is historical review-time evidence. Owner questions, G0, SPEC-G02, canonical registration, MA-D03 dispatch and implementation remain open/blocked; downstream use needs a fresh successor read set and exact reviews |
| Independent navigation review, 2026-09-29 | Luna Max PASS; Terra APPROVE_WITH_LIMITATIONS; Astra PROCEED for the exact seven MA-D02 files | Historical fixtures, Business Home shortcuts/personalization, Risks lifecycle and MA-D02W Workforce bindings remain open or deferred |
| Independent provider/authority review, 2026-09-29 | Luna Max PASS; Terra APPROVE_WITH_LIMITATIONS and Astra bounded concurrence for MA-D01; Luna Max PASS and Terra/Astra approval with limitations for MA-D06 | MA-D01 remains a candidate dependency only; MA-D06 does not settle Identity/Integration/PM/Edge ownership, runtime or provider behavior |
| Independent FR-272 design review, 2026-09-29 | Luna Max PASS; Terra and Astra APPROVE_WITH_LIMITATIONS for the three exact FR-272 design/RCA artifacts | Documentation/RCA only; A07 concurrency/rollback, owner contracts, runtime and product acceptance remain OPEN or NOT_RUN |
| FR-272 v0.9.18b exact review, 2026-09-30 | Luna Max PASS; Terra GO-WITH-LIMITS; Astra CONCUR-WITH-LIMITS for pre-composition plan SHA-256 `efa75d639019ecb28eb59f07ee34ead830daf2dc57910dc4a10b3822735638ce` | 32/32 active work-package artifact pins and the separately pinned direction receipt match (33/33 total); 43 packages, 90 edges, no missing dependencies or cycles. Documentation-review readiness only; A-07 proofs remain UNVERIFIED and no owner, SPEC/G0, canonical-registration, dispatch, implementation, governance, test, build or release gate is promoted |
| MA-D08 readiness candidate, 2026-09-29 | Luna Max CONDITIONAL PASS; Terra GO_WITH_LIMITS; Astra APPROVE_WITH_LIMITATIONS for `contracts/ma-d08-readiness.candidate.json` SHA-256 `c474ccd3e0e52964a73d5d25ed44cd2900c971379e71823f78d2f3c8bfbc2d65` against DAG SHA-256 `ffb9132eaaf4d96c12468c6c6a7293fdd503b5de30a34d3b8f99d0aebf122f08` | Candidate composition only: no canonical IDs, registry writes, baseline acceptance, SPEC-G09 closure, implementation, provider, runtime, migration or product acceptance |
| Root MA-D08 dependency reconciliation, 2026-09-29 | Correct document 20's MA-D08 row from `MA-D00` to `MA-D00, PM-DOC-RECONCILE`; SHA-256 before `e0558e486e542b13f14211d8ea90f848dc215e2676ca3559334ff2a14cb060d1`, after `b3fbe804f985a4fcccb980cccd31620086e3e57ee6bf5a0c1f4cd321d4dd270f` | Candidate retains `OPEN_AT_PINNED_G0_INPUT` as historical evidence; corrected current row is verified, while MA-D08 registration and baseline acceptance remain pending |
| Root PMR-025 receipt-status correction, 2026-09-29 | Update document 20 §§1/13 to record the exact candidate-only receipts for SHA-256 `2efcd0d8c794dccbe12828a776a117a4a2d639d65df7b2e50aa4691b5d6cc23a`; document 20 SHA-256 before `bc5281d1d89bd4051ac05e8d3476ab9a966224f8d1775e57f898b089ed5c97da`, after `6132ced415ea950a84076e82710af6d382eda2e1ce519fd49ea614d934c6c6c6` | The receipt remains candidate-only; five owner areas and ten questions remain OPEN. Manifest counts remain receipt-time evidence and need a fresh comparison before current-baseline acceptance or downstream use; canonical and implementation status do not change |

**State recorded at v0.9.13b:** MA-D00, PM-DOC-RECONCILE and the narrowly scoped PM-PHASEB-RECOVERY-REBIND package are accepted at the pinned baseline. PMR-025's user-direction successor remains direction-only; its owner-contract docket is accepted as a candidate completeness packet, with Q1 and Q3–Q10 open and no technical alternative selected. ArtifactRevision, authorization, CSRF, idempotency/CAS, failure and receipt questions in Astra's limitations remain for named owners and later technical review. MA-D01 direction covers one PM allocation writer, CRM Person identity, canonical remainingMinutes and Identity authorization; People availability is a read-only dependency when applicable. D01-05, exact technical ports, owner sign-offs, canonical registration, codegen and implementation remain open. MA-D03 v0.1.1 passed Luna Max exact review and Terra accepted it as candidate-only after preserving the People availability read-only boundary; MA-D03 remains unaccepted by domain owners and SPEC-G02 remains open. PMR-033 v0.1.1 has exact candidate-only review at the hash recorded above; its plan pin is stale after receipt composition, and A-Q1–A-Q8 and the owner contract remain open. The MA-D08 readiness candidate remains `PLANNED` with registration and baseline acceptance pending and no phase receipt; its immutable G0 snapshot remains bound to the earlier DAG. The planning JSON is v0.9.13b and remains `candidate`, `dispatchable=false`, and `implementationAuthorized=false`; `latestCompositionGovernance` records the completed v0.9.13b pre-receipt run; the post-receipt governance run remains `PENDING_NOT_RUN`.

**Validation boundary recorded at v0.9.13b:** the work-package graph has 43 unique packages, 33 requirement dispositions, no unresolved dependencies and no cycle in the recorded plan. Current disposition counts are 3 `ACCEPTED`, 12 `CANDIDATE_READY_FOR_REVIEW`, 24 `PLANNED`, 1 `BLOCKED_FOR_DESIGN` and 3 `BLOCKED_OWNER_CONTRACT`. Nineteen pre-decision candidate digest pins remain unchanged; the user-direction receipt pins two versioned successors and itself. The MA-D08 receipt remains tied to its recorded G0 snapshot; earlier coordinator source-manifest comparisons remain historical. The rollback archive and separate restored copy match all 71 pre-decision file hashes. MA-D03 v0.1.0 remains unchanged at `06559bc524c89e069bd3106e682bf43b114ecdc74faa79c9ecaeb0e5bd86abdb`; Terra returned REVISE. Its v0.1.1 successor is `f60d8b8e6e1fac97e8532979f3fd58fc16381ac77dcf9f1ad055e4952db36a7e`; Luna Max returned PASS and Terra returned ACCEPT_CANDIDATE_ONLY. Root's scoped status comparison records 45 entries before and 46 after authoring, with v0.1.1 as the sole new status path; after a content correction the status remained 46 with no path delta. This does not claim the shared worktree was clean. The PMR-025 docket SHA-256 is `ecd7c8f6811467aa89e8e1a13987613f3f5b552f3bc3b08fbccf3839891e52e9`; Luna Max returned PASS, Terra ACCEPT_CANDIDATE_ONLY and Astra APPROVE_WITH_LIMITATIONS. Exact plan-review and latest governance receipts are recorded in the delivery plan. Product tests/build and implementation remain NOT_RUN.

## 14. Receipt-time candidate reconciliation — v0.9.13b historical snapshot

**Snapshot boundary:** “Current” statements and pin counts below describe only the v0.9.13b receipt-time preimage; later receipts may supersede them.

The earlier Luna Max inventory enumerated 65 files (33 Markdown documents and 32 contracts; 56 tracked and 9 untracked). After six contracts were added, the rollback snapshot contained 71 files (33 Markdown, 38 contracts; 56 tracked, 15 untracked). The current directory contains 79 files: 33 Markdown documents and 46 contracts (44 JSON and 2 YAML), of which 56 are tracked and 23 are untracked. These later additions are candidate artifacts and review receipts, not canonical or accepted contracts. The rollback archive remains local-only and independently verified at 71/71 file hashes; it is a pre-decision documentation snapshot, not a database or runtime rollback.

**MA-D02 A4:** the final navigation, fixture and UX candidates have SHA-256 values `aa74b537097bbc7fa0026210f6852ddbb85ce160cc2362e8b812612b1afb3b53`, `0996d90c33be1402247dd89aec6c769863ca2031647765c0c8c27c2c58ff071c` and `b5c9feda414b41b76bf428717b6e36bfc9538587c7752a2cad935ecfa98bdad5`. The G0 packet is `contracts/ma-d02-navigation-a4-g0.candidate.json`, SHA-256 `70b6a7b1c0d51d5e6ce1c9673ec292e620966f590d2f8601a4c558068738cbda`. Independent Luna Max verification passed; Terra passed the exact packet; Astra approved with limitations. A plan-level verifier-model attribution was corrected against the G0 receipt and documented in [the RCA](../../../.brain/rca/2026-09-29-ma-d02-reviewer-model-misattribution.md). This closes the bounded A4 candidate review only. Inherited A3 allocation/status hints remain non-authoritative pending current ID-ledger qualification; SPEC-G06/G08, owner acceptance, canonical IDs, dispatch, implementation, runtime behavior and product acceptance remain open or NOT_RUN.

**Phase-B metadata application:** the immutable delta is `contracts/phase-b/metadata-status-reconciliation.candidate.json`, SHA-256 `b636cb38908b4b8f7f2e546f513a13ee567226b028daf10898baee616506eaa8`. Its separate application receipt is [metadata-status-reconciliation-application-receipt.candidate.json](contracts/phase-b/metadata-status-reconciliation-application-receipt.candidate.json). Terra authorized the seven-pointer change with limits, Astra approved, and distinct post-write Luna verification passed. A truncated preimage digest was caught before acceptance, corrected against the immutable delta, and documented in [the receipt provenance RCA](../../../.brain/rca/2026-09-29-phase-b-application-receipt-preimage-truncation.md). The parent OpenAPI hash is now `0b546debb1e7408a66974385c5959ebf3598649eceafdb0c37bb44c55852b7a9`; the Phase-B overlay hash is `2acbbefb8d0c7ecdfe3b764118659f3a98a3fd263fe5775d345bcf33fad00439`. Only the seven allowlisted status metadata pointers changed. All 14 operation statuses, paths, schemas and security definitions were verified unchanged. The parent contract remains `CANDIDATE`; historical local implementation evidence is distinct from current-checkout verification. `schemaMigration` and `codegen` remain `NOT_RUN`; current-checkout migration verification, hosted CI, parent parity/composition, production migration/deployment/activation and runtime grants/RLS evidence remain open or unverified. The original status-lag cause and prevention are recorded in [the RCA](../../../.brain/rca/2026-09-29-phase-b-openapi-status-stale.md).

**Remaining specification and execution gates:** SPEC-G01–G09 remain open: allocation authority; Workforce inputs/history; metric result shapes; metric review/correction; shared security transport and owner contracts; navigation parity; physical adapter/migration; executable conformance tests; and canonical registration/accepted baseline. PMR-025 now has a candidate successor recording approved import/export direction; its package relationship, technical contract questions and five technical owner areas remain open. Workforce direction is approved only at the listed product-principle level; D01-05 and PMR-033 A-Q1–A-Q8 remain open across Identity capability policy, CRM Person pins/erasure, People calendar/version rules, PM history/commit boundaries, and failure/redaction/retention. PMR-020/026/031/029 and MA-D06 retain their listed Integration, Identity, CRM, PM, service-owner or Edge decisions. MA-D08 remains bound to its earlier DAG and `PLANNED`; refresh exact inputs before canonical registration or baseline acceptance. The PMR-032 comparison and implementation/index snapshots remain historical.

**PMR-025 owner-contract docket:** [`pmr-025-owner-contract-docket.v0.1.0.candidate.json`](contracts/pmr-025-owner-contract-docket.v0.1.0.candidate.json) SHA-256 `ecd7c8f6811467aa89e8e1a13987613f3f5b552f3bc3b08fbccf3839891e52e9` passed Luna Max exact review; Terra accepted it candidate-only and Astra approved with limitations. The docket keeps owner questions open and does not choose a technical alternative. Astra requires owners to resolve ArtifactRevision generation versus retrieval, authorization/CSRF where applicable, idempotency and failure/receipt semantics. Any CAS/idempotency mechanism must bind exact preview, scope, revision/hash, live authorization, expiry and transaction outcome; replay cannot bypass access checks. Technical closure needs a new named-owner contract and exact review.

**PMR-033 workforce-source successor:** v0.1.1 is the current candidate after the predecessor was preserved. Luna Max PASS, Terra GO-WITH-LIMITS and Astra APPROVE_WITH_LIMITATIONS bind to SHA-256 `288682367b5be0fc3dc3905ad484ebde86dfc6bb05cb9f9f9e83bf91c74ef577` and delivery-plan preimage `89aa8569b6a4f12eadffac4345a3690371f4a536a6b65b1666a1d7f8990b8d66`. The 31 raw-worktree-byte inputs matched at exact review; receipt composition changes the delivery-plan pin, so this count is not current afterward and the artifact is not a G0 read set. The candidate records read-only People availability only, no PM calendar/Employment write and no cross-owner commit; A-Q1/A-Q2/A-Q4–A-Q8, all technical owner answers and the People read contract remain open. No owner acceptance, canonical composition/registration, SPEC-G02 closure, MA-D03 dispatch or implementation is authorized.

**MA-D03 Workforce inputs/history:** v0.1.0 is preserved unchanged after Terra's REVISE; the successor v0.1.1 passed independent exact-byte review by Luna Max and candidate-only acceptance by Terra. The successor retains A-Q3 and the approved rule that this PM preview/commit does not write People calendar or Employment and does not perform a cross-owner commit. A separate People-owner command is outside this packet. It does not accept domain owners, compose canonical workforce contracts, close SPEC-G02 or authorize implementation.

**Current plan review and delegated sequence:** Terra returned `GO-WITH-LIMITS` and Astra returned `APPROVE_WITH_LIMITATIONS` for delivery-plan v0.9.11b SHA-256 `241329439e0ffd20b22d37bb3e6fdf27690c49c070331b03dbc2da40fa203226`; both independently recomputed the docket and MA-D03 candidate hashes. Terra authorizes preparation of only the PMR-025 import/export conformance G0 candidate at its single allowlisted JSON path. Astra's broader permission to prepare both candidate packets is narrowed by Terra's decision sequence, so MA-D04 remains held until MA-D01 and PMR-033 owner contracts are resolved and composed. The PMR-025 packet must pin this reviewed plan snapshot and a freshly recomputed full input read set, keep technical alternatives open, and obtain new independent/Terra/Astra review before any affirmative G0 result.

**Historical source-digest reconciliation:** the inherited `baseline.sourceDigests` map matches 17 of 22 current worktree files. Five differ: architecture documents 13, 14 and 29, `contracts/openapi.candidate.yaml`, and this evidence document. The old evidence-document digest `cd105faaf960219692660ce2ea250c4e54fbac8213e60a1a59010455665bb671` has no verified source commit among the inspected `a34`, `cd3` or `558` refs. Preserve that map as historical evidence only; it is not proof of current source bytes. Each new G0 packet must pin its own current read set, including the current hash of this document.

No additional implementation packet is dispatchable from this reconciliation. The delivery plan remains `candidate`, `dispatchable=false`, and `implementationAuthorized=false`. This candidate review does not close an owner, canonical, implementation, runtime, release or product-acceptance gate.

**Final composed review before governance:** Terra returned `GO-WITH-LIMITS` and Astra returned `APPROVE_WITH_LIMITATIONS` for the exact delivery-plan snapshot SHA-256 `9a0b78b4ee08209eccad952bb1da45ed2db24ebd2011b208c6059e6ba9fc314f`, after confirming the corrected reviewer provenance and candidate boundaries. Their decisions authorize proceeding to the composed documentation-governance check only. The detailed receipts bind this exact pre-receipt plan snapshot in `contracts/delivery-plan.candidate.json`; they do not approve owner contracts, canonical registration, dispatch or implementation.

### User direction and rollback receipt — 29 September 2026

The direct user response is recorded in [`user-direction-receipt-2026-09-29.candidate.json`](contracts/user-direction-receipt-2026-09-29.candidate.json). It approves candidate product direction only: PMR-025 import writes DesignSnapshot/bindings only (no ExecutionPlan create/update); export bytes use immutable ArtifactRevision with a scoped reference/download handle; Workforce uses one PM allocation writer, CRM Person identity, remainingMinutes as canonical, Identity authorization, and People availability as a read-only dependency when applicable. It does not approve technical owner sign-off or implementation.

Versioned successors preserve original reviewed candidates: [PMR-025 v0.1.1](contracts/pmr-025-design-bundle.v0.1.1.candidate.json) and [MA-D01 v0.1.4b](contracts/ma-d01-allocation-authority.v0.1.4b.candidate.json). The original MA-D01 hash remains MA-D06's historical dependency. PMR-025 packaging relationship and residual owner contracts stay open; MA-D01 PROPOSED-D01-05 and PMR-033 A-Q1–A-Q8 stay open.

Rollback baseline: `zuri-ai-pm-spec-pre-decision-20260929`, archive SHA-256 `25710d8b409c8fb761287c87aa9b27cbaf6ecd0d0fa2a9dc4d51fefffde3cd74`, manifest SHA-256 `5bc111a1b3e4d6a8a5ff41b467131856c26a48f240cf575fb1a7bf6e286da190`. The archive contains all 71 pre-decision files; a separate extraction matched 71/71 SHA-256 values. The archive is local-only and covers this PM architecture documentation tree.

**Exact review:** the PMR-025 successor (`4c85d9362b7683ba1fdb6231de6d7362c3c375f2937f9252df962e119c03e475`), MA-D01 successor (`50a1a52eac365c72b01b7a41db22a523fea67b1ebaee1dba6c772ce0cedee840`), direction receipt (`c43f4ae5928cff4b335a41d643083e9663a908faea088373ee4ae25e9a816b83`) and pre-review plan (`71302a0c05a677e3bf274078fdeed39ae5aa3e7daa9d50ff7fc433f5775513a2`) were verified at exact bytes. Terra returned `GO-WITH-LIMITS`; Astra returned `APPROVE_WITH_LIMITATIONS`. Both verified the rollback archive and manifest, preserved predecessor and MA-D06 pins, and confirmed that D01-05, technical owner sign-offs and canonical/implementation/runtime gates remain open. The receipt's pending-review status is its immutable creation-time state; these review outcomes are recorded in the delivery-plan review ledger.

The missing closing quote in the earlier `last_update` YAML frontmatter was corrected before governance; its cause and prevention are recorded in [the RCA](../../../.brain/rca/2026-09-29-direction-evidence-frontmatter-quote.md).

**Composed governance:** `npm run govern` exited 0 on the composed v0.9.11b candidate tree. The graph has 3,893 nodes, 16,441 edges, five dangling legacy test edges and two changed nodes; `docs:check` passed. Strict preflight reported 0 criticals, 22 warnings and 34 info across 558 documents and 330 routes. Warnings include broken `llms-full.txt` references and 21 untracked candidate documents. The exact result is in `latestCompositionGovernance` in the delivery plan. Product tests, build and implementation remain NOT_RUN.

### PMR-025 import/export conformance candidate — 30 September 2026

The candidate [`pmr-025-import-export-conformance.v0.1.0.candidate.json`](contracts/pmr-025-import-export-conformance.v0.1.0.candidate.json) has SHA-256 `4e34216aadaef9bb788f1257109319b190168e4df954417ee28767f4436a6eee`. It binds the exact delivery-plan review snapshot `241329439e0ffd20b22d37bb3e6fdf27690c49c070331b03dbc2da40fa203226`, the then-current plan input `a774f13d56016a5eafdd92cc4c2ca9563a137453515ef2786ed79a2bb64f0e76`, and 47 current input hashes. Luna Max returned PASS, Terra returned GO-WITH-LIMITS, and Astra returned APPROVE_WITH_LIMITATIONS on these exact bytes; each review verified the complete input manifest and preserved the owner docket's per-question domains/reviewers/status. Astra found no remaining high-impact blocker for candidate readiness.

This is `CANDIDATE_ONLY` at `G0_CANDIDATE_PREPARATION_ONLY`: it does not pass G0. Nine owner questions remain open; all ten PMT-025 conformance proofs remain `PLANNED_NOT_RUN`. The user-selected DesignSnapshot/bindings-only import target and immutable ArtifactRevision/scoped-reference export direction are recorded without closing owner lifecycle, authorization, CAS/idempotency, sanitization or failure/receipt contracts. The immutable candidate records the rollback archive and manifest; the 71-file archive was verified separately before authoring. Candidate authoring was coordinator-authored after the delegated draft did not produce an artifact; Luna Max's receipt here is an independent exact audit.

The package state, owner acceptance and all implementation/canonical gates remain unchanged. The exact review receipts and limitations are in `contracts/delivery-plan.candidate.json` under the PMR-025 work package and decision ledger.

All 47 input hashes matched during exact review. Recording the review afterward changed three inputs: this evidence document, the delivery plan, and `contracts/delivery-plan.candidate.json`. The reviewed candidate remains an immutable historical snapshot; it is not a current-source G0 pass. Any affirmative G0 result requires a successor candidate with a freshly bound complete read set and new independent, Terra and Astra review.

**Post-candidate governance:** `npm run govern` exited 0 on the composed v0.9.12b candidate tree. The document graph reports 3,893 nodes, 16,441 edges, five dangling legacy test edges and two changed nodes; `docs:check` passed. Strict preflight reported 0 criticals, 22 warnings and 34 info across 558 documents and 330 routes. Warnings include broken `llms-full.txt` references, the five dangling legacy test edges and 22 untracked candidate documents. A final `npm run govern` rerun after the v0.9.12b document and JSON receipt composition exited 0 with the same counts; `docs:check` passed. Product tests, build and implementation remain NOT_RUN. The plan records those governance receipts under `latestCompositionGovernance`. The v0.9.13b pre-receipt `npm run govern` run is reconciled as historical evidence under `latestCompositionGovernance`: command `exec-147825a8-858a-4bd0-84fc-87008be2bcbc` exited 0 with 3,893 nodes, 16,441 edges, five dangling edges, two changed nodes, `docs:check` PASS, and strict preflight 558 documents / 330 routes / 0 criticals / 22 warnings / 34 info (WARN). Its audit manifest is `fcce80040981263dfbd460b6a3bde178221252e4c8231ee68a88e44458b2b766`; 49 dirty/untracked paths and hashes were unchanged, no out-of-allowlist paths changed, and only the three allowlisted generated reports changed. This run preceded the receipt edits and does not verify the post-receipt bytes; post-receipt governance is `PENDING_NOT_RUN` pending separate authorization. Product tests, build and implementation remain NOT_RUN.

## 15. Receipt-time candidate reconciliation — v0.9.14b historical snapshot

**Snapshot boundary:** “Current” statements and pin counts below describe only the v0.9.14b receipt-time preimage; later receipts may supersede them.

This section supersedes the v0.9.13b current pointers below. Earlier candidate reviews and governance remain historical evidence.

**PMR-033 v0.1.2:** exact candidate SHA-256 25840b20749659ba7abd18e9f875fcff312340df41df89e2445899ec78665a1c. Luna Max returned PASS, Terra returned APPROVE_WITH_LIMITATIONS, and Astra returned CONCUR WITH LIMITS. All 31/31 declared raw-worktree input hashes matched at review. Reviewed plan snapshot: 375124d5cf761c6f0cd76545bf526029d2f0ef4775262d099505aec632b90850; evidence document: 9faaf946047eeb58f7abdfa96ebf9352188637ca28577ddc13662b61933b7626; delivery-plan document: f43e71d2f5f142b8bea17101f449e9c38440f31180c0ae752bd474d2515a6d29. This composition changes the delivery-plan source pin, leaving 30/31 candidate source pins current; all three context hashes are historical after composition. The Astra reviewer role is distinct from runtime model identity, which was not exposed or independently verified.
**PMR-033 remains candidate-only:** ownerAcceptance is OPEN; A-Q1–A-Q8 and all technical owner contracts remain open; the Document 15 conflict remains unresolved. Preserve read-only People availability, no PM calendar or Employment write, and no cross-owner commit. SPEC-G02, G0, canonical registration, MA-D03 dispatch and implementation remain open or blocked.

**PMR-032 v0.2.1:** exact candidate SHA-256 63ab976574e2069357c5826494d512f6b51078f7a395bb67379e34ceabc64977. Luna Max returned PASS, Terra returned APPROVE_WITH_LIMITATIONS, and Astra returned CONCUR WITH LIMITS. All 25/25 sourceManifest hashes matched at review. Reviewed plan snapshot, evidence document and delivery-plan document hashes: 375124d5cf761c6f0cd76545bf526029d2f0ef4775262d099505aec632b90850, 9faaf946047eeb58f7abdfa96ebf9352188637ca28577ddc13662b61933b7626, and f43e71d2f5f142b8bea17101f449e9c38440f31180c0ae752bd474d2515a6d29. This composition changes the document 20 source pin, leaving 24/25 candidate source pins current; review-context hashes are historical after composition. The v0.2.0b clean cd3 checkout/source-equality evidence remains historical, and candidate-specific v0.2.1 composition verification is NOT_RUN.
**PMR-032 remains candidate-only:** all nine uncovered gaps, including owner-bound CSRF, remain open. Owner acceptance, product acceptance, governance composition, tests, build, runtime and implementation are not established by these reviews.

The current PM plan remains v0.9.14b with 43 work packages: 3 ACCEPTED, 12 CANDIDATE_READY_FOR_REVIEW, 24 PLANNED, 1 BLOCKED_FOR_DESIGN and 3 BLOCKED_OWNER_CONTRACT. Its 33 PMR dispositions and dependency edges remain planning evidence; no implementation packet is newly dispatchable.

The current directory inventory is 81 files: 33 Markdown documents and 48 contracts (46 JSON, 2 YAML), with 56 tracked and 25 untracked. The local rollback ZIP and manifest still verify 71/71 pre-decision files and cover the PM architecture documentation tree only.

Post-composition npm run govern is PENDING separate authorization; the v0.9.13b governance result is pre-receipt historical evidence. Product tests, build and implementation remain NOT_RUN.

## 16. MA-D03 v0.1.2 candidate review — 30 September 2026

This section records v0.9.15b; the preceding v0.9.14b reconciliation remains historical.

**MA-D03 v0.1.2:** candidate SHA-256 `2e50154e92e79a7696b2be3efaf61b023849555cdd82792758045a153b4bdbc2`; direct predecessor v0.1.1 SHA-256 `f60d8b8e6e1fac97e8532979f3fd58fc16381ac77dcf9f1ad055e4952db36a7e`. Luna Max recorded authoring-verification PASS (not an independent review); Terra returned APPROVE_WITH_LIMITATIONS and Astra returned CONCUR WITH LIMITS on these exact candidate bytes. The reviewed plan, evidence and delivery-document preimages were `2d2e05051171009a3060cfd27f2df8e0f2095a00c9087801e1cfffb2ad00e2c7`, `2e21215fb5e7adaafa95ca0a8d4946b42303d43d14176b69f3610f745541875b`, and `f0b3313628dbf79aaac6d12470f8fc29da09b59acee8d192c0599c999c2d22a1`. All 13 declared input pins matched at review; this receipt composition changes those three context pins, leaving 10/13 current. MA-D03 remains candidate-only with ownerAcceptance OPEN. MA-D01 and PMR-033 owner acceptance, the PM/CRM/Identity/People contracts, A-Q1–A-Q8, canonical workforce composition, SPEC-G02/G0, registration and dispatch remain open; the read-only People boundary and no cross-owner commit remain in force.

**PRE_V0_9_15B_RECEIPT_COMPOSITION_OBSERVATION:** one `npm run govern` on v0.9.14b preimages exited 0. The graph had 3,893 nodes, 16,441 edges, five dangling edges and two changed nodes; `docs:check` passed; strict preflight reported 0 critical, 22 warnings and 34 info (WARN) across 558 documents and 330 routes. Its 51-path pre/post audit was unchanged; only three allowlisted generated outputs changed and zero out-of-allowlist paths changed. The complete output hash pairs are in the governance receipt in the delivery plan. The pre-existing `latestCompositionGovernance` remains historical v0.9.13b evidence; this receipt records the newer pre-v0.9.15b run and does not verify the v0.9.15b composition. `POST_V0_9_15B_GOVERNANCE: PENDING_SEPARATE_AUTHORIZATION / NOT_RUN`. Product tests, build and implementation remain NOT_RUN.

## 17. Post-receipt v0.9.19b governance observation — 30 September 2026

This observation is recorded in the delivery-plan decisionReceipts as root-post-v0.9.19b-governance-observation-2026-09-30. It binds one npm run govern on the exact v0.9.19b post-receipt preimages, before this v0.9.20b result-recording composition. The external result is C:\Users\pc\.codex\backups\zuri-ai-pm-spec-20260929\fr272-postreceipt-governance-result-20260930.json (SHA-256 74fe9446c444d580e20ee1edd4ec8c4ab06d841257028b21bb32003da26126eb).

**Bound source preimages:** plan JSON 0b3f74bcded220286a4e7f8fb3761972ee927409ef4c7c89a586eb083fbe6645; this evidence document 9341142938eabeb8ace5136036d543a96f3a2b3e9996e9a5bae1d0718226a140; delivery-plan document 777b301967fd6fa019350a5206d239328fc2ff9df067abb81f2e9cc8384685a3.

**Governance result:** exit 0; graph 3,893 nodes, 16,441 edges, 5 dangling edges, 6 changed, 0 added and 0 removed; docs:check PASS; strict preflight 558 documents, 330 routes, 905 test files enumerated, 0 critical, 22 warnings and 34 info (WARN). The 905 count is inventory only; product tests were NOT_RUN.

**Worktree audit:** 56 dirty/untracked paths before and after with no path/hash delta and 0 out-of-allowlist changes. Only two of the twelve governed outputs changed: docs/.doc-graph.json from 61b6b005c251849b1731622b7ea3d32b667843aa421ffe526b11e7b8d1d7ae0d to e725284577da15e4609a864edf89eae076a0032da7666cac3e1c25da79a0bd32; and docs/.doc-graph-drift-report.json from 82f080e01427e0b025174d0069cf3c56ec9b74b591b0303bf7523a1706893a43 to 80322b270a00eb80a41ddddccd816c05bb18a1621bf349d11d6576b9f0d3b8cb.

**Rollback evidence:** fr272-postreceipt-govern-preimage-20260930.zip (SHA-256 a9013a20abe2e6e19949b1291a7e9e5b94e2e2f84d64f1e1c9b664eb284ec7a0) and its manifest (SHA-256 0adaa2b08af32344257f1063999a4ae238315795e2bc31873de2cba72d7fc7fa) cover the three source files and all twelve govern outputs in 15 verified entries. The separate 56-path prestate manifest is fr272-postreceipt-govern-worktree-prestate-20260930.manifest.json (SHA-256 e191674a99a58f2b3609e98e94d9165903c9f40d19c098e48751f89bf7150396).

The older PENDING markers retain their original preimage scope; the top-level compositionGovernance, previousCompositionGovernance and latestCompositionGovernance objects remain historical. At this v0.9.19b observation, the v0.9.20b post-recording governance run was still pending; that marker is historical and the later result is recorded in section 18 and the external receipt. This observation does not verify the v0.9.21b composition. Product tests, build and implementation remain NOT_RUN, and no G0 pass, A-07 proof, owner acceptance, canonical registration, dispatch, implementation or release authority is granted.

## 18. PMR-020/026/032 exact review dispositions — 30 September 2026

The candidate-specific reviews used delivery-plan v0.9.20b SHA-256 `817f1f8c2dd9edd551438dc11dec8102ced21afb9ed23b58409e91d0fa6c89e0`. The observed evidence-document and delivery-plan-document context hashes were `967d4b4ab3542eeafd2f95458d08d4f08866371a1bc0bb623d697c3dabd3094d` and `e0fcb2da6ba13c579ecb40081dfa51f5f0a1a6574b081889c7d718ea9e8e6fe9`. The candidate hashes and per-reviewer outcomes are recorded in `contracts/delivery-plan.candidate.json`. These dispositions apply only to the listed candidates and do not approve the newly composed v0.9.21b plan.

| Packet | Candidate SHA-256 | Luna Max | Terra | Astra | Bounded disposition |
|---|---|---|---|---|---|
| PMR-020 | `a573f7bb22ed76af665bb35e4d35e4e42078755c60f819e967216e366d198948` | NOT-READY | HOLD_NOT_READY_FOR_CANDIDATE_ACCEPTANCE | CONCUR WITH HOLD | Historical, non-binding issue inventory only; refresh sources and obtain a new exact review |
| PMR-026 | `b870c3adbf48e1a872d87d6b75f1dedbba5997dae95daa8f93a0ca05077bdd3e` | PASS-WITH-LIMITATIONS | ACCEPT_AS_CANDIDATE_PACKET_ONLY_WITH_LIMITATIONS | CONCUR WITH LIMITS | Historical owner-review packet only; owner answers and approvals remain open |
| PMR-032 v0.2.1 | `63ab976574e2069357c5826494d512f6b51078f7a395bb67379e34ceabc64977` | NOT-READY | APPROVE_WITH_LIMITATIONS | CONCUR WITH LIMITS | Historical static gap evidence only; no current baseline or downstream use |

PMR-020 matched 39/39 source hashes at its historical `cd3c9f…` baseline but 35/39 current files. Documents 16, 20, 29 and the parent OpenAPI candidate are stale. Its pinned source set omits the Identity, Project Manager and Platform Control charters and canonical PRD. The proposal declares six coverage states while examples use twelve labels; ten labels are unmapped. Three owner mismatches and all fourteen questions remain open. The earlier 37/39 coordinator comparison is historical, not the current result.

PMR-026 matched 40/40 historical `cd3c9f…` blobs and 36/40 current files; documents 14, 16, 20 and 29 are stale. All twelve owner questions and owner approvals remain open. Its earlier 37/40 coordinator comparison belongs to an older snapshot and is not evidence that the later historical count missed document 16.

PMR-032's earlier exact review recorded 25/25 source pins; the current source manifest is 23/25 (documents 16 and 20 stale) and all three recorded DAG-context hashes are stale. All nine gaps remain open, including owner-bound CSRF, and PMT-032 proof was not run. The older 24/25 comparison is not the current result.

The v0.9.20b governance run is recorded in `C:\Users\pc\.codex\backups\zuri-ai-pm-spec-20260929\fr272-v0.9.20b-postrecord-governance-result-20260930.json` (SHA-256 `5cf60fd661c5597afecaa6896d9c3e06711270123f27bf634f9c070c83e0bb20`). It ran once and exited 0: graph 3,893 nodes / 16,441 edges / 5 dangling; `docs:check` PASS; strict preflight 558 documents / 330 routes / 905 test files enumerated / 0 critical / 22 warnings / 34 info (WARN). The test-file count is inventory only. Two generated outputs changed; all other pre-existing path hashes remained unchanged. Product tests, build and implementation were NOT_RUN. This result verifies only its v0.9.20b preimages. The subsequent root decision and any governance result bind separate exact hashes recorded in the delivery-plan receipt ledger.

The 43-package DAG now records 3 ACCEPTED, 11 CANDIDATE_READY_FOR_REVIEW, 25 PLANNED, 1 BLOCKED_FOR_DESIGN and 3 BLOCKED_OWNER_CONTRACT packages. PMR-020 is PLANNED for a refreshed successor. `dispatchable=false` and `implementationAuthorized=false` remain in force; owner, SPEC/G0, canonical registration and downstream acceptance remain open or blocked.

## 19. v0.9.21b exact-composition decision — 30 September 2026

Luna Max returned PASS for the exact pre-receipt composition, Terra returned `GO_WITH_LIMITS`, and Astra returned `CONCUR WITH LIMITS`. The decisions bind only these v0.9.21b preimages: plan JSON `357b56d47f4edecfa64993b379055609bff5cbdefa63896771f754d8c168dc0e`, this evidence document `0ac186d36474bfe442b34fc6232066b07a56e8ba9495b093b1179b88046626eb`, and delivery-plan document `3900c0a69d5e112eb38d799c2fc837a99c9e1f16823dedf0e69c6af1c548c9d0`. The new v0.9.22b candidate records the outcomes; it is not presented as the reviewed preimage.

The checked DAG remains 43 packages, 90 edges and 13 waves, with all 33 PMR dispositions resolved. PMR-032 is currently 23/25 (documents 16 and 20 stale); 24/25 is an intermediate snapshot. Its three DAG-context hashes, nine gaps and PMT-032 proof remain stale/open/NOT_RUN. PMR-020 remains a non-binding historical issue inventory pending a refreshed successor. `dispatchable=false` and `implementationAuthorized=false` remain in force.

The exact pre-receipt rollback snapshot is `C:\Users\pc\.codex\backups\zuri-ai-pm-v0.9.21b-prereceipt-20260930-123349`; its manifest SHA-256 is `f878e0df1a21f57864698ce7d856b501e1f775706e68c64ba1ccd072d72facf8`, and all 68 entries were verified. The v0.9.22b documentation-governance result is recorded with its own source hashes in the delivery-plan receipt ledger. Product tests, build, implementation, owner acceptance, canonical registration and SPEC/G0 closure remain NOT_RUN, open or blocked.

## 20. PMR-029 v0.1.2b exact review and bounded composition — 30 September 2026

PMR-029 candidate v0.1.2b has raw SHA-256 809a0b62f675b0c0b8207eb87e00047d7af565c8c4825b4eedd76cc218796018. Luna Max returned PASS, Terra returned CONDITIONAL GO, and Astra returned CONCUR WITH LIMITS for candidate-receipt composition only. The requested model assignments were gpt-6-luna/max, gpt-5.6-terra/max and gpt-6-astra/high; runtime model identity was not independently exposed by the agent interface. All decisions bind to the v0.9.22b delivery-plan preimage SHA-256 9e0fcc435d73c1d822eaf273324eb5c20bda347678812f734118b52e052b577f.

The v0.1.1b rollback copy has SHA-256 62e66be073e0569667e90292cb82948461ea491c254111c10182e87e7af41f5e, matching the candidate immediate-predecessor record; the v0.1.0b predecessor remains preserved. Review confirmed all 12 current raw source pins, seven promotion gates OPEN, promotionAllowed=false and promotionStatus=BLOCKED. All five owner approvals remain OPEN; all 13 targets remain proposed, and all five scenarios are NOT_RUN. Executor/runner ownership remains unresolved. The ten disabled authority flags remain false.

The pre-receipt rollback snapshot is C:\Users\pc\.codex\backups\zuri-ai-pm-v0.9.22b-prereceipt-20260930-224941; its final manifest SHA-256 is 5ba5fc9c7ff1fe51c8293f018c9bfc1883ccbdbe1b17cb957d642ea0f658ac3a and all 13 entries were hash-verified. The delivery plan now records the v0.1.2b candidate hash. PMR-029 remains proposal-local pending canonical FR registration; the existing PARTIAL_REUSE reference to FR-252 is not PMR-029 acceptance or canonical registration. The checkout remains dirty and detached at a34ceaf79c112e02b1bcfdbf0a84122d835b002e; remote freshness is UNVERIFIED.

This receipt authorizes only recording the exact candidate review and bounded decision. It does not approve target values, owner contracts, canonical registration, SPEC/G0, promotion, dispatch, codegen, implementation, tests, build, runtime, provider activity, credentials, migration, distribution, deployment, release, product acceptance or production operation. The v0.9.23b composed files are new candidate bytes and are not pre-reviewed by these candidate-level decisions.

## 21. PMR-029 v0.9.23b post-write validation review and v0.9.24b receipt — 30 September 2026

Luna Max returned PASS, Terra returned CONDITIONAL GO, and Astra returned CONCUR WITH LIMITS after independently reviewing the exact v0.9.23b plan preimage SHA-256 `95a334aa76ffa9bd570e756a5539c661c2a4dc749045f66abd0cdadd6696a678`, this evidence preimage SHA-256 `be17cc371944f56d93da7b59c4ecac532c2058565a4c4de59e07955ff7132c99`, and delivery-plan document preimage SHA-256 `5d78c2ff28e7c2c0d3cb892c4a65c80dba88fd2889dfbe52ae7ad52b60acee50`. The PMR-029 v0.1.2b candidate remains SHA-256 `809a0b62f675b0c0b8207eb87e00047d7af565c8c4825b4eedd76cc218796018`; its distinct proposal source `docs/domains/project-manager/requirements/PMR-029-proposal-requirement.md` is SHA-256 `e0c26479fa7c7d3df484414b85836ecb282e3987a2292f675068df994407943d`, matching the candidate raw source manifest.

The exact review verified strict JSON parsing; 43 unique packages, 90 dependency edges, 13 topological waves, no missing dependencies or cycles; 12/12 source pins; and 13/13 rollback entries. The external rollback manifest SHA-256 is `5ba5fc9c7ff1fe51c8293f018c9bfc1883ccbdbe1b17cb957d642ea0f658ac3a`. A fresh 15-entry pre-receipt snapshot for v0.9.23b has manifest SHA-256 `2c52d7ed0b9df16fd6f3f6fdff42c03abbfd0aa15a350f921212b03393d0cfaa`.

All seven PMR-029 promotion gates remain OPEN; promotion remains BLOCKED; five owner approvals remain OPEN; all 13 targets remain proposed; five scenarios remain NOT_RUN; all ten disabled flags remain false. Executor/runner ownership remains UNRESOLVED. The plan remains `dispatchable=false` and `implementationAuthorized=false`. PMR-029 remains proposal-local, pending canonical registration and owner acceptance; FR-252 PARTIAL_REUSE is not PMR-029 acceptance or canonical registration. The candidate's historical internal deliveryPlanBinding remains explicitly stale to its earlier plan preimage. Worktree is dirty and detached at `a34ceaf79c112e02b1bcfdbf0a84122d835b002e`; remote freshness is UNVERIFIED.

The v0.9.24b delivery-plan candidate records only this bounded review and validation. It does not approve candidate targets, owners, canonical registration, SPEC/G0, promotion, dispatch, implementation, test/build, runtime, provider, credentials, migration, distribution, deployment, release, product acceptance or production operation. The composition syntax/version-mirror root cause is documented in `.brain/rca/2026-09-30-pmr029-composition-json-and-version-mirror.md`.

## 22. MA-D02 A4 current-byte audit and bounded candidate-only status receipt — 1 October 2026

The reviewed pre-receipt bytes are delivery plan v0.9.24b SHA-256 d2da7c87f7f36a67e927647cacac1dde9e30bb9f5bb12e4b0e27ed560e57e78d, this evidence document 5b1912bcbc687e41e157a2938bed27270a0ba6b41492e4fb367fdb24dbee052c, and delivery-plan document 2f0c8298d5fdce38f309ce9b392726bf881613c890f8454a9cddc23ffc6a5ae2. Luna Max independently confirmed all 12 MA-D02 package artifact pins and all 17 G0 source/output/RCA pins against current raw local bytes. The exact G0 candidate is ma-d02-navigation-a4-g0.candidate.json, SHA-256 70b6a7b1c0d51d5e6ce1c9673ec292e620966f590d2f8601a4c558068738cbda; its gate decision remains GO_WITH_LIMITS_CANDIDATE_ONLY.

The G0 artifact records Luna PASS, Terra PASS and Astra APPROVE_WITH_LIMITATIONS for that exact candidate. The independent current-byte Luna audit returned CONDITIONAL PASS for recording a bounded receipt. The A4 navigation and UX candidate files still declare reviewBoundary status PENDING and require fresh exact selected review. This receipt preserves those fields and does not treat them as cleared. MA-D02 remains CANDIDATE_READY_FOR_REVIEW.

SPEC-G06 navigation parity, SPEC-G08 executable conformance/runtime acceptance and SPEC-G09 canonical registration/per-slice baseline remain open. Business Home shortcut ownership/personalization and Home/Risks owner decisions remain open; Workforce UI bindings remain deferred to MA-D02W; inherited A3 allocation hints remain non-authoritative pending current ID-ledger review. Fixture execution and product acceptance are NOT_RUN. Global dispatchable and implementationAuthorized remain false. The checkout is dirty and detached at a34ceaf79c112e02b1bcfdbf0a84122d835b002e; origin/main freshness is UNVERIFIED.

Before composition, root created a 29-entry rollback snapshot of the source preimages, generated-output preimages and the exact MA-D02 review inputs: C:\Users\pc\.codex\backups\zuri-ai-pm-v0.9.24b-prereceipt-ma-d02-20261001-002440. Its manifest SHA-256 is 90853fc04ab1d3d6bcb7db40a81e9db9ed5b6eec995cb79e3405c20f3660713b, and all 29 copies were verified. This composition records only the exact candidate-only review disposition. It grants no owner, canonical, SPEC/G0, acceptance, promotion, dispatch, implementation, runtime, migration, deployment, release or production authority. Product tests/build were not run.

## 23. FR-272 current-byte exact review and bounded receipt — 1 October 2026

The exact pre-receipt bytes are delivery plan v0.9.25b SHA-256 3818e842a692cf3d593b001944611136cf93da9420f6b6c1cb766e1dec8f1262, this evidence document b58359c343951e56547c93e04e3a510a196be27a471d86b5cbb6880cd21fec5, and delivery-plan document b2c285c5b9dc3feebef9e773a209baf0db0952338757bdfa9f50063bd8a785f8. Luna Max returned PASS_WITH_LIMITATIONS, Terra returned GO_WITH_LIMITS and Astra returned APPROVE_WITH_LIMITATIONS for the same five raw candidate inputs; all five hashes are recorded in the delivery plan receipt. The older embedded FR-272 receipts bind historical v0.9.18b plan bytes and remain historical evidence only.

The reviewers agree that PMR-013 maps to registered FR-272 and FR-196 remains separate Identity/SoD context. A-07 distinguishes identical-decision idempotency, conflicting-decision CAS and audit-append rollback; all three proofs remain UNVERIFIED and no confirmed behavioral defect is asserted. A-08 historical projection, A-09 outcome reconciliation and A-12 deployment profile remain proposed contracts. Identity recorded-decider authority, Integration/domain outcome reconciliation, executor wiring, deployment-owner decisions and remaining G0 evidence remain OPEN.

Before this composition, root saved and verified rollback snapshot C:\Users\pc\.codex\backups\zuri-ai-pm-v0.9.25b-prereceipt-pm-fr272-verified-20261001-010029; its manifest SHA-256 is bbe81adfb1b93624d6eb03e49b6c39c7071c0267a14ca851748538fe51df7a60 and all 20/20 files match. The plan records only a candidate-design review receipt. PM-FR272-ACCEPTANCE-DESIGN remains CANDIDATE_READY_FOR_REVIEW; canonical/SPEC/G0 acceptance, dispatch, implementation, tests/build, runtime, provider activity, migration, deployment, release and product acceptance remain unauthorized, OPEN or NOT_RUN. Global dispatchable and implementationAuthorized flags remain false. The newly composed v0.9.26b bytes were not pre-reviewed as decision preimages.

## 24. Five-candidate review batch and bounded cross-document sync — 1 October 2026

This receipt records the exact v0.9.29b candidate-pointer batch and the separately authorized synchronization of Documents 08 and 20. The candidate decisions bind delivery-plan v0.9.28b preimage SHA-256 720a82a4745dfc86f96eed469ffca3bb95969647c7c99af95eb28221a9094095. The cross-document sync decision binds plan v0.9.29b SHA-256 6497381b4f92d37adf17065a7b22758a3f7c6d40a9dd4c44033810d211191d6b, Document 08 preimage a892e5a1c6f52fe6d8f2cd5b6dba0f175212adfe6d759e2522dbc79ab7c93ddd, and Document 20 preimage 687fbd85adbd5394c59672f061d72ddddebb32c0833a390f2f637c467ab0ed1c.

| Candidate | Exact candidate SHA-256 | Luna Max | Terra-role decision | Astra decision | Plan-only pre-document-sync pin snapshot |
|---|---|---|---|---|---|
| PMR-020 v0.1.3 | ac7a7ff26dac134d15a0603106d76ff8aeb771d3eeccb01d381099ee546703dc | PASS | GO_WITH_LIMITS, user-authorized GPT-6-Sol fallback | AGREE_WITH_LIMITS | 49/49 before plan composition; 48/49 after plan-only composition |
| PMR-025 v0.1.3 | efd7887e3ffaf8b8cde2c8b0a8b765bf599560bec19fd9ce7df211fff18ba03f | PASS | GO_WITH_LIMITS, user-authorized GPT-6-Sol fallback | AGREE_WITH_LIMITS | 44/44 at review; 43/44 after plan-only composition; 39/44 historical cd3 matches |
| PMR-031 v0.1.0 | 9105ec64cc2e438328b525d806aae103ae74c67c8dd9d1b8240a0c4620e20c29 | PASS | GO_WITH_LIMITS, user-authorized GPT-6-Sol fallback | Literal delegated-receipt verdict GO_WITH_LIMITS; plan matrix records normalized AGREE_WITH_LIMITS | 22/22 at review; 21/22 after plan-only composition |
| PMR-032 v0.2.4 | 1915e240a0deaf677f0d88357c682e45f3e5ebc1e25c7581d255807b65051037 | PASS | GO_WITH_LIMITS, user-authorized GPT-6-Sol fallback | AGREE_WITH_LIMITS | 25/25 source and 3/3 context at review; 25/25 source and 2/3 context after plan-only composition |
| PMR-033 v0.1.3 | 713a5dab27205d87c08d07eecf9845cefdcc81bb6fa7b14b75beeda5fa6b7fe6 | PASS | GO_WITH_LIMITS, user-authorized GPT-6-Sol fallback | AGREE_WITH_LIMITS | 31/31 at review; 30/31 after plan-only composition |

The pin counts in this table are receipt-time plan-only snapshots, before the Document 08 and Document 20 edits in this version. They are historical and must not be described as post-sync current counts. PMR-031 Astra is reported literally from the delegated receipt; the AGREE_WITH_LIMITS field in the plan is a normalized matrix summary.

The plan has 43 packages, 90 dependency edges and 13 topological waves, with no unresolved dependency references or cycle in the reviewed candidate inventory. Counts are 3 ACCEPTED, 12 CANDIDATE_READY_FOR_REVIEW, 24 PLANNED, 1 BLOCKED_FOR_DESIGN and 3 BLOCKED_OWNER_CONTRACT. Only PMR-020 changed from PLANNED to CANDIDATE_READY_FOR_REVIEW. All five reviewed artifacts remain candidate-only; no owner or canonical acceptance is recorded.

PMR-020 governance HOLD remains in force. Prior generated-output differences retain cause UNKNOWN; a fresh external 13-path rollback audit and explicit Astra lift are still required before any governance run. Owner acceptance, canonical registration, G0/SPEC, downstream use and execution gates remain open, blocked or unauthorized. Remote freshness is UNVERIFIED; governance, product tests, build, implementation, runtime, deployment and release remain NOT_RUN. dispatchable=false and implementationAuthorized=false.

The plan batch preserves the user-direction receipt c43f4ae5928cff4b335a41d643083e9663a908faea088373ee4ae25e9a816b83 and the verified three-entry candidate-batch rollback snapshot. Before this two-document sync, root created a separate local rollback snapshot at C:\Users\pc\.codex\backups\zuri-ai-pm-docsync-prereceipt-20261001-095009; manifest SHA-256 3c0bd2c20182bfd21eba32e46d7cfb2bb45bf5272276d4572e73af6c31910a6a; both exact document preimages were hash-verified. This bounded sync changes only Documents 08 and 20 and grants no additional acceptance or execution authority.

## Six-candidate composition evidence — 2026-10-03

This is the historical six-candidate composition snapshot: “Current plan” below means v0.9.33b at that composition. Later plan versions do not change those reviewed candidate bytes or receipts.

The root receipt root-v0.9.33b-six-candidate-pointer-composition-2026-10-03 records a pointer-only composition in [delivery-plan.candidate.json](contracts/delivery-plan.candidate.json). Current plan v0.9.33b is SHA-256 9212ac2c416ade963564ede455c5917e5a07c06c19bfd1bf6075696e74808695; the reviewed v0.9.32b preimage was a9d5beb4abfe5a6ce4ef6a9161bd750d230cc0024de28410479535bade8bcc7d.

Luna Max returned exact-candidate review PASS. The user-authorized GPT-6-Sol fallback served as Terra's decision role and returned GO_WITH_LIMITS for composition; Astra concurred with limits. All six candidate bytes are unchanged and all six packages remain CANDIDATE_READY_FOR_REVIEW.

| Work package | Exact candidate path and version | SHA-256 |
|---|---|---|
| PMR-020-USAGE-SCOPE | docs/architecture/project-manager-system/contracts/pmr-020-invocation-usage.v0.1.4.candidate.json · 0.1.4b | 3722c6ff728cd6ffb00984fcba81bdcc5351a1cd422382b62a2851d862f7ef30 |
| PMR-025-BUNDLE-DESIGN | docs/architecture/project-manager-system/contracts/pmr-025-design-bundle.v0.1.4.candidate.json · 0.1.4 | de4326ea6bb0d9aed378230b6def5dc9b8167b24640364c4a6b1923103561bc0 |
| PMR-029-OPS-ACCEPTANCE-MAP | docs/architecture/project-manager-system/contracts/pmr-029-ops-acceptance.v0.1.4b.candidate.json · 0.1.4b | bbbab0fa27533a25d65782b03b4d022f5e055642e9f283b0679bbf85e0da5665 |
| PMR-032-GOVERNANCE-GAP-MAP | docs/architecture/project-manager-system/contracts/pmr-032-governance-gap.v0.2.5.candidate.json · 0.2.5 | 54a8e72f1ef0b54ace3cc4342957ba5829ebdee1d547aba5fba9c877fe210736 |
| MA-D03 | docs/architecture/project-manager-system/contracts/ma-d03-workforce-inputs-history.v0.1.4.candidate.json · 0.1.4 | f40775f4001a23bb134e87bc19d19e8fd5338f52db274b60a0a66f8e7a0d2bb6 |
| MA-D06 | docs/architecture/project-manager-system/contracts/ma-d06-provider-agent-ledger.v0.1.2b.candidate.json · 0.1.2b | bd18d65d1160fdffb430ad8a6bc7d67e682cd2b293a8c824a9aa21c81eb35a5f |

Review-time source-pin checks were PMR-020 49/49, PMR-025 44/44, PMR-029 12/12, PMR-032 25/25 source plus 3/3 DAG context, MA-D03 14/14 and MA-D06 23/23. These checks are bound to the reviewed preimage; plan-derived pins became historical after pointer composition. The plan still has 43 work packages, 90 dependency edges and 13 waves: 3 ACCEPTED, 12 CANDIDATE_READY_FOR_REVIEW, 24 PLANNED, 1 BLOCKED_FOR_DESIGN and 3 BLOCKED_OWNER_CONTRACT.

Open limits remain: PMR-020 has 14 questions and 3 mismatches; PMR-025 has unresolved read-only GET versus immutable ArtifactRevision write lifecycle, writer, transaction and authorization boundaries; PMR-029 has 13 resource budgets/units/ceilings/owners UNSET, five scenarios NOT_RUN and open gates; PMR-032 has nine gaps open and PMT-032 NOT_RUN/NOT_PROVEN; MA-D03 retains A-Q1 through A-Q8 and seven execution-mode mappings open; MA-D06 retains 11 owner decisions open, 11 acceptance criteria and 14 fixtures NOT_RUN, and producer mapping unresolved. No owner acceptance, canonical registration, baseline/G0/SPEC closure, dispatch or implementation authority is granted. Remote freshness remains UNVERIFIED.

### Governance evidence and receipt-hash correction

Astra authorized exactly one npm run govern for PMR-020 v0.1.4b SHA-256 3722c6ff728cd6ffb00984fcba81bdcc5351a1cd422382b62a2851d862f7ef30, bound to fresh 13-path snapshot manifest SHA-256 56d636af24f3e29f810682783dd80f01a6f3a89330139a18be75d6884fe32741. That single run finished before this plan composition: exit 0, PASS_WITH_WARNINGS; graph 3,893 nodes / 16,441 edges / 5 dangling legacy test edges / 2 changed nodes; docs:check PASS; strict preflight 0 critical, 22 warnings, 34 info, WARN.

| Generated output | Before SHA-256 | After SHA-256 |
|---|---|---|
| docs/.doc-graph.json | 5d59282f1a4bd807ca7f460c711fa87439a55d85818a9902cbf46ccb69147dd7 | 9cdbbd43f6fd374c1cc6e33cf4859d943bcdfa8c81b824f199ab2b2b09733100 |
| docs/.doc-graph-drift-report.json | a1196a9c432fe47529a24f768d9e735c9b97eaa1b92621dffc18a851bd184bfc | abf9671216c333cc82172f5863c6adb8ec1c531e8d5865533097615064fcad00 |
| docs/.preflight-report.json | a488edaedf142627c03631fdb5cdee268df69538757df3003251a6c1e92bf9c2 | b248ea3805ab5369e6bdc4007022182bbef87f361c47df60cfaeb2b3c348e12a |

The root receipt's copied preflight-before hash had a one-character transcription error (c where the snapshot records e). It was corrected in the plan and documented in [the RCA](../../../.brain/rca/2026-10-03-pm-spec-governance-receipt-hash-transcription.md), SHA-256 3abfefd9911ef8f5bca12674a1b3b5cc2599dfc2db9b97386c3b27398df7ff8c. The erratum rollback manifest is 2b273043aafdecb6d7c56d45ab3f6c92f2d05956207a78cccc16fc1ff10193cf; governance outputs and candidate bytes were not edited by the correction.

This document sync has its own verified 2/2 rollback snapshot: C:/Users/pc/.codex/backups/pm-spec-docsync-v0933b-rebound-preimage-20261003-024403, manifest SHA-256 c06b950f2cd5fbd0ac6b1527f8f75352470d248850aacdfa8dc93548d5fe4659, bound to the corrected plan SHA above. The earlier governance run is pre-composition evidence only. Governance after this document sync is PENDING/NOT_RUN and requires a fresh 13-path snapshot and a new Astra decision. Product tests, build, implementation, provider activity, migration, runtime, deployment and release are NOT_RUN.

## PMR-025 v0.1.1 candidate-preparation gate — 2026-10-03

Delivery-plan v0.9.35b SHA-256 `c47086175816de32c5a28894d8fbf7f73ce7e6a55d94420f3813023605bd8573` records root receipt `root-pmr025-conformance-historical-unknown-resolution-2026-10-03`, following Terra's user-authorized GPT-6-Sol fallback verdict GO_WITH_LIMITS and Astra's CONCUR_WITH_LIMITS. This resolves the return-to-root stop only for preparing one candidate from a freshly enumerated current read set after this reviewed document synchronization. It does not assert historical compatibility.

| Historical input | v0.1.0 expected SHA-256 | Current-at-resolution/pre-sync SHA-256 | Comparison |
|---|---|---|---|
| Document 08 | `4c4591e1876e845d061c366f1e882370c65433981ddb63cd3e54bdfe17a22d69` | `525f2bf7edb8211378cbe274604e4160e0567e03bb2bdeae717df0ea5cfcbc5f` | UNKNOWN; exact preimage not recovered |
| Document 20 | `2b41c410c5073b961d9f6412cad8427b0303c0c3eac511dcaa056a3163f1afd8` | `bf9cc14153871257b8308b6c2a56d50580e1ec0c398005d136224408beed334b` | UNKNOWN; exact preimage not recovered |
| Delivery plan | `a774f13d56016a5eafdd92cc4c2ca9563a137453515ef2786ed79a2bb64f0e76` | `49a09ae9c4068c2e7f5b9bdfef2e04a1d0dcdf35f5bdcf966fb86624b268919a` (v0.9.34b at resolution) | UNKNOWN; the recovered v0.9.33b preimage `9212ac2c416ade963564ede455c5917e5a07c06c19bfd1bf6075696e74808695` is a different revision |

The requirement-index input is a known, bounded drift: the recovered 23,722-byte preimage at `C:/Users/pc/.codex/backups/zuri-ai-pmr031-v0.1.1b-pre-successor-20261001/pm-requirement-index.json` hashes to `7091a09660dcb2ce27dbaed640221391040544b01224fe0261a440ed8c487f42`; current bytes hash to `4f64ac86412d0109fd924a6ca5283aa33010bd3994bc3f7cc8e3fbe167cc4165`. Replacing only `SCM/CI adapters` with `source-control and CI adapters` reproduces the complete current file; PMR-031.statement is the only changed JSON leaf and PMR-025 is unchanged.

The current v0.1.0 candidate remains the exact pointer at SHA-256 `4e34216aadaef9bb788f1257109319b190168e4df954417ee28767f4436a6eee`; its prior review receipts are preserved. Successor v0.1.1 is authorized as an output target only and is absent and unreviewed at this snapshot. All nine conformance owner questions remain open and all ten proofs remain PLANNED_NOT_RUN. PMR025-Q11-EXPORT-LIFECYCLE remains a separate OPEN, owner-UNASSIGNED issue in the design-bundle candidate. G0 remains false; technical selection, owner acceptance, canonical registration, pointer composition, downstream use, dispatch and implementation remain closed.

The exact document preimages are protected by the verified 2/2 snapshot at `C:/Users/pc/.codex/backups/pmr025-successor-docsync-v0934b-preimage-20261003-b685651c`, manifest SHA-256 `6ae48114977b1da47d15a19ef882c929baea9147a688e9b55f3a92df33d3a0b5`. This snapshot's plan context is v0.9.34b; it is cited for the verified document bytes without relabeling that context. Governance remains NOT_RUN pending a fresh 13-path snapshot and separate Astra decision.


## MA-D08 v0.1.7 pointer composition — 2026-10-03

MA-D08 readiness v0.1.7 at contracts/ma-d08-readiness.v0.1.7.candidate.json, SHA-256 8df21201d71721188b4fc0a1e3871a9352f96d63c75f927179a5c694f0a689b2, is selected by root receipt root-ma-d08-v017-pointer-composition-2026-10-03 in delivery-plan v0.9.36b. Exact candidate reviews are Luna Max PASS, Terra fallback GPT-6-Sol APPROVE_WITH_LIMITS, and Astra CONCUR_WITH_LIMITS. The separate pointer decision is Terra fallback GPT-6-Sol GO_WITH_LIMITS, and Astra GPT-6-Astra CONCUR_WITH_LIMITS on exact V9; exact postimage audit, insertion anchors and prewrite hashes remain mandatory. Plan preimage v0.9.35b SHA-256 c47086175816de32c5a28894d8fbf7f73ce7e6a55d94420f3813023605bd8573; rollback manifest SHA-256 ed988d6390fe1551943e061e1e0ff18a635bf717b0cf04d2306cc22c60d693e2, 4/4. The versioned sibling was prepared under a one-time root exception because the existing MA-D08 fileBoundary and Doc20 writer row name the base readiness path; this receipt treats v0.1.7 only as a read-only immutable review snapshot and does not grant a general worker write scope. The existing fileBoundary and Doc20 row remain unchanged. Candidate bytes and predecessor versions remain unchanged. All three v0.1.7 plan/Doc08/Doc20 pins are historical after composition (3/3 at review, 0/3 current afterward). Pins in MA-D02 G0 v0.1.2b/v0.1.3b, PMR-025 conformance v0.1.1, and historical MA-D08 v0.1.5/v0.1.6 also remain historical; their reviews and acceptance do not transfer. MA-D08 remains PLANNED; registration/baseline/G0 pending; phase NOT_ISSUED; owner/SPEC gates open; dispatchable=false; implementationAuthorized=false; PMR-020 governance HOLD; remote freshness UNVERIFIED. No tests, build, governance, runtime, deployment or release are implied.

## 25. Exact MA-D01, MA-D02 and NFR review receipts — 3 October 2026

This bounded receipt records exact candidate reviews against delivery-plan v0.9.37b preimage SHA-256 `1c9b8548bcbd839d1a8d7ba47c26c8b11b3e0031b3103000f30c51dcba7bce3b`; Documents 08 and 20 preimages are `6a4a04ded6fa872803cdd69ce9f5c19195391fee97194bb267fca0932e7d27cb` and `010d33f4b12440a3d0e3a555006fc0bf0ac27062dccb4aecd6ca3aa69ffef571`. The resulting plan metadata successor is v0.9.38b. The matrix and reviewed candidate artifacts below remain byte-identical.

| Review scope | Exact reviewed bytes | Luna Max | Terra decision | Astra concurrence | Disposition |
|---|---|---|---|---|---|
| NFR applicability | Serialized matrix `5e76bbbe584047fbc218e8293900e51d6e6bfd2bc6c13859567ede52d0764ded` | — | GPT-6-Sol ACCEPT_WITH_LIMITS | GPT-6-Astra CONCUR_WITH_LIMITS | Scope classification only: 6 direct/scoped, 7 shared/conditional, 2 partial, 10 outside PM; all 15 applicable/overlap rows remain NOT_RUN. |
| MA-D01 allocation authority | `ma-d01-allocation-authority.v0.1.8b.candidate.json` · `6d9b6231619ebf4a1445d06cef3c4b3d8fa2118fd2b6398ee0f1297ef20cc3dc` | PASS | GPT-6-Sol ACCEPT (candidate-only with limits) | GPT-6-Astra CONCUR_WITH_LIMITS | 33/33 baseline inputs matched against plan v0.9.36b at review; after plan v0.9.37b composition, 32/33 remain current (15/16 document pins and 17/17 implementation pins; the sole historical pin is the v0.9.36b delivery plan). Twelve technical gates remain OPEN; package remains CANDIDATE_READY_FOR_REVIEW. |
| MA-D02 A4 bundle | Navigation .4.3b `fbbd0a6387607841ba3f6b8c09f528b6d0becd043d9750b3cdf70dc1fd0ba780`; fixtures .4.3b `35d2353de88bd35fa4e7343bf8050c99fdaceefb0b9402336ba1fa8ff0c99616`; UX .4.4b `0adda57de64601c050a0e9b77b253c4575ee673d0bd7b1cd9476fcdbd5c90308` | PASS | GPT-6-Sol ACCEPT_WITH_LIMITS | GPT-6-Astra CONCUR_WITH_LIMITS | Selected candidate bundle only; package remains CANDIDATE_READY_FOR_REVIEW. |

For MA-D02, selected UX v0.4.4b binds current UI system v0.2.1b SHA-256 `8f7e28f21ff81a07a299f8d906f0ddd1ad053a7458f6b6f7ace41662185c4748`; its v0.9.36b plan context is historical. Navigation/fixture v0.4.3b historical Doc11 and UX references remain unchanged, including fixture `uxUiRef`/`patchRef` to UX v0.4.3b. G0 v0.1.3b remains PENDING_REVIEW and UNINTEGRATED_NOT_SELECTED (`ec7bc5abd7451cf290604cc0617a74baf461919453eb4c57176ed05de88d4f01`); its Doc22 patch remains PROPOSED_NOT_APPLIED; SPEC-G06/G08/G09 remain open. WF-04/WF-06 remain PROPOSED_UI and fixture acceptance remains NOT_RUN. MA-D01's MA-D06 predecessor dependency remains historical and unchanged.

NFR-024/025 and FEAT-043 status-prose discrepancies remain OPEN for source reconciliation; no registry IDs or source rows changed. The exact reviewed NFR object retains its original embedded PENDING marker byte-for-byte; this root receipt records the later reviewer outcomes separately. These decisions do not establish NFR satisfaction, domain-owner acceptance, canonical registration, G0/SPEC passage, dispatch, or implementation.

The 43-package DAG remains 43 work packages, 90 dependency edges and 13 waves: 3 ACCEPTED, 12 CANDIDATE_READY_FOR_REVIEW, 24 PLANNED, 1 BLOCKED_FOR_DESIGN and 3 BLOCKED_OWNER_CONTRACT. `dispatchable=false`; `implementationAuthorized=false`. Remote freshness is UNVERIFIED. Tests, product build and governance are NOT_RUN.

Before composition, root created and verified a four-entry local rollback snapshot at `C:/Users/pc/.codex/backups/pm-spec-receipt-preimage-20261003-223522`; manifest SHA-256 `f1882209441726c81318a495fa515851dd250fe5f59d0d16a827a92085d9c3bc` (4/4 entries). It contains exact preimages of the delivery plan, Documents 08 and 20, and the dashboard. Any later governance run requires a fresh exact 13-path snapshot and a separate Astra lift.
## CHANGELOG## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.9.28b | 2026-10-03 | candidate | Record exact candidate-only MA-D01, MA-D02 A4 and NFR applicability review receipts under plan v0.9.38b; preserve rollback and all open gates | uncommitted | Codex |
| 0.9.27b | 2026-10-03 | candidate | Record bounded MA-D08 v0.1.7 pointer composition, three historical context pins and verified rollback; keep baseline/G0/phase/dispatch/implementation gates closed | uncommitted | Codex |
| 0.9.26b | 2026-10-03 | candidate | Record v0.9.35b resolution of the PMR-025 historical UNKNOWN gate for candidate preparation only; preserve exact predecessor, pointer, open questions, proofs and execution gates | uncommitted | Codex |
| 0.9.25b | 2026-10-03 | candidate | Record the corrected v0.9.33b six-candidate composition, the one pre-composition governance run and receipt-hash RCA; post-sync governance remains pending | uncommitted | Codex |
| 0.9.24b | 2026-10-01 | candidate | Record the exact five-candidate review batch and bounded two-document sync; preserve historical pin boundaries, owner holds and execution gates | uncommitted | Codex |
| 0.9.23b | 2026-10-01 | candidate | Record the exact current PM-FR272 Luna/Terra/Astra candidate-only review receipt with a verified rollback snapshot; preserve owner, proof, canonical and execution gates | uncommitted | Codex |
| 0.9.22b | 2026-10-01 | candidate | Record exact MA-D02 A4 current-source review and bounded candidate-only status receipt; preserve pending review markers and open SPEC/G0 gates | uncommitted | Codex |
| 0.9.21b | 2026-09-30 | candidate | Record the exact v0.9.23b post-write review by Luna/Terra/Astra and root validation receipt; preserve open PMR-029 and execution gates | uncommitted | Codex |
| 0.9.19b | 2026-09-30 | candidate | Record Luna exact-composition PASS and Terra/Astra root GO_WITH_LIMITS / CONCUR WITH LIMITS for v0.9.21b preimages; preserve review scope, rollback proof, and all owner/SPEC/G0/canonical/dispatch/implementation gates | uncommitted | Codex |
| 0.9.18b | 2026-09-30 | candidate | Record v0.9.20b governance outcome and exact PMR-020/026/032 candidate dispositions; correct the PMR-020 DAG state and keep owner/SPEC/G0/canonical/dispatch/implementation gates open | uncommitted | Codex |
| 0.9.17b | 2026-09-30 | candidate | Record exact v0.9.19b post-receipt governance observation, preimage hashes, warning counts and rollback proof; clarify old pending markers and keep tests/build/implementation NOT_RUN | uncommitted | Codex |
| 0.9.15b | 2026-09-30 | candidate | Record MA-D03 v0.1.2 authoring verification and exact Terra/Astra candidate decisions; append the v0.9.14b pre-receipt governance observation; preserve owner, SPEC/G0, canonical, dispatch and implementation gates | uncommitted | Codex |
| 0.9.14b | 2026-09-30 | candidate | Compose exact PMR-032 v0.2.1 and PMR-033 v0.1.2 review receipts; record post-composition source-pin counts and preserve owner, SPEC/G0, canonical, MA-D03, implementation and governance gates | uncommitted | Codex |
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
| 0.9.0b | 2026-09-29 | candidate | Pin current execution baseline; record all-PMR DAG, delegated Terra/Astra decision gates, owner boundaries and exact verification limits | source a34ceaf7; uncommitted | Codex |
| 0.9.1b | 2026-09-29 | candidate | Record Astra's disjoint-file ownership ruling and Terra's bounded acceptance of the corrected Phase-B synthetic receipt; no product suite or production operation claimed | uncommitted | Codex |
| 0.9.2b | 2026-09-29 | candidate | Record the fresh PMR-032 governance-gap candidate and keep its old hash-mismatch packet blocked | uncommitted | Codex |
| 0.9.3b | 2026-09-29 | candidate | Record MA-D01 candidate dependency receipt and authorize PMR-029/MA-D06 candidate-only drafting with pinned inputs; MA-D03 remains blocked | uncommitted | Codex |
| 0.9.4b | 2026-09-29 | candidate | Record candidate review outcomes where receipts exist, preserve unresolved PMR-025 review evidence, and keep owner, canonical, runtime and product-acceptance gates open | uncommitted | Codex |
| 0.9.5b | 2026-09-29 | candidate | Record MA-D08 candidate review and root dependency reconciliation; preserve the pinned discrepancy and keep registration, baseline acceptance, SPEC-G and implementation gates open | uncommitted | Codex |
| 0.9.6b | 2026-09-29 | candidate | Record exact PMR-025 Luna/Terra/Astra candidate-review receipts and 41/44 coordinator reconciliation; record predecessor receipt-time owner questions and canonical/implementation holds | uncommitted | Codex |
| 0.9.7b | 2026-09-29 | candidate | Add exact MA-D02 A4/G0 review and Phase-B seven-pointer application receipts; refresh enumerated artifact counts and preserve SPEC-G, owner, canonical and runtime blockers | uncommitted | Codex |
| 0.9.8b | 2026-09-29 | candidate | Record scoped user-approved PMR-025/Workforce direction, successor candidate hashes and the verified 71-file rollback snapshot; retain technical owner and implementation gates | uncommitted | Codex |
| 0.9.9b | 2026-09-29 | candidate | Record exact Terra/Astra review of the PMR-025 and MA-D01 direction successors and receipt; preserve all owner, canonical and implementation gates | uncommitted | Codex |
| 0.9.10b | 2026-09-29 | candidate | Record composed governance: docs:check passed and strict preflight had 0 criticals; disclose existing warning classes and keep product tests/build NOT_RUN | uncommitted | Codex |
| 0.9.11b | 2026-09-30 | candidate | Record PMR-025 docket and MA-D03 v0.1.1 exact-review outcomes, update local origin observation and file inventory, retain rollback proof and owner/canonical/implementation gates | uncommitted | Codex |
| 0.9.12b | 2026-09-30 | candidate | Record exact Luna Max/Terra/Astra review of the PMR-025 conformance candidate; retain G0, owner, canonical and implementation gates | uncommitted | Codex |
| 0.9.13b | 2026-09-30 | candidate | Record exact PMR-033 v0.1.1 Luna/Terra/Astra reviews and reconciled pre-receipt governance; retain the historical predecessor and stale plan pin, keep post-receipt governance pending, and preserve owner/SPEC/G0/canonical/MA-D03/implementation gates | uncommitted | Codex |
