---
id: ZAI:PM-SPEC-READINESS
title: Specification completeness and API reference audit
version: "0.3.0b"
status: candidate
created_at: "2026-09-16T03:55:57+07:00,RWANG,design base 087f3025"
last_update: "2026-09-16T15:34:10+07:00,RWANG"
superseded_by: null
attributes:
  doc_type: architecture-specification
  domain: project-manager
  scope: Evidence-based completeness of candidate contracts and code generation readiness
relations:
  - type: references
    target: ZAI:PM-SYSTEM-DESIGN
  - type: references
    target: ZAI:PM-SYSTEM-API
  - type: references
    target: ZAI:PM-WORKFORCE-DESIGN
---

# Spec readiness — มีอะไรแล้ว และอะไรยังไม่ครบ

**Outcome:** มี requirement/design, machine-readable contracts, API schemas และ API references แล้ว แต่ **ยังไม่ครบระดับ implementation-ready / spec-to-code**. การตรวจ OpenAPI ผ่านยืนยันโครงสร้างและ references ของ schema; ไม่ยืนยันว่าทุก workflow มี input/output ครบหรือ code ทำงานตรง spec.

This audit is C-2 documentation/review work. No application, schema migration, permission, credential or production endpoint is changed. The word contract below means a typed interface/data agreement, not a legal agreement.

## 1. Inventory ที่ตรวจจากไฟล์จริง

| Deliverable | Files | Current state |
|---|---|---|
| Requirements / behavior | [01 Requirements](01-REQUIREMENTS-AND-UX.md), [15 Workforce](15-WORKFORCE-CAPACITY-SCHEDULE-AND-PERFORMANCE.md) | 33 proposal requirements; workforce has 12 metric definitions and PMT-033 cases A–P |
| Architecture / ownership / diagrams | [02 Architecture](02-DECISIONS-AND-DIAGRAMS.md), [13 Navigation boundaries](13-DOMAIN-TAXONOMY-AND-NAVIGATION-BOUNDARIES.md), document 15 | 14 rendered diagrams; G14 is documented but is not in the G01 machine model |
| Logical data schema / table dictionary | [18 Tables & ERD](18-DATABASE-TABLES-AND-ERD.md), [data model](contracts/data-model.candidate.json) | 31 source models + 54 proposed logical records, typed fields, keys, invariants, indexes and 9 ERDs; exact physical adapter DDL/migrations remain pending |
| Main API contract | [openapi.candidate.yaml](contracts/openapi.candidate.yaml) | OpenAPI 3.0.3; **52 paths / 72 operations / 102 schema definitions**, candidate |
| Workforce API contract | [workforce.openapi.candidate.yaml](contracts/workforce.openapi.candidate.yaml) | OpenAPI 3.0.3; **8 paths / 8 operations / 30 schema definitions**, candidate |
| Workflow JSON Schema | [workflow.schema.json](contracts/workflow.schema.json), [example](contracts/workflow.example.json) | Structural schema and synthetic example, plus DAG semantic checks |
| Architecture contract | [architecture.model.json](contracts/architecture.model.json) | G01: 15 nodes / 20 edges with owners/contracts/directions; no claim that it contains every diagram |
| Traceability | [traceability.json](contracts/traceability.json) | 33 PMR → PMT families and contract/operation references; cases are planned product tests |
| Navigation and UX contracts | [navigation.candidate.json](contracts/navigation.candidate.json), [ux-ui.candidate.json](contracts/ux-ui.candidate.json) | Core navigation reconciled by document 22; deferred screen bindings explicitly excluded from generation; six Workforce screens and G14 graph remain open |
| Examples | [workforce.examples.json](contracts/workforce.examples.json) | Two synthetic response examples; workload arithmetic and closed-period performance cohort verified; does not cover every request/error/state |
| SRS and implementation blueprint | [17 SRS](17-SRS.md), [19 Blueprint](19-SYSTEM-BLUEPRINT.md) | 33 requirement families, 10 use cases, 5 architecture/runtime diagrams, typed blueprint and trace models; candidate |
| API reference prose | [06 API & contracts](06-API-AND-CONTRACTS.md), document 15 §8 | Endpoints, errors, auth, version/idempotency, streaming and owner boundaries |
| Swagger UI | Local review artifact `swagger-api.html` | Actual Swagger UI rendering of both contracts, added in this review; read-only documentation mode |

