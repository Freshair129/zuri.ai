---
id: ZAI:PM-PROJECT-DOMAIN-FEATURE-BASELINE
title: Project, Domain and Feature implementation baseline
version: "0.4.0b"
status: candidate
created_at: "2026-09-16T21:17:02+07:00,Luna Max,base 138db6630e650e3c695b81158eff3cecdad6d0a5"
last_update: "2026-09-17T00:32:00+07:00,RWANG"
superseded_by: null
attributes:
  doc_type: implementation-baseline
  domain: project-manager
  scope: "MA-I02 Project, Domain and Feature views with strategy progress"
  evidence_level: "PHASE_A_IMPLEMENTED_LOCAL_VERIFIED; PHASE_B_CANDIDATE"
  packet: "PM-20260916-MA-I02"
  source_commit: "138db6630e650e3c695b81158eff3cecdad6d0a5"
  canonical_id_status: "PHASE_A_FR-251_REGISTERED; NO_PHASE_B_IDS_ALLOCATED"
  api_contract_status: "DOMAIN_VIEW_COMPOSED; A1_APPROVED; A2_REGISTERED_GOVERNANCE_PASS"
relations:
  - type: references
    target: ZAI:PM-SYSTEM-REQUIREMENTS
  - type: references
    target: ZAI:PM-SYSTEM-DELIVERY
  - type: references
    target: ZAI:PM-DOMAIN-NAV-BOUNDARIES
  - type: references
    target: ZAI:PM-EXISTING-TAB-SEMANTICS
  - type: references
    target: ZAI:PM-SPEC-READINESS
  - type: references
    target: ZAI:PM-SRS
  - type: references
    target: ZAI:PM-MULTI-AGENT-DELIVERY
  - type: references
    target: ZAI:PM-CONTRACT-FOUNDATION
  - type: references
    target: doc:22-NAVIGATION-IMPLEMENTATION-BASELINE
  - type: references
    target: ZAI:PM-SYSTEM-DATA
  - type: references
    target: ZAI:PM-TABLES-ERD
  - type: references
    target: ZAI:PM-SYSTEM-API
  - type: references
    target: ZAI:FR-003
  - type: references
    target: ZAI:FR-069
  - type: references
    target: ZAI:FR-070
  - type: references
    target: ZAI:FR-108
  - type: references
    target: ZAI:FR-124
  - type: references
    target: ZAI:FR-250
  - type: references
    target: ZAI:FR-251
  - type: references
    target: ZAI:ADR-096
---

# Project, Domain and Feature implementation baseline

**Phase A approved · C-2 / MEDIUM · Phase B candidate C-3 / HIGH.**
The owner approved Phase A on reviewed document commit `7465080f` on
2026-09-16. FR-251 registers its read-only route and Project navigation.
The source audit below is pinned to `138db6630e650e3c695b81158eff3cecdad6d0a5`;
it describes that baseline, not later implementation. No Prisma model, migration
or Feature write API is approved. Phase A is implemented and verified locally;
hosted CI and release are tracked separately in PR443.

**Candidate API status:** `contracts/openapi.candidate.yaml` now composes the
Phase A `GET /api/projects/{projectId}/domain-view` DTO and its redacted 401/404
refusal contract. A1 owner approval and A2 canonical registration/governance
are closed for FR-251 Phase A. Runtime implementation passed local server,
browser, build and governance gates; Phase B Feature authority/persistence/CSRF
remains deferred.

MA-I02 is complete only when both phases below are implemented and verified. A
hidden or disabled Features tab is not completion. The existing approval for
FR-250 / ADR-096 covers hierarchical navigation already delivered in PR435
(`e8fc84bd`); it does not approve the candidate Domain/Feature routes or data
models.

## 1. Audit result

