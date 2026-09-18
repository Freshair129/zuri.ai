---
id: ZAI:PM-SPEC-READINESS
title: Specification completeness and API reference audit
version: "0.2.0b"
status: candidate
created_at: "2026-09-16T03:55:57+07:00,RWANG,design base 087f3025"
last_update: "2026-09-16T12:22:55+07:00,RWANG"
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
| Main API contract | [openapi.candidate.yaml](contracts/openapi.candidate.yaml) | OpenAPI 3.0.3; **52 paths / 72 operations / 98 schema definitions**, candidate |
| Workforce API contract | [workforce.openapi.candidate.yaml](contracts/workforce.openapi.candidate.yaml) | OpenAPI 3.0.3; **8 paths / 8 operations / 27 schema definitions**, candidate |
| Workflow JSON Schema | [workflow.schema.json](contracts/workflow.schema.json), [example](contracts/workflow.example.json) | Structural schema and synthetic example, plus DAG semantic checks |
| Architecture contract | [architecture.model.json](contracts/architecture.model.json) | G01: 15 nodes / 20 edges with owners/contracts/directions; no claim that it contains every diagram |
| Traceability | [traceability.json](contracts/traceability.json) | 33 PMR → PMT families and contract/operation references; cases are planned product tests |
| Navigation and UX contracts | [navigation.candidate.json](contracts/navigation.candidate.json), [ux-ui.candidate.json](contracts/ux-ui.candidate.json) | Historical candidate snapshots; reconciliation with documents 13–15 remains open |
| Examples | [workforce.examples.json](contracts/workforce.examples.json) | Two synthetic response examples; workload arithmetic and closed-period performance cohort verified; does not cover every request/error/state |
| SRS and implementation blueprint | [17 SRS](17-SRS.md), [19 Blueprint](19-SYSTEM-BLUEPRINT.md) | 33 requirement families, 10 use cases, 5 architecture/runtime diagrams, typed blueprint and trace models; candidate |
| API reference prose | [06 API & contracts](06-API-AND-CONTRACTS.md), document 15 §8 | Endpoints, errors, auth, version/idempotency, streaming and owner boundaries |
| Swagger UI | Local review artifact `swagger-api.html` | Actual Swagger UI rendering of both contracts, added in this review; read-only documentation mode |

**Count semantics:** 80 operations and 125 schema definitions are the sum of two separately versioned OpenAPI files. They are not 125 database tables, not 80 deployed endpoints and not a completeness score. Keep the specs separate in the viewer because generic component/security names may differ in meaning.

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
| SPEC-G01 Allocation authority | Main `AllocationInput/AllocationRecord` uses resourceId/effortHours; workforce `AllocationChange` uses personId/remainingMinutes | Define one owner/writer, identity mapping and explicit legacy compatibility; no two independent allocation writers |
| SPEC-G02 Workforce inputs/history | Document 15 requires typed estimates, team capacity shares, effective assignment and delivery history; PreviewInput changes contain calendar/availability/allocation only | Supply typed owner ports and mutation/event contracts for those inputs, including versioning, effective dates, status mapping for the seven execution modes and source deduplication |
| SPEC-G03 KPI review/corrections | Workforce API drafts policies; WF-R06 permits correction requests; main reviews are Project-scoped | Define Business/person/team policy review and correction lifecycle, read/list/detail, allowed transitions and reviewer authority; bind to an existing exact contract or declare the necessary interface |
| SPEC-G04 Metric shapes | Document 18 proposes discriminated result variants; current OpenAPI MetricResult still has one scalar value and no dimension/quantile discriminator | Define complete result shapes, sample/coverage states and examples for all twelve metrics; no undocumented array-order or repeated-key convention |
| SPEC-G05 Shared transport/security | API prose uses requestId/retryable/errors/ETag; workforce Error contains code/message/correlationId and a placeholder SessionAuth cookie; If-Match is explicit only on commit | Reconcile error envelope, response headers, version preconditions, real session/CSRF binding, permission actions and operation-specific refusal codes |
| SPEC-G06 Navigation/diagram machine parity | README already labels navigation/UX JSON as historical; document 15 says G14 is absent from G01 model | Reconcile approved navigation and six workforce screens into machine-readable mappings; add a linked G14 graph contract without corrupting G01's identity |
| SPEC-G07 Persistence/migration | Document 18 now specifies candidate fields/keys/indexes/temporal rules, transactions and adoption steps; physical adapter binding and executable migration contract are not reviewed | Review candidate table/reuse decisions, reconcile exact SQLite/Postgres mappings, implement/test scoped constraints and RLS/grants, and approve executable migration/backfill/rollback evidence |
| SPEC-G08 Executable conformance | PMT-033 A–P are written scenarios; two synthetic response fixtures validate shape | Add contract examples for each request/error/lifecycle and then runnable tests against approved implementation. Static examples must not count as service tests |
| SPEC-G09 Registration and baseline | PMR/PMF/PMD IDs are explicitly proposal-local; artifacts remain candidate | Reconcile current global registry, allocate canonical IDs through the ledger, resolve peer/parent decisions and pin an approved per-slice baseline |

These gaps are derived from explicit package content and enumeration of its contracts, not a search-based claim that no related capability exists elsewhere. Owner-port reuse must be inspected before adding an endpoint/model. Scope approval alone does not close these gaps.

## 4. Swagger review behavior

The local viewer uses pinned `swagger-ui-dist` **5.32.15** static assets. It offers a selector for Workforce (8 operations / 27 schemas) and Full PM (72 operations / 98 schemas), operation filtering, expandable parameters/body/responses and model schemas. It is an API reference, not a live integration test.

- Sources are local generated JSON copies of the two YAML candidates; the rendering copies do not become a second authoring source
- Synthetic workload/performance examples are attached to the corresponding response in the rendering copy and labelled as examples
- `supportedSubmitMethods: []`, `persistAuthorization: false`, `validatorUrl: null`; local assets, source whitelist and CSP keep this a documentation viewer
- No external online validator receives the spec; no runtime service, provider or Business data is contacted
- The `.invalid` server is the proposal's synthetic documentation target; deployed API testing is a separate implementation activity

These Swagger options are documented by the project. [Swagger UI configuration](https://swagger.io/docs/open-source-tools/swagger-ui/usage/configuration/). The static asset distribution is documented in [Swagger UI installation](https://github.com/swagger-api/swagger-ui/blob/main/docs/usage/installation.md).

**Update 0.7.0b:** SRS, table/ERD and blueprint coverage have been added. SPEC-G01/G04/G07 now have more detailed design proposals; none is marked closed until owner/API/adapter parity and the required approval/proof exist. SPEC-G06 still includes old navigation/screen reconciliation; the supplemental blueprint does not rewrite G01 or the historical UX JSON.

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