**Count semantics:** 80 operations and 132 schema definitions are the sum of two separately versioned OpenAPI files. They are not 125 database tables, not 80 deployed endpoints and not a completeness score. Keep the specs separate in the viewer because generic component/security names may differ in meaning.

The existing application also has FR-019's [OpenAPI generator](../../../apps/server/src/modules/project-manager/api-docs/openapi.js), which describes existing API behavior. This design package supplements that source; it does not replace the application's runtime `/api/docs`, and this review does not request a production spec or validate live authentication.

## 2. Workforce API reference

Prefix: `/api/businesses/{businessId}/workforce`. Full parameter, request-body, response, schema and error definitions can be expanded in the Swagger review.

| Method | Path suffix | operationId | Response / purpose |
|---|---|---|---|
| GET | `/workload` | getWorkforceWorkload | WorkloadResponse: counts, capacity, daily rows and coverage |
| GET | `/schedule` | getWorkforceSchedule | ScheduleResponse: fixed slots and effort budgets |
| GET | `/performance` | getWorkforcePerformance | PerformanceResponse: metric values, cohort metadata and coverage |
| GET | `/metrics/{metricKey}/evidence` | getWorkforceMetricEvidence | EvidenceResponse: authorized metric evidence rows |
| POST | `/plans/preview` | previewWorkforcePlan | PreviewInput → PreviewResponse: typed changes and conflicts |
| POST | `/plans/commit` | commitWorkforcePlan | CommitInput → Receipt: exact preview/version and idempotency |
| POST | `/time-logs` | submitWorkforceTimeLog | TimeLogInput → Receipt: draft/submit/review/correction intent |
| POST | `/metric-policies` | proposeWorkforceMetricPolicy | PolicyInput → Receipt: draft whitelisted KPI policy; approval contract remains open |

All eight operations are **PROPOSED_NOT_IMPLEMENTED**. A valid request example or rendered Swagger operation is not evidence of a running handler.

## 3. Implementation-blocking gaps

| Gap | Evidence in current package | Required closure before the affected code slice |
|---|---|---|
| SPEC-G01 Allocation authority | Document 21 and both composed OpenAPI files define one human allocation writer, canonical Person identity/minutes and an earlier-draft compatibility profile | DESIGN_RECONCILED_CANDIDATE; owner approval and runtime conformance remain required; non-human resource design is outside this closure |
| SPEC-G02 Workforce inputs/history | Document 15 requires typed estimates, team capacity shares, effective assignment and delivery history; PreviewInput changes contain calendar/availability/allocation only | Supply typed owner ports and mutation/event contracts for those inputs, including versioning, effective dates, status mapping for the seven execution modes and source deduplication |
| SPEC-G03 KPI review/corrections | Workforce API drafts policies; WF-R06 permits correction requests; main reviews are Project-scoped | Define Business/person/team policy review and correction lifecycle, read/list/detail, allowed transitions and reviewer authority; bind to an existing exact contract or declare the necessary interface |
| SPEC-G04 Metric shapes | Document 18 proposes discriminated result variants; current OpenAPI MetricResult still has one scalar value and no dimension/quantile discriminator | Define complete result shapes, sample/coverage states and examples for all twelve metrics; no undocumented array-order or repeated-key convention |
| SPEC-G05 Shared transport/security | Document 21 reconciles allocation errors, receipt/retry identity, preconditions and zuri_session; generic API CSRF is NEEDS_OWNER_BINDING | PARTIAL: Identity must define issuance, verification, same-origin check and client delivery; provider/ledger transport remains open |
| SPEC-G06 Navigation/diagram machine parity | Document 22 supplies six-module core mappings; deferred screen families retain explicitly non-generatable legacy bindings | PARTIAL: owner approval, remaining screens, six Workforce screens and linked G14 graph still required; G01 identity is preserved |
| SPEC-G07 Persistence/migration | Document 18 now specifies candidate fields/keys/indexes/temporal rules, transactions and adoption steps; physical adapter binding and executable migration contract are not reviewed | Review candidate table/reuse decisions, reconcile exact SQLite/Postgres mappings, implement/test scoped constraints and RLS/grants, and approve executable migration/backfill/rollback evidence |
| SPEC-G08 Executable conformance | Added positive/negative contract and navigation documentation fixtures; PMT-033 A–P remain planned service tests | Add contract examples for each request/error/lifecycle and then runnable tests against approved implementation. Static examples must not count as service tests |
| SPEC-G09 Registration and baseline | ADR-096 / FR-250 register only the candidate NAV slice; other PMR/PMF/PMD IDs remain proposal-local | Reconcile current global registry, allocate canonical IDs through the ledger, resolve peer/parent decisions and pin an approved per-slice baseline |