| Requirement / slice | Reusable evidence at the pinned source | Truth at the pinned source | Baseline decision |
|---|---|---|---|
| PMR-001 Project intake | `GET /api/projects`, project detail, bundle and plan import dry-run/commit; FR-003, FR-069, FR-108 | Project, Workspace/Business scope, Workstream mode/strategy/weight and import receipt exist. A dedicated objective/outcome/scope/owner DTO and persistence do not. | **REUSE partial.** Preserve current Project and one import writer. Record the missing PMR-001 fields; do not claim full intake. |
| PMR-002 Domain view | Workstream `primaryDomainId`, `supportingDomainIdsJson`, `technicalOwnerDomainId`; Project authorization and WorkItem reads | No PM Domain route, read model, or Prisma Domain model. `config/domains.js` is a route/label projection; `DOMAIN_GROUPS` is presentation only. | **EXTEND read-only.** Build a project-scoped projection from existing bindings after a runtime catalog binding gate. |
| PMR-003 Feature view | Candidate OpenAPI/UX/traceability contracts only; global Product Readiness is separately scoped | No ProjectFeature, contribution/link/binding model, route, service, or PM test exists. Tags/title and global readiness cannot establish a project Feature. | **NEW authority and surface.** Implement the real view only after the four-record contract below is approved. |
| PMR-016 progress | `progress/strategies.js`, `progress/rollup.js`, `progress-service.js`, Project page | Weighted Workstream strategy progress is implemented; Domain/Feature contribution semantics are not. | **REUSE Project progress.** Do not invent a tag/count progress formula for Domain or Feature. |
| PMR-027 evidence | Existing progress/evidence fields and candidate evidence contract | No Domain/Feature evidence source or deployment receipt is owned by this slice. | **EXTEND states.** Show `UNKNOWN`/`UNAVAILABLE` where a source is absent. |

At the pinned source audit, the candidate requirements, data, UX and traceability
files labelled PMR-001..003 and PMT-001..003 `PLANNED / NOT_RUN` or
`PROPOSED_NOT_IMPLEMENTED`, and no PM Domain/Feature tests existed. Those broad
candidate families are not silently promoted by Phase A. Current Domain-only
implementation and verification are recorded separately under FR-251; Feature
authority and its tests remain deferred.

The candidate OpenAPI composes the approved Phase A DTO and scoped refusal
contract below. The later FR-251 implementation adds its handler and runtime
Swagger operation; the synthetic candidate server does not serve that handler.
Feature operations and their authority remain proposed.

## 2. Enumerated surface and authority at the pinned source

The following enumeration describes `138db663`, before FR-251 implementation.
It is preserved as source-audit evidence, not a claim that the later Domain
route or tests are absent.

**Live Project routes and pages:**

* `/projects/{projectId}` plus `/execution/{mode}`, `/inventory`,
  `/repositories`, `/team`, `/files`, and `/import`;
* seven Work views: `/roadmap`, `/structure`, `/board`, `/all-work`,
  `/timeline`, `/milestones`, `/dependencies`;
* Business surfaces `/projects`, `/work`, `/execution`, `/timeline`,
  `/dependencies`, `/milestones`, `/files`, and `/repositories`.

The pages and layout are under
`apps/server/src/app/(pm)/projects/[projectId]/` and the project tabs are
`apps/server/src/modules/project-manager/components/ProjectTabs.jsx`.
Navigation is defined in
`apps/server/src/modules/project-manager/navigation.js`. At this pinned source,
there was no PM page or API route for Domain or Feature. FR-251 subsequently
adds `/projects/{projectId}/domain-view` and its GET handler; Feature remains
outside Phase A.

**Live PM application services:**

`project-service.js`, `project-list-read-model.js`,
`projects-dashboard-read-model.js`, `project-inventory-read-model.js`,
`project-authorization.js`, `scope-service.js`, `work-read-service.js`,
`work-service.js`, `progress-service.js`, `progress/strategies.js`,
`progress/rollup.js`, `audit.js`, and the import services/schema. These are the
allowlisted reuse points; their existing authorization and DTO limits remain in
force.

**Live Prisma records:**

`Project`, `Workstream`, `WorkContainer`, `WorkItem`, and
`PlanImportReceipt` are present in `apps/server/prisma/schema.prisma`. A
`ProjectFeature`, `FeatureContribution`, `FeatureWorkLink`,
`RequirementBinding`, or canonical PM `Domain` model is absent from the
enumerated schema files. The Workstream `primaryDomainId` and supporting/owner
fields are metadata bindings, not a Delivery Design catalog.

**Candidate-only API:**