These gaps are derived from explicit package content and enumeration of its contracts, not a search-based claim that no related capability exists elsewhere. Owner-port reuse must be inspected before adding an endpoint/model. Scope approval alone does not close these gaps.

## 4. Swagger review behavior

The local viewer uses pinned `swagger-ui-dist` **5.32.15** static assets. It offers a selector for Workforce (8 operations / 30 schemas) and Full PM (72 operations / 102 schemas), operation filtering, expandable parameters/body/responses and model schemas. It is an API reference, not a live integration test.

- Sources are local generated JSON copies of the two YAML candidates; the rendering copies do not become a second authoring source
- Synthetic workload/performance examples are attached to the corresponding response in the rendering copy and labelled as examples
- `supportedSubmitMethods: []`, `persistAuthorization: false`, `validatorUrl: null`; local assets, source whitelist and CSP keep this a documentation viewer
- No external online validator receives the spec; no runtime service, provider or Business data is contacted
- The `.invalid` server is the proposal's synthetic documentation target; deployed API testing is a separate implementation activity

These Swagger options are documented by the project. [Swagger UI configuration](https://swagger.io/docs/open-source-tools/swagger-ui/usage/configuration/). The static asset distribution is documented in [Swagger UI installation](https://github.com/swagger-api/swagger-ui/blob/main/docs/usage/installation.md).

**Update 0.7.0b:** SRS, table/ERD and blueprint coverage have been added. SPEC-G01/G04/G07 now have more detailed design proposals; none is marked closed until owner/API/adapter parity and the required approval/proof exist. This was the v0.7 status. The v0.9 core navigation update is described below; supplemental G14 and deferred screen reconciliation remain open.

## 5. Review exit / implementation entry

| State | Evidence / meaning |
|---|---|
| CONTRACT_FILES_PRESENT | Enumerated YAML/JSON/source docs exist |
| STRUCTURAL_VALIDATION | Both OpenAPI files and local references validate; this is a shape check |
| SWAGGER_REVIEW_AVAILABLE | Actual Swagger UI reads both definitions; browser verification recorded in local QA |
| CODEGEN_NOT_READY | SPEC-G01–G09 must be closed for the affected phase; no acceptance is implied by the viewer |
| PRODUCT_NOT_RUN | No new endpoints, database schema, employee data or implementation tests are run in this documentation review |

Work can close gaps in bounded phases: shared data/identity/transport → workforce write/lifecycle contracts → metrics/fixtures → navigation/graph parity → approved registered implementation baseline. Preserve one shared requirement and subordinate phases; do not renumber an existing global FR to fit the new subject.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-16 | candidate | Audit real contracts/schemas/API references, expose nine concrete code-generation gaps and add Swagger review | design base 087f3025; uncommitted | RWANG |
| 0.2.0b | 2026-09-16 | candidate | Record SRS ERD blueprint additions and distinguish design coverage from remaining API migration gates | design base 087f3025; uncommitted | RWANG |
| 0.3.0b | 2026-09-16 | candidate | Reconcile bounded allocation and core navigation design; retain CSRF, Workforce and implementation gates explicitly | isolated document composition | RWANG |

## v0.9 review update

[21 Contract foundation](21-CONTRACT-FOUNDATION.md) and [22 Navigation baseline](22-NAVIGATION-IMPLEMENTATION-BASELINE.md) resolve bounded design conflicts. They do not close all nine gaps or authorize application changes. Core navigation can be reviewed independently of Workforce and Fleet implementation. Schema examples, an interactive documentation prototype and existing-app baseline checks must not be reported as new-service runtime tests.