`contracts/openapi.candidate.yaml` contains the composed candidate
`GET /api/projects/{projectId}/domain-view` operation and its
`DomainView`/`DomainRow` Phase A response, plus the scoped 401/404 refusal
responses. It also proposes
`GET /api/projects/{projectId}/feature-view`, and
`GET/POST /api/projects/{projectId}/features` plus
`GET/PATCH /api/projects/{projectId}/features/{featureId}`. The candidate
declarations did not establish routes or services at the pinned source. The
later Domain handler is tracked by FR-251; its existence does not implement the
remaining candidate operations or establish Feature authority.

## 3. Canonical mapping decision

| Concern | Mapping | Rule |
|---|---|---|
| Project, Workstream, WorkContainer, WorkItem, import receipt | **REUSE** | Existing UUIDs, scope checks, one import writer, and audit path remain authoritative. |
| Execution-purpose domain binding | **REUSE** | Read `primaryDomainId`, supporting IDs and `technicalOwnerDomainId` from Workstream. FR-070 `DOM-*` identities are stable; labels are projections. |
| Runtime Domain ID → label/owner catalog | **EXTEND** | Use the explicit Phase A mapping below. No new IDs, route-key-as-ID substitution, or `DOMAIN_GROUPS` edits. An unknown imported ID is retained as `UNMAPPED`. |
| Project Domain aggregate | **NEW read projection** | Scope Project first, then collect active Workstreams and deduplicated WorkItems. It must not create Domain records or infer domains from tags/title. |
| Global Product Readiness / `program-domain-map` | **REUSE for presentation patterns only** | It is a global Platform/Readiness snapshot and cannot supply project-scoped Features, WorkItems, or authorization. |
| ProjectFeature and its three links | **NEW persisted authority** | New records are needed for a truthful Feature surface; candidate only until owner approval. |
| Project/Feature progress | **REUSE + EXTEND explanation** | Project roll-up stays weighted Workstream strategy progress. Feature/Domain views expose source work/evidence and never change that roll-up. |
| Generic API CSRF | **UNKNOWN / owner binding needed** | Document 21 leaves issuer/verifier/Origin ownership unbound. Read-only Phase A is not blocked; Feature writes are blocked. |

The canonical Product/Feature registry remains the global `docs/FEATURES.md`
identity. A project-local Feature is a separate UUID/code and may carry a
`canonicalFeatureKey` only with a pinned snapshot. Phase A is registered as FR-251. No Feature-phase FR, FEAT, ADR or new domain
identity is allocated.

## 4. Recommended full MA-I02 packet

### Phase A — Existing Project plus a real Domain view

This is the first implementation packet after the gates in section 7.

1. Keep the existing Project list/detail/dashboard/import, Project authorization,
   Workstream mode/strategy/weight, and weighted progress behavior. Do not add a
   second Project writer or a second import path. Mark PMR-001 objective,
   outcome, dedicated scope and owner fields as an explicit follow-up gap.
2. Add a pure `project-domain-read-model.js`, a route
   `GET /api/projects/{projectId}/domain-view`, and a project-context UI route
   `/projects/{projectId}/domain-view`. The UI route is a navigation extension
   approved under FR-251; it does not expand the immutable FR-250 subject.
3. Resolve the authorized Project before any aggregate query. Read active
   Workstreams, expand primary/supporting bindings, retain technical owner
   identity separately, and deduplicate WorkItem UUIDs across bindings. Sort
   rows by stable `domainId`; never use a label, route key, tag or title as an
   identity or authorization input.
4. Use the approved catalog for labels. If a binding has no catalog entry,
   return its immutable ID with `mappingState: "UNMAPPED"` and a visible
   unknown state. Do not drop the row or relabel it from a guessed source.
5. Keep Project progress on the existing pure weighted calculation. A Domain
   row may show source Workstream strategy/evidence, but no unapproved average,
   tag count, or Domain-specific progress formula may mutate Project progress
   or `progressCache`.

Minimum Phase A response (the candidate OpenAPI is now composed to this shape;
A1 and A2 are closed; FR-251 registration governance passed before code):

```json
{
  "schemaVersion": "1.0",
  "projectId": "<project UUID>",
  "snapshotId": null,
  "snapshotState": "UNAVAILABLE",
  "observedAt": "<server ISO timestamp>",
  "totalUniqueWorkCount": 0,
  "unboundWorkstreamCount": 0,
  "domains": [{
    "domainId": "DOM-<stable id>",
    "label": "<catalog projection or Unknown domain>",
    "mappingState": "MAPPED",
    "ownership": {
      "primaryWorkstreamCount": 0,
      "supportingWorkstreamCount": 0,
      "technicalOwnerIds": ["TD-PROJECT-MANAGER"]
    },
    "work": {"uniqueWorkCount": 0, "workstreamCount": 0},
    "featureIds": [],
    "featureState": "NOT_BOUND",
    "blockerState": "UNAVAILABLE",
    "blockerCount": null,
    "contractState": "UNAVAILABLE",
    "gapState": "UNAVAILABLE",
    "evidence": []
  }]
}
```

`blockerCount`, `contractState`, `gapState`, and `snapshotId` are deliberately
stateful. The composed candidate contract represents the absent sources with
`null` or `UNAVAILABLE`, and constrains Phase A `featureIds` to an empty array
because no ProjectFeature authority exists in this phase. The composition is not
implementation evidence: A1 is approved, FR-251 is registered, and the
integrator passed A2 governance before worker implementation (0 critical, 2 existing warnings).

#### Phase A decisions approved by the owner

Phase A is a **C-2 / MEDIUM** read-only contract extension. The wider Phase B
remains **C-3 / HIGH** because it introduces persistence and mutations.

| Stable execution-purpose ID | Existing runtime label source (`DOMAINS.key`) |
|---|---|
| `DOM-DEVELOPMENT` | `projects` (Projects & Work) |
| `DOM-COMMERCE` | `commerce` (Order Management) |
| `DOM-CRM` | `customer` (Customer) |
| `DOM-MARKETING` | `growth` (Marketing) |
| `DOM-OPERATIONS` | `operations` |
| `DOM-PEOPLE` | `people` |
| `DOM-PLATFORM` | `platform` |

The adapter declares these pairs explicitly and reads the current display label
from the existing config. Renaming a label cannot change a row key. It never
derives new IDs from a route or adds a domain grant. `DOM-BUSINESS-HOME` is a
non-owning aggregation surface, so it is not an execution-domain catalog member.
An imported unrecognized binding is retained as `UNMAPPED`, including an invalid
Business Home binding; it does not gain an owner or permission. Technical-owner
IDs (`TD-*`) are a separate list on a row, never product-domain row keys.

The Domain tab in this phase is labelled **Execution Domains** with help text
“Domains served by this Project's workstreams”. It is a projection of actual
execution bindings. It must not claim to be a repository's DDD bounded-context
catalog or architectural ownership model. Phase B's cross-domain Feature view
and later governance/architecture snapshot continue to have separate contracts.

The root response totals include each active WorkItem once, including work in a
Workstream without a primary domain. `unboundWorkstreamCount` counts active
Workstreams without a primary binding; these are shown in an Unassigned section.
A domain's work count includes primary or supporting membership once per
WorkItem. Counts in different domain rows overlap and are not summed to produce
the project total. A Workstream listing the same supporting ID twice, or its
primary ID again as supporting, cannot inflate a row. Exclude soft-deleted
Projects and WorkItems and reuse `activeWorkstream()` for deleted/archived
Workstreams. WorkContainer has no `deletedAt` at this baseline; do not invent a
container soft-delete filter. Any linked container must belong to the WorkItem's
Workstream. No feature IDs, contract counts or snapshot IDs are synthesized.

Both successful states use HTTP 200: `domains: []` for an authorized project
without domain bindings, and populated rows for mapped/unmapped bindings.
Unauthenticated calls use 401; nonexistent, foreign-scope and invalid-hierarchy
targets use the same 404 refusal. GET is side-effect free: no import, cache,
audit append, new grant or database migration. The route uses
`resolveRequestViewer`; the read model reuses `assertProjectRoadmapReadable`
with the Project's Business and Workspace hierarchy before reading work.
Existing authorized TENANT/PORTFOLIO shared-Workspace paths remain covered by
that same policy; do not replace it with an owner-only mutation guard or grant
access from a URL. Navigation retains the existing Projects domain grant. A
domain label on a row is context, not authorization to open the referenced
operational module.

Navigation uses the existing Delivery Design module in Project context: only
the new Execution Domains tab becomes live at `/projects/{projectId}/domain-view`.
Features, Requirements, Architecture, API and Docs & Decisions retain their
planned status. Business-scope navigation and all FR-250 existing destinations
retain their routes. Mobile uses the same module/tab hierarchy and a list view.
The page displays loading, empty/unassigned, unmapped, request-failed and
forbidden/not-found states; keyboard navigation and browser Back retain context.
This is a real first delivery of MA-I02, not a claim that MA-I02 is complete.

### Phase B — Real Feature view and approved local authority

Phase B is part of full MA-I02 but is **deferred pending owner approval** of the
new persistence, authorization, CSRF, migration and restore contract. It cannot
be replaced by a disabled tab or by reading global Product Readiness.

The minimum authority is exactly these records (the selected fields mirror
18-DATABASE-TABLES-AND-ERD.md):

| Record | Required selected fields and invariants |
|---|---|
| `ProjectFeature` | UUID `id`, `tenantId`, `businessId`, `projectId`, timestamps, `version`, optional `deletedAt`, `code`, `title`, `problem`, `outcome`, `primaryDomainId`, lifecycle `DRAFT\|ACTIVE\|RETIRED`; optional `canonicalFeatureKey` and `governanceSnapshotId` are both present or both absent; unique `(projectId, code)`. |
| `FeatureContribution` | Common scope/audit fields, `featureId`, canonical `domainId`, `responsibility`; unique `(featureId, domainId)`; exactly one ProjectFeature primary domain remains in `ProjectFeature`; contribution links do not create Domain records or duplicate progress. |
| `FeatureWorkLink` | Common scope/audit fields, `featureId`, `workItemId`, optional `allocationBps` in `0..10000`; unique `(featureId, workItemId)`; linked WorkItem must resolve to the same Project. An explicit split may sum to 10000; otherwise allocation is unallocated and explanatory only. |
| `RequirementBinding` | Common scope/audit fields, `featureId`, required `governanceSnapshotId`, `sourceNamespace`, `requirementKey`, immutable `revisionHash` (sha256), `acceptanceRef`; unique `(featureId, governanceSnapshotId, sourceNamespace, requirementKey)`. Canonical requirement subject is read-only. |

`GovernanceSnapshot` is a required supporting authority for
`RequirementBinding`, not a substitute for a project Feature. It must identify
the source revision/hash used for the binding. Current parent records do not
uniformly carry tenant/business columns, so creation must derive and validate
the full scope chain before writing copied scope fields; it may not guess them.

The Phase B read/write surface is:

* `GET /api/projects/{projectId}/feature-view` — one scope-first aggregate;
* `GET/POST /api/projects/{projectId}/features` — list/create;
* `GET/PATCH /api/projects/{projectId}/features/{featureId}` — detail/update;
* project-context UI `/projects/{projectId}/feature-view`, with the Features
  tab enabled only when the read contract and route are live.

The aggregate returns `projectId`, nullable `snapshotId` plus state,
`observedAt`, a project-level `uniqueWorkCount`, and Feature rows containing
the immutable Feature fields, primary/contributing domains, requirement
bindings, evidence states, and deduplicated `uniqueWorkCount`. A WorkItem linked
to two Features counts once in the project total. Feature links explain
allocation; they do not replace Workstream strategy progress.

## 5. UX and error states

* Loading and empty Project states reuse current Project states. Domain and
  Feature loading, empty, and `UNKNOWN`/`UNAVAILABLE` source states are distinct.
* A project with no bindings has an explicit empty Domain result. An unknown
  binding preserves its ID and shows `UNMAPPED`.
* Missing contract, gap, blocker, evidence, or snapshot authority is shown as
  unavailable; it is never converted to zero, “ready”, or “deployed”.
* Feature rows with no acceptance evidence show the missing evidence state.
  Shared WorkItems are visibly deduplicated.
* Project, Domain and Feature routes re-run scope authorization on every read;
  the URL project ID is never a grant. Project/Feature writes resolve the
  target first, then require Business mutation authority, expected `version`,
  idempotency where applicable, and the Identity-owned CSRF contract.

## 6. Migration, backup and restore boundary

There is no migration in this assignment. Before Phase B code, owner approval
must cover the additive migration described in 18-DATABASE-TABLES-AND-ERD.md:

1. enumerate actual owner tables, scope adapters and grants at the implementation
   SHA; add only the four reviewed tables plus the required snapshot authority,
   indexes and constraints;
2. backfill only verifiable existing facts (Workstream bindings and WorkItem
   links); never infer Features from tags, titles, or global readiness;
3. run a shadow read projection, then enable one authorized writer after
   transaction, RLS/grant, negative-scope, concurrency and audit checks;
4. keep the first rollout additive and rollback by feature flag/read-path
   disablement. Do not drop or rename existing Project/Workstream fields;
5. include the new records in backup/restore and privacy-erasure procedures,
   preserving immutable IDs, versions, AuditEvents and requirement snapshot
   hashes. A restore must not rebind a Feature to a different Project or scope.

SQLite repository adapters and the later Postgres/RLS contract must expose the
same invariants. Workforce, agent, provider, capacity and scheduling records
are outside MA-I02 and are not migration or acceptance blockers.

## 7. Exact gates and allowlist

**Gates before implementation:**

* **A1 (APPROVED 2026-09-16):** owner approval of Phase A's explicit mapping, composed DTO,
  read-only route, refusal contract and Project-context navigation amendment
  above. FR-250's previous approval did not include this new route.
* **A2 (CLOSED; GOVERNANCE PASS):** after A1, the integrator registers FR-251 as the approved Domain-view
  requirement, pins this baseline, reconciles the exact candidate/API and
  navigation contracts and runs governance. Immutable existing FR/FEAT subjects
  are not expanded silently.
* **B1:** separately close and approve the four-record Feature authority plus
  snapshot authority, scope constraints, repository ports, exact CRUD/DTO and
  AuditEvent behavior, Identity-owned CSRF issuance/verification, migration and
  restore plan. The selected-field table is a design input, not a dispatchable
  schema or an approved CRUD implementation.
* **B2:** register the approved Feature requirements/contracts and pin their
  baseline before that implementation starts.

Phase A requires A1–A2 only; Phase B's write/CSRF/schema gates do not block the
read-only Phase A. FR-251 is the sole new global requirement for Phase A.

**Source allowlist for the next bounded implementation:**

* reuse: `project-service.js`, `project-authorization.js`, `scope-service.js`,
  `project-list-read-model.js`, `projects-dashboard-read-model.js`,
  `project-inventory-read-model.js`, `work-read-service.js`, `work-service.js`,
  `progress-service.js`, `progress/strategies.js`, `progress/rollup.js`,
  `audit.js`, `import/plan-schema.js`, and `import/plan-import-service.js`;
* navigation/UI after the corresponding A or B gates:
  `navigation.js`, `ProjectTabs.jsx`, the Project layout and the two new
  project-context pages;
* new PM application/routes after the corresponding A or B gates:
  `project-domain-read-model.js`, `project-feature-read-model.js`,
  `project-feature-service.js`, the two view routes, and the feature list/detail
  routes; Prisma/schema files only in the approved migration packet;
* no edits to `DOMAIN_GROUPS`, global Product Readiness, workforce/agent/provider
  modules or production configuration. Only the integrator changes canonical
  registries and generates governance outputs after approval.

Phase A's new implementation files are exactly:

* `apps/server/src/modules/project-manager/application/project-domain-read-model.js`
* `apps/server/src/modules/project-manager/project-domain-catalog.js`
* `apps/server/src/modules/project-manager/components/ProjectDomainView.jsx`
* `apps/server/src/app/api/projects/[id]/domain-view/route.js`
* `apps/server/src/app/(pm)/projects/[projectId]/domain-view/page.jsx`

Existing navigation consumers may change only as required to activate that
route in Project context. The API folder uses the existing `[id]` segment;
`{projectId}` above is the wire-contract parameter name, not a second Next.js
dynamic folder. Phase A does not authorize edits to the reused Project,
import, work or progress writers. Its new tests are
`apps/server/tests/unit/project-domain-read-model.test.js`,
`apps/server/tests/integration/project-domain-view.test.js` and
`apps/server/tests/e2e/project-domain-view.spec.js`.

**Future proof allowlist:** unit tests for the two read models and feature
service; integration tests for domain/feature view scope, authorization,
deduplication and optimistic concurrency; one PM Domain/Feature E2E journey;
existing Project list/dashboard/inventory/work/progress/import and FR-250
navigation tests remain regression checks. Current PMT-001..003 evidence stays
`PLANNED_NOT_RUN` until those tests actually run.

## 8. Acceptance and exit criteria

Apply the following criteria to their approved phase. Phase A requires the
Project/domain authorization, identity/counting, side-effect-free progress,
Project-only navigation and verification criteria. Feature rows and all write/
concurrency criteria apply only to separately approved Phase B. Full MA-I02
requires both phases. Proof must stay within the approved source/test allowlist:

* authorized Project reads scope before every aggregate and return no data for
  unauthenticated, foreign-Business, foreign-tenant, deleted or hierarchy-
  mismatched Projects (`401`/`404` with no counts, labels or IDs leaked);
* Domain rows preserve immutable FR-070 IDs, distinguish primary/supporting/
  technical-owner roles, retain unknown bindings, and count each WorkItem once;
* Feature rows come only from approved ProjectFeature and binding records; the
  same WorkItem in multiple Features counts once project-wide; cross-Project
  links are refused; deleted links are excluded while AuditEvents remain;
* Project progress remains the existing weighted Workstream strategy roll-up;
  GET projections do not write progress cache and Domain/Feature labels,
  requirements or usage do not alter progress;
* create/update rejects duplicate Project code, invalid allocation, foreign
  hierarchy, missing snapshot/requirement revision, missing CSRF/authority and
  stale `version` (`409`/`412` as contracted), without leaking target data;
* navigation keeps all FR-250 routes and existing Project semantics, adds the
  two new routes only under approved Delivery Design context, and does not
  convert a `DOMAIN_GROUPS` presentation grouping into a grant or model;
* governance, unit/integration/E2E tests and build are run by the integrator.
  Phase A local evidence is recorded below; hosted CI and release are separate.

## 9. Phase A local verification — 2026-09-17

The [FR-251 delivery note](../../domains/project-manager/features/FR-251-project-execution-domains.md)
records the implemented scope and evidence: 5,956 server tests passed, 32 existing
skips; 199 browser cases passed, four existing skips, no failures or flaky cases;
production build passed; governance passed with zero critical findings and two
existing warnings. Independent Luna Max source review and root visual review
passed. Candidate OpenAPI and nine DTO checks passed without changing other
candidate operations or schemas. Initial browser locator failures and their
bounded corrections remain documented in the integration RCA.

These results cover FR-251 Phase A, not the deferred Feature surface or full
MA-I02. [PR443](https://github.com/Freshair129/zuri.ai/pull/443) associates hosted
CI with the implementation commit. No merge, deployment or runtime activation
is established by the local results.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-16 | candidate | Source-backed MA-I02 baseline: Project reuse, real Domain read phase, and gated Feature authority/surface | 138db6630e650e3c695b81158eff3cecdad6d0a5 | Luna Max |
| 0.2.0b | 2026-09-16 | candidate | Root review: explicit Phase A domain catalog, DTO totals, scope/unknown semantics, navigation and exact new-file list; separate A and B gates and retain incomplete Feature write contract honestly | 138db6630e650e3c695b81158eff3cecdad6d0a5 | RWANG |
| 0.3.0b | 2026-09-16 | candidate | Compose the Phase A Domain-view OpenAPI DTO and redacted 401/404 contract; retain pending A1 approval, pending A2 registration/governance and deferred Feature authority | 138db6630e650e3c695b81158eff3cecdad6d0a5 | RWANG |
| 0.4.0b | 2026-09-17 | candidate | Record owner approval, FR-251 registration, implementation and local verification; retain unapproved Phase B and separate release gates | reviewed baseline 7465080f; PR443 | RWANG |
