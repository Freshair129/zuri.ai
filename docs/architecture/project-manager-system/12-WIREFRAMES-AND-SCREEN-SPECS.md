---
id: ZAI:PM-WIREFRAMES
title: Project Manager wireframes and screen specifications
version: "1.2.0b"
status: candidate
created_at: "2026-09-16T01:24:00+07:00,RWANG,base 087f30258a6831865afd751e28804e36505aff30"
last_update: "2026-09-16T03:23:25+07:00,RWANG"
superseded_by: null
attributes:
  doc_type: architecture-specification
  domain: project-manager
  scope: Reviewable wireframes and developer handoff
relations:
  - type: references
    target: ZAI:PM-SYSTEM-DESIGN
---

# Wireframes & screen specifications

**Candidate · 37 screen families · 10 journeys · 13 forms / 83 fields.** All wireframes are proposed UI, including screens whose existing source routes are present. No product implementation or measured user-study outcome is claimed.

**Existing-capability correction:** [Tab semantics audit](14-EXISTING-PROJECT-TAB-SEMANTICS.md) governs WF-20/23/25/26. WF-23 is Project Inventory, WF-20 reads Business Membership in a Project context, and WF-25/26 contain proposed detail for still-planned Resources/Risks. The historical JSON/gallery must be reconciled before code generation.

**Navigation correction:** [Document 13](13-DOMAIN-TAXONOMY-AND-NAVIGATION-BOUNDARIES.md) replaces the earlier shell recommendation. The shell below reflects Domain → module → local tabs. The 37 content layouts remain review material; their existing navigation IDs/JSON and HTML v0.3 still describe the old sidebar and must be remapped before code generation. No claim is made that the interactive gallery already implements the new hierarchy.

**Latest Resources expansion:** [15 Workforce planning & performance](15-WORKFORCE-CAPACITY-SCHEDULE-AND-PERFORMANCE.md) adds WF-R01–06. WF-20 below describes current Membership behavior; a future “ดูภาระงาน” link opens the separately authorized Resources projection.

## 1. How to review

Read [UX strategy](10-UX-STRATEGY-AND-JOURNEYS.md), [UI rules](11-UI-SYSTEM-AND-INTERACTIONS.md) and [navigation mapping](09-NAVIGATION-REFINEMENT.md) first. The local interactive review is `pm-design-qa/ux-ui-wireframes.html` outside tracked source; adjacent JSON reports record artifact-only verification. The durable handoff is this document plus the [machine-readable screen/form model](contracts/ux-ui.candidate.json).

The review gallery selects screen, journey, viewport, wireframe/Heritage appearance and injected state. Screens use distinct content layouts. All displayed project records, agents, activity and metrics are synthetic examples. A preview or simulated button never creates a product record, provider probe, key, approval or run. There is no public share link in this task.

B1/B2/B3 identify content order, not three mandatory cards. Header/sidebar are shared composition. Board/Timeline and Cloud/STDIO variants change the relevant central surface and conditional fields. Revision/evidence detail is not hidden only in a tooltip.

## 2. Shared shell wireframe

```text
+--------------------------------------------------------------------+
| Existing global shell: Group > Organization > Business              |
| Domain bar: Projects & Work (proposed label; key: projects)          |
+-------------------+------------------------------------------------+
| Domain module     | Breadcrumb > Module > Resource (URL-authorized) |
| sidebar           | Page title + scope                  Import Plan |
|                   +------------------------------------------------+
| Project Management| Local section/view tabs                        |
| Work Management   | B1 Scope / summary / filters                   |
| Delivery Design   | B2 Main content: list, graph, document or form  |
| Resources         | B3 Details / evidence / inspector              |
| Governance        |                                                |
| Agent Delivery    | Action > durable receipt > final result        |
+-------------------+------------------------------------------------+
```

On narrow screens, the module sidebar opens as a focus-managed drawer. B1/B2/B3 stack. Tables/graphs own contained scrolling and an accessible list. Forms stay one column. Global context stops at Business; the selected Project is resource context in the content header. Business registry screens navigate to the Platform owner and offer a reauthorized return link. Full module names and tab semantics are in document 13; Resources/Governance are abbreviated above only to keep the text wireframe readable.

## 3. Screen inventory and navigation coverage

| ID | Screen | Scope | Slice | Destinations |
|---|---|---|---|---|
| [WF-01](#wf-01) | Business Dashboard | BUSINESS | NAV-P1 | b.dashboard |
| [WF-02](#wf-02) | Business Work | BUSINESS | NAV-P1 | b.work, b.timeline, b.dependencies, b.milestones |
| [WF-03](#wf-03) | Project Overview | PROJECT | NAV-P1 | p.overview |
| [WF-04](#wf-04) | Domains | PROJECT | P1 | p.domains |
| [WF-05](#wf-05) | Domain Detail | PROJECT | P1 | Detail / action from parent |
| [WF-06](#wf-06) | Features | PROJECT | P1 | p.features |
| [WF-07](#wf-07) | Feature Detail | PROJECT | P1 | Detail / action from parent |
| [WF-08](#wf-08) | Project Work | PROJECT | NAV-P1 / P6 Calendar | p.work, p.work-items, p.board, p.structure, p.timeline, p.milestones, p.dependencies, p.roadmap, p.calendar |
| [WF-09](#wf-09) | Execution Views | BUSINESS_OR_PROJECT | NAV-P1 | p.execution, b.execution |
| [WF-10](#wf-10) | Requirements | PROJECT | P2 | p.requirements |
| [WF-11](#wf-11) | Architecture | PROJECT | P2 | p.architecture |
| [WF-12](#wf-12) | API Explorer | PROJECT | P2 | p.api |
| [WF-13](#wf-13) | Docs & Decisions | PROJECT | P2 | p.documents |
| [WF-14](#wf-14) | Command Center | PROJECT | P4 / P5 Fleet | p.command |
| [WF-15](#wf-15) | Run / Review / Recovery | PROJECT | P4 / P5 | Detail / action from parent |
| [WF-16](#wf-16) | Agent Inventory | PROJECT | P4 | p.agents |
| [WF-17](#wf-17) | Agent Version Editor | PROJECT | P4 | Detail / action from parent |
| [WF-18](#wf-18) | Fleet Inventory & Version | PROJECT | P5 | p.fleets |
| [WF-19](#wf-19) | Workflow Builder | PROJECT | P4 / P5 | p.workflows |
| [WF-20](#wf-20) | Project Team | PROJECT | NAV-P1 | p.team |
| [WF-21](#wf-21) | Files & Artifacts | BUSINESS_OR_PROJECT | NAV-P1 / P6 Artifacts | p.files, b.files |
| [WF-22](#wf-22) | Repositories | BUSINESS_OR_PROJECT | NAV-P1 / P6 CI | p.repositories, b.repositories |
| [WF-23](#wf-23) | Project Inventory | PROJECT | NAV-P1 | p.index (historical candidate key) |
| [WF-24](#wf-24) | Connections Used | PROJECT | P3 | p.connections |
| [WF-25](#wf-25) | Resources & Budget | PROJECT | P6 | p.budget |
| [WF-26](#wf-26) | Risks & Issues | PROJECT | P6 | p.risks |
| [WF-27](#wf-27) | Tests & Releases | PROJECT | P6 | p.releases |
| [WF-28](#wf-28) | Activity | PROJECT | P6 | p.activity |
| [WF-29](#wf-29) | Project Settings | PROJECT | P6 | p.settings |
| [WF-30](#wf-30) | Import Plan | PROJECT | NAV-P1 | p.import |
| [WF-31](#wf-31) | Create Project | BUSINESS | NAV-P1 | b.create |
| [WF-32](#wf-32) | Provider & MCP Registry | BUSINESS | P3 | i.registry |
| [WF-33](#wf-33) | Model Connection Setup | BUSINESS | P3 | Detail / action from parent |
| [WF-34](#wf-34) | MCP Setup | BUSINESS | P3 | Detail / action from parent |
| [WF-35](#wf-35) | Inference API Keys | BUSINESS | P3 | Detail / action from parent |
| [WF-36](#wf-36) | Executors | BUSINESS | P3 / P4 | Detail / action from parent |
| [WF-37](#wf-37) | Routing & Budgets | BUSINESS | P3 | Detail / action from parent |

WF-15 is Project-scoped under the existing candidate ReviewInput contract. WF-09/21/22 support both scopes; rendering preserves the authorized resource. WF-24 → WF-32 is an explicit Business transition. All 41 PM destination IDs plus one shared Business registry entry (42 total) are covered. Detail/form steps do not add duplicate sidebar entries.

## 4. Screen specifications

<a id="wf-01"></a>

### WF-01 — Business Dashboard

**Purpose:** มองภาพรวมทุกโปรเจกต์ใน Business และเลือกงานที่ต้องตัดสินใจ

**Scope / phase:** BUSINESS / NAV-P1. **Trace:** PMR-001, PMR-016, PMR-027. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Strategy progress and evidence freshness |
| B2 | Priority and attention queue |
| B3 | Project list with owner, dates and status |

- **Interaction:** Create Project ไป intake; แถว Project เปิด resource ที่ผ่านการตรวจสิทธิ์
- **Primary intent:** New Project; handoff → WF-31. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** ยังไม่มี Project: แสดง objective-first action
- **Responsive:** Summary cards wrap; project table scrolls within region

<a id="wf-02"></a>

### WF-02 — Business Work

**Purpose:** เทียบงานข้ามโปรเจกต์โดยเห็น Project กำกับทุกแถว

**Scope / phase:** BUSINESS / NAV-P1. **Trace:** PMR-016, PMR-017. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Business scope and project filters |
| B2 | Cross-project planning surface |
| B3 | Selected record details |

- **Interaction:** Filter Project/owner/date; row opens original Project without changing grants
- **Primary intent:** Open project; handoff → WF-03. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** ไม่มีงานตาม filter: Clear filters; ไม่มีสิทธิ์: ไม่แสดงชื่อโปรเจกต์
- **Responsive:** Keep Project column; timeline has list alternative
- **Variants:** Work Items · Timeline · Dependencies · Milestones & Gates.

<a id="wf-03"></a>

### WF-03 — Project Overview

**Purpose:** รู้เป้าหมาย เจ้าของ workstream และหลักฐานที่ทำให้ progress เปลี่ยน

**Scope / phase:** PROJECT / NAV-P1. **Trace:** PMR-001, PMR-016, PMR-027. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Objective, owner and dates |
| B2 | Strategy progress with source evidence |
| B3 | Workstreams and next actions |

- **Interaction:** Import Plan เปิด flow เดิม; workstream opens correct execution mode
- **Primary intent:** Import Plan; handoff → WF-30. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** ยังไม่มี workstream: objective/plan intake; progress UNKNOWN เมื่อไม่มีหลักฐาน
- **Responsive:** Objective before metrics; workstreams stack

<a id="wf-04"></a>

### WF-04 — Domains

**Purpose:** ค้น Domain ตาม owner และความรับผิดชอบ

**Scope / phase:** PROJECT / P1. **Trace:** PMR-002. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Domain search and readiness filter |
| B2 | Owners, work, contracts and blockers |
| B3 | Selected domain entry |

- **Interaction:** Domain card เปิด WF-05; filter does not create a Workstream
- **Primary intent:** Open domain; handoff → WF-05. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** ยังไม่ได้ผูก Domain: เลือกจาก canonical registry ตามสิทธิ์
- **Responsive:** Cards one column; names and stable keys wrap

<a id="wf-05"></a>

### WF-05 — Domain Detail

**Purpose:** ตรวจ lane ของ Domain และสัญญาที่ข้ามขอบเขต

**Scope / phase:** PROJECT / P1. **Trace:** PMR-002, PMR-015. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Charter, owner and stable ID |
| B2 | Owned data/services and contributions |
| B3 | Incoming and outgoing contracts |

- **Interaction:** Open owned work; incoming/outgoing contract opens architecture inspector
- **Primary intent:** Open owned work; handoff → WF-08. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** ไม่มี owned work: อธิบาย contribution-only; ไม่ย้าย ownership อัตโนมัติ
- **Responsive:** Charter first; contract relationships become a list

<a id="wf-06"></a>

### WF-06 — Features

**Purpose:** ค้น Feature ตามผลลัพธ์ผู้ใช้และ acceptance

**Scope / phase:** PROJECT / P1. **Trace:** PMR-003. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Feature search and release filter |
| B2 | Outcome, primary owner and contributing domains |
| B3 | Acceptance and readiness evidence |

- **Interaction:** Feature row เปิด WF-07; contributing Domain chips เปิด Domain detail
- **Primary intent:** Open feature; handoff → WF-07. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** ไม่มี Feature: authorized link/create requirement-backed draft
- **Responsive:** Outcome and readiness stay visible; table scrolls

<a id="wf-07"></a>

### WF-07 — Feature Detail

**Purpose:** ติดตาม Requirement → Work → Test → Release ของ Feature เดียว

**Scope / phase:** PROJECT / P1. **Trace:** PMR-003, PMR-015. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Problem, outcome and acceptance |
| B2 | Domain contributions and shared work |
| B3 | Requirements, tests and release trace |

- **Interaction:** Requirement opens WF-10; evidence opens exact revision; shared work deduplicated
- **Primary intent:** Open requirements; handoff → WF-10. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** ยังไม่มี acceptance evidence: แสดง missing evidence
- **Responsive:** Trace chain vertical; no tiny graph text

<a id="wf-08"></a>

### WF-08 — Project Work

**Purpose:** จัดและตรวจงานใน Project ผ่านหลาย view ของข้อมูลชุดเดียว

**Scope / phase:** PROJECT / NAV-P1 / P6 Calendar. **Trace:** PMR-016, PMR-017. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Project filters and view selector |
| B2 | One work dataset in the chosen view |
| B3 | Work item acceptance and evidence drawer |

- **Interaction:** Switch Work view preserves filters/scope; select row/board card opens work inspector
- **Primary intent:** Inspect work item. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** Filtered empty has reset; stale plan locks mutating actions until refreshed
- **Responsive:** Board scrolls within board; table/graph offer text alternatives
- **Variants:** Work Items · Board · Structure Plan · Timeline · Milestones & Gates · Dependencies · Execution Roadmap · Calendar.

<a id="wf-09"></a>

### WF-09 — Execution Views

**Purpose:** ใช้มุมมองที่เหมาะกับ executionMode ของ Workstream

**Scope / phase:** BUSINESS_OR_PROJECT / NAV-P1. **Trace:** PMR-001, PMR-016. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Resolved scope and selected canonical mode |
| B2 | Mode-specific outcome measures |
| B3 | Workstream records and evidence |

- **Interaction:** Select existing Workstream/mode; manual override lives in advanced settings
- **Primary intent:** Open work; handoff → WF-08. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** ยังไม่มี workstream ของ mode นี้: กลับ intake; invalid mode ไม่ fallback Sprint
- **Responsive:** Stage board scrolls; details below selection
- **Variants:** Sprint · Migration · B2B Sales · B2C Campaign · Product Launch · Operations · Expansion.

<a id="wf-10"></a>

### WF-10 — Requirements

**Purpose:** จัด acceptance และ traceability ของ requirement

**Scope / phase:** PROJECT / P2. **Trace:** PMR-015, PMR-032. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Requirement IDs and revision filters |
| B2 | Acceptance criteria and ownership |
| B3 | Trace links to spec, tests and work |

- **Interaction:** Open draft, baseline diff, linked docs and evidence; request review pins revision
- **Primary intent:** Open specification; handoff → WF-13. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** No linked requirement: authorized draft/link; ID collisions block review
- **Responsive:** List/detail stack; long acceptance text wraps

<a id="wf-11"></a>

### WF-11 — Architecture

**Purpose:** ตรวจ node, directed edge, owner และ contract ของ architecture

**Scope / phase:** PROJECT / P2. **Trace:** PMR-004, PMR-014, PMR-032. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Layer and version controls |
| B2 | Directed typed node/edge canvas |
| B3 | Inspector with ports, contract, owner and errors |

- **Interaction:** Select node/edge inspector; validate draft; compare baseline; accessible list
- **Primary intent:** Validate diagram; handoff → WF-15. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** No graph: import validated model; cross-owner WRITES blocks generation
- **Responsive:** Canvas contained pan; inspector stacks; keyboard node/edge list
- **Variants:** Logical · Runtime · Deployment · Dataflow · Accessible list.

<a id="wf-12"></a>

### WF-12 — API Explorer

**Purpose:** อ่าน API ตาม operation โดยเห็น auth/error/schema และ requirement

**Scope / phase:** PROJECT / P2. **Trace:** PMR-005. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Domain tags and operation search |
| B2 | Request, response, auth and error contract |
| B3 | Environment and sandbox request controls |

- **Interaction:** Operation select updates detail; Try-it-out only in authorized sandbox with effect review
- **Primary intent:** Inspect request. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** No selected operation: choose one; unavailable contract shows source error
- **Responsive:** Operation list above detail; code areas contained scroll
- **Variants:** Documentation · Sandbox preview.
- **Guardrail:** No Try it out until exact environment/authority is selected; mutation uses payload review.

<a id="wf-13"></a>

### WF-13 — Docs & Decisions

**Purpose:** อ่านและเทียบเอกสารแบบ revision-pinned

**Scope / phase:** PROJECT / P2. **Trace:** PMR-015, PMR-023, PMR-032. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Document outline and revision list |
| B2 | Specification with linked requirements |
| B3 | Diff, comments and baseline status |

- **Interaction:** Select doc/version; diff; review references exact content hash
- **Primary intent:** Request review; handoff → WF-15. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** Missing doc: link authorized source; broken reference remains visible
- **Responsive:** Document reader first; comments and versions as sections

<a id="wf-14"></a>

### WF-14 — Command Center

**Purpose:** เห็น runs, approval queue, budget exposure และ stale heartbeats

**Scope / phase:** PROJECT / P4 / P5 Fleet. **Trace:** PMR-008, PMR-020, PMR-021. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Queue, active lanes and attention |
| B2 | Live run timeline with freshness |
| B3 | Selected run receipts and available commands |

- **Interaction:** Select run opens WF-15; cancel/pause are commands with receipts
- **Primary intent:** Inspect run; handoff → WF-15. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** No run: select approved workflow; no authority means read-only queue
- **Responsive:** Attention queue first; run columns within scroll region

<a id="wf-15"></a>

### WF-15 — Run / Review / Recovery

**Purpose:** ตัดสินใจบน manifest/evidence และแก้ unknown effect อย่างตรวจสอบได้

**Scope / phase:** PROJECT / P4 / P5. **Trace:** PMR-008, PMR-013, PMR-018, PMR-021. **Forms:** FORM-REVIEW.

| Landmark | Content |
|---|---|
| B1 | Exact scope, version and action manifest |
| B2 | Evidence, diff, effects and blockers |
| B3 | Decision or reconciliation with receipt |

- **Interaction:** Review exact revision; reasoned approval; reconcile UNKNOWN before any retry
- **Primary intent:** Preview decision. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** Missing evidence blocks approval; expired/stale hash requires new review
- **Responsive:** Effect summary before trace; trace wraps
- **Variants:** Admission review · Run trace · Approval · UNKNOWN reconciliation.
- **Guardrail:** Retry is unavailable for unknown external outcome until reconciliation; cancellation request is not completion.

<a id="wf-16"></a>

### WF-16 — Agent Inventory

**Purpose:** ค้น Agent definitions แยกจาก executable approved versions

**Scope / phase:** PROJECT / P4. **Trace:** PMR-006, PMR-028. **Forms:** FORM-DEFINITION.

| Landmark | Content |
|---|---|
| B1 | Search by domain, role and readiness |
| B2 | Definition/version/evaluation table |
| B3 | Agent charter summary |

- **Interaction:** Select definition/version; create definition or next draft opens form
- **Primary intent:** Configure version; handoff → WF-17. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** No agent: create scoped definition; membership grants no tool authority
- **Responsive:** Inventory list then version inspector

<a id="wf-17"></a>

### WF-17 — Agent Version Editor

**Purpose:** กำหนด instruction/tools/model/executor และ evaluation ของ agent version

**Scope / phase:** PROJECT / P4. **Trace:** PMR-006, PMR-013, PMR-028. **Forms:** FORM-AGENT.

| Landmark | Content |
|---|---|
| B1 | Charter and task contract |
| B2 | Tools, context, model and executor policy |
| B3 | Evaluation and version review |

- **Interaction:** Edit draft; validate; evaluation evidence then review; approved version immutable
- **Primary intent:** Validate version; handoff → WF-15. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** Missing references block review; conflict compares revisions
- **Responsive:** Single-column fieldsets; binding tables scroll locally

<a id="wf-18"></a>

### WF-18 — Fleet Inventory & Version

**Purpose:** กำหนด fleet membership, workflow, concurrency และ budgets

**Scope / phase:** PROJECT / P5. **Trace:** PMR-007, PMR-013. **Forms:** FORM-FLEET, FORM-DEFINITION.

| Landmark | Content |
|---|---|
| B1 | Fleet list and immutable version |
| B2 | Pinned member roles and topology |
| B3 | Workflow, concurrency and approval policy |

- **Interaction:** Inventory selection opens version editor; validate resolved versions; review
- **Primary intent:** Preview fleet version; handoff → WF-19. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** Unbound agent/workflow or incompatible schema blocks approval
- **Responsive:** Members list then workflow/policy
- **Variants:** Inventory · Version editor.

<a id="wf-19"></a>

### WF-19 — Workflow Builder

**Purpose:** สร้าง workflow ที่ทุก step มี owner,input,output,timeout/retry policy

**Scope / phase:** PROJECT / P4 / P5. **Trace:** PMR-007, PMR-014, PMR-030. **Forms:** FORM-WORKFLOW.

| Landmark | Content |
|---|---|
| B1 | Workflow versions and step library |
| B2 | DAG with dependency and handoff edges |
| B3 | Step inputs, output schema and validation |

- **Interaction:** Node selection opens step schema; validate DAG and bindings; review before admission
- **Primary intent:** Validate workflow; handoff → WF-15. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** Cycle/unknown field/owner mismatch shown in graph and error list
- **Responsive:** Structured step list replaces drag-only editing

<a id="wf-20"></a>

### WF-20 — Project Team

**Purpose:** ดู Business/Tenant Membership ในบริบท Project พร้อมจำนวนงานที่มอบหมาย; ไม่ใช่ capacity หรือ project-only participation model

**Scope / phase:** PROJECT / NAV-P1. **Trace:** PMR-012, PMR-017. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Project context plus explicit Business Membership authority |
| B2 | Scoped memberships and assigned-item counts; no implied capacity |
| B3 | Selected membership and permitted actions |

- **Interaction:** Inspect membership; authorized Add/Remove use Identity grant/revoke. An actual role change currently returns ROLE_CHANGE_MOVED_TO_PERMISSIONS; the wireframe must not depict a successful in-project promotion.
- **Primary intent:** Inspect member. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** No visible member: invite/link path only when allowed
- **Responsive:** Name and role first; details expand

<a id="wf-21"></a>

### WF-21 — Files & Artifacts

**Purpose:** จัดไฟล์และหลักฐานตาม scope/version/audience

**Scope / phase:** BUSINESS_OR_PROJECT / NAV-P1 / P6 Artifacts. **Trace:** PMR-015, PMR-025, PMR-026. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Scope, classification and file search |
| B2 | Files, versions and deliverable links |
| B3 | Preview, provenance and share policy |

- **Interaction:** Open provenance; share preview shows audience/expiry/redactions before action
- **Primary intent:** Inspect artifact; handoff → WF-15. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** No files: authorized upload; missing evidence does not imply deletion
- **Responsive:** List then detail/share panel; long names wrap
- **Variants:** Files · Artifact detail · Share preview.

<a id="wf-22"></a>

### WF-22 — Repositories

**Purpose:** เชื่อม repository metadata กับ Project และ evidence revision

**Scope / phase:** BUSINESS_OR_PROJECT / NAV-P1 / P6 CI. **Trace:** PMR-031. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Repository and project-role filters |
| B2 | Local metadata and path scope |
| B3 | Commit/PR/check evidence when configured |

- **Interaction:** Open repository record; verified commit/check links when available
- **Primary intent:** Inspect repository. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** No repositories: add metadata; no mandatory GitHub API access
- **Responsive:** Owner/name and role visible; paths wrap

<a id="wf-23"></a>

### WF-23 — Project Inventory

**Purpose:** ดู operational snapshot ของ Project ตาม FR-077/ADR-034 จาก bounded read-only DTO; แยกจาก Project lifecycle page

**Scope / phase:** PROJECT / NAV-P1. **Trace:** PMR-001, PMR-015. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Project identity, KPI counts, weighted progress formula/evidence and warnings |
| B2 | Work previews, milestones, gates, dependencies, files, repositories, team and recent activity |
| B3 | Section status/truncation and links to the actual Work/Dependencies/Files/Repositories/Team owners |

- **Interaction:** Read and follow detail links; preserve PROJECT_INVENTORY version 1.0 and existing identities. Search is a candidate enhancement, not existing behavior inferred from the former Project Index label.
- **Primary intent:** Open work; handoff → WF-08. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** Distinguish loading/error/unauthorized/empty/unavailable and section truncation; show actual preview counts
- **Responsive:** Summary plus semantic section lists; identifiers wrap; full-detail destinations remain reachable

<a id="wf-24"></a>

### WF-24 — Connections Used

**Purpose:** ดู connection ที่ Project ใช้และกลับไปจัดการ Business registry

**Scope / phase:** PROJECT / P3. **Trace:** PMR-009, PMR-010, PMR-011. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Project connection bindings |
| B2 | Model, MCP and executor readiness with probe date |
| B3 | Authorized binding edit and shared-registry link |

- **Interaction:** Select authorized version binding; Manage registry → WF-32 with return context
- **Primary intent:** Manage in Integrations; handoff → WF-32. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** Unconfigured: bind approved resource; no secret entry here
- **Responsive:** Usage list then binding inspector

<a id="wf-25"></a>

### WF-25 — Resources: workforce planning

**Legacy:** Resources was a planned tab. The owner's new PMR-033 explicitly adds workforce behavior; this is a proposed extension, not a recovered legacy implementation.

**Detailed screen authority:** [15 Workforce planning & performance](15-WORKFORCE-CAPACITY-SCHEDULE-AND-PERFORMANCE.md) §7, WF-R01–06. Views: Overview / Workload / Schedule / Performance; Person / Team and Day / Week / Month are view controls.

**Scope / phase:** BUSINESS with Project filter / PMR-033-P1–P5. **Trace:** PMR-033, PMR-017, PMR-012. **Forms:** WF-R05 calendar/allocation planning preview; WF-R06 metric evidence/correction.

| Landmark | Content |
|---|---|
| B1 | Distinct counts, effort/calendar coverage and person/team workload heatmap |
| B2 | Daily budgets, fixed slots and unassigned/unscheduled queues |
| B3 | Performance scorecards with formulas, cohorts and evidence |
| B4 | Preview changes, conflicts, scoped override and versioned receipt |

- **Interaction:** Count → workload/person/team → schedule preview → publish under current authority; metric → evidence drawer.
- **Exception / recovery:** Missing estimate/calendar/history stays UNKNOWN/PARTIAL; no implied free hours or zero performance.
- **Responsive:** Person selector + agenda; accessible table/keyboard form for heatmap or drag operations.
- **Budget:** PMR-020/cost design remains separate; money or resource cost is not required to calculate human workload.
- **Compatibility:** Historical `ux-ui.candidate.json`/FORM-ALLOCATION/gallery are not reconciled to this new screen authority; reconcile before code.

<a id="wf-26"></a>

### WF-26 — Risks & Issues

**Legacy meaning limit:** Risks is an existing PLANNED tab. The risk/issue register, scoring and mitigation below are candidate design, not source-present Project functionality.

**Purpose:** รับผิดชอบ risk/issue พร้อม mitigation, due date และ links

**Scope / phase:** PROJECT / P6. **Trace:** PMR-017. **Forms:** FORM-RISK.

| Landmark | Content |
|---|---|
| B1 | Owner, severity and due filters |
| B2 | Risk/issue register and dependencies |
| B3 | Mitigation, owner and resolution evidence |

- **Interaction:** Open risk, edit draft, link blocking work; close requires evidence
- **Primary intent:** Review risk entry. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** No risks: create scoped risk; foreign refs rejected
- **Responsive:** Register then detail; probability/impact separate
- **Variants:** Risk register · Issue detail.

<a id="wf-27"></a>

### WF-27 — Tests & Releases

**Purpose:** ตัดสิน readiness จาก evidence ที่ตรง revision/environment

**Scope / phase:** PROJECT / P6. **Trace:** PMR-018, PMR-027, PMR-028, PMR-031. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Environment and exact revision |
| B2 | Tests, build, migration and release evidence |
| B3 | Deploy and activation gates separately |

- **Interaction:** Select baseline; inspect tests/deploy/activation separately; release review
- **Primary intent:** Review release evidence; handoff → WF-15. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** No deploy receipt stays not deployed even with green CI
- **Responsive:** Evidence stages vertical; exact revision copyable

<a id="wf-28"></a>

### WF-28 — Activity

**Purpose:** ตรวจเหตุการณ์และ provenance ตาม actor/time/resource

**Scope / phase:** PROJECT / P6. **Trace:** PMR-019, PMR-024. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Event filter and authorized actor |
| B2 | Immutable event and notification timeline |
| B3 | Evidence details and request receipt |

- **Interaction:** Filter authorized audit; open redacted detail; cursor history
- **Primary intent:** Inspect event. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** No events for filter: clear; unavailable stream shows stale marker
- **Responsive:** Chronological list; no fixed-width log dependency

<a id="wf-29"></a>

### WF-29 — Project Settings

**Purpose:** ปรับ project metadata และ policies ตาม permission

**Scope / phase:** PROJECT / P6. **Trace:** PMR-012, PMR-026. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Project identity and existing edit actions |
| B2 | Retention, sharing and notification policy |
| B3 | Policy version diff and review |

- **Interaction:** Edit allowed setting; review sensitive effect; dirty draft leave choice
- **Primary intent:** Review changes. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** Unsupported advanced option shows reason; no new implicit grant
- **Responsive:** One section at a time, one action group

<a id="wf-30"></a>

### WF-30 — Import Plan

**Purpose:** นำเข้าแผนด้วย validate → preview → conflict → commit → receipt เดิม

**Scope / phase:** PROJECT / NAV-P1. **Trace:** PMR-001, PMR-025. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Input source and schema feedback |
| B2 | Dry-run changes, conflicts and target scope |
| B3 | Exact preview confirmation and receipt |

- **Interaction:** Preview parses data only; fix conflict; commit exact preview hash
- **Primary intent:** Preview import; handoff → WF-03. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** Invalid JSON/schema shows location; unknown receipt reconciles
- **Responsive:** Stepper vertical; preview diff/errors stack
- **Variants:** Input · Preview · Conflict · Receipt.

<a id="wf-31"></a>

### WF-31 — Create Project

**Purpose:** เริ่มโปรเจกต์จาก objective และ Workspace เป้าหมาย

**Scope / phase:** BUSINESS / NAV-P1. **Trace:** PMR-001. **Forms:** FORM-PROJECT.

| Landmark | Content |
|---|---|
| B1 | Objective and authorized Workspace |
| B2 | Workstreams with execution modes |
| B3 | Dry-run preview and confirmation |

- **Interaction:** Objective → workstreams (7 modes) → PlanEnvelope preview → existing writer
- **Primary intent:** Preview plan; handoff → WF-30. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** Missing objective/workspace blocks next; no template picker
- **Responsive:** Short stepper; one-column inputs
- **Variants:** Objective · Workstreams · Preview.

<a id="wf-32"></a>

### WF-32 — Provider & MCP Registry

**Purpose:** จัด Business registry แยก provider/model/MCP/key/executor/routing

**Scope / phase:** BUSINESS / P3. **Trace:** PMR-009, PMR-010, PMR-011. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Connection/model/tool/executor tabs |
| B2 | Provider, endpoint and dated probe evidence |
| B3 | Binding, credential and gateway-key boundaries |

- **Interaction:** Tabs open setup; Project return link reauthorizes original scope
- **Primary intent:** Configure connection; handoff → WF-33. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** Empty registry: profile setup; denied admin no metadata
- **Responsive:** Labeled tab selector; inspector stacks
- **Variants:** Providers & Connections · Model Deployments · MCP Servers & Tools · Inference API Keys · Executors · Routing & Budgets.

<a id="wf-33"></a>

### WF-33 — Model Connection Setup

**Purpose:** ตั้ง model connection ตาม network/execution profile

**Scope / phase:** BUSINESS / P3. **Trace:** PMR-009, PMR-011. **Forms:** FORM-PROVIDER, FORM-MODEL, FORM-CREDENTIAL.

| Landmark | Content |
|---|---|
| B1 | Cloud/self-host/local connection identity |
| B2 | Conditional transport and executor fields |
| B3 | Credential action and probe result |

- **Interaction:** Connection → deployment → credential → probe/review/bind
- **Primary intent:** Preview connection; handoff → WF-24. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** Offline executor/unverified capability not healthy; save not probe
- **Responsive:** Profile selector then conditional fieldsets
- **Variants:** Cloud · Self-host gateway · Paired local executor.

<a id="wf-34"></a>

### WF-34 — MCP Setup

**Purpose:** ตั้ง MCP แบบ remote HTTP หรือ paired STDIO

**Scope / phase:** BUSINESS / P3. **Trace:** PMR-010. **Forms:** FORM-MCP.

| Landmark | Content |
|---|---|
| B1 | Transport and server identity |
| B2 | Pinned tool schemas and allow-list |
| B3 | Auth profile, executor binding and consent |

- **Interaction:** Discover snapshot through broker; choose allowlist; review diff
- **Primary intent:** Preview MCP binding; handoff → WF-24. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** Tool schema change stale; arbitrary command not accepted
- **Responsive:** Transport first; endpoint/executor condition
- **Variants:** Streamable HTTP · Local stdio.

<a id="wf-35"></a>

### WF-35 — Inference API Keys

**Purpose:** ออก inference key แบบ Project/model/quota/expiry scoped

**Scope / phase:** BUSINESS / P3. **Trace:** PMR-011, PMR-012, PMR-026. **Forms:** FORM-KEY.

| Landmark | Content |
|---|---|
| B1 | Project, models, expiry and limits |
| B2 | Review exact inference-only grant |
| B3 | One-time reveal, metadata and revocation |

- **Interaction:** Review grant; one-time reveal after receipt; later metadata/revoke
- **Primary intent:** Review key grant. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** Timeout needs lookup; secret never read back from metadata
- **Responsive:** Grant summary before action; secret excluded from export
- **Variants:** Create grant · One-time reveal · Key metadata.
- **Guardrail:** The wireframe contains no real key and accepts no secret; production reveals once after authorized issuance.

<a id="wf-36"></a>

### WF-36 — Executors

**Purpose:** ดู enrolled executors, capability, heartbeat และ lease

**Scope / phase:** BUSINESS / P3 / P4. **Trace:** PMR-010, PMR-021, PMR-029. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Host/executor inventory and trust state |
| B2 | Capabilities, heartbeat and lease health |
| B3 | Pairing, recovery and current grants |

- **Interaction:** Open executor; authorized re-enroll/revoke with effect review
- **Primary intent:** Inspect executor. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** Offline/stale visible; revoke does not prove remote process stopped
- **Responsive:** Health summary + lease list

<a id="wf-37"></a>

### WF-37 — Routing & Budgets

**Purpose:** ตรวจ routing, fallback และ budget policy ที่มีสิทธิ์ใช้งาน

**Scope / phase:** BUSINESS / P3. **Trace:** PMR-009, PMR-020, PMR-029. **Forms:** No new form in this screen family.

| Landmark | Content |
|---|---|
| B1 | Versioned routing policy and model eligibility |
| B2 | Priority, failover and data residency constraints |
| B3 | Budget reservations, limits and evaluation |

- **Interaction:** Inspect authorized policy versions and constraints; policy editing/approval stays unavailable until a Business-scoped owner contract is approved
- **Primary intent:** Inspect policy constraints. Product effects require authorization, validation and receipt; the artifact demonstrates navigation/preview.
- **Exception / recovery:** No authorized fallback blocks; UNKNOWN cannot auto-failover
- **Responsive:** Policy steps stacked; candidate/active versions distinct
- **Guardrail:** Cross-provider failover requires policy authorization; UNKNOWN side effects do not trigger automatic resubmission.
- **Contract gate:** The 72-operation candidate contract has Project ReviewInput only. It does not define a Business policy review operation. Never send a routing policy through Project reviews; define or bind the owner contract before P3 policy editing.

## 5. Field-level handoff

Bound to [candidate OpenAPI](contracts/openapi.candidate.yaml), with objective-first creation bound to existing source. Required means property presence; array validity follows minItems. Conditional server validation is mandatory. Reference choices are scoped and revision-pinned as applicable. Date-time fields explicitly show the selected timezone in the product; local controls serialize with offset/UTC per contract.

### FORM-PROJECT — เป้าหมายของโปรเจกต์

**Authority:** Existing apps/server/src/app/(pm)/projects/new/page.jsx. Server contract is authority; show inline errors and linked summary; no secrets in saved draft.

| Field | Label | Control | Required | Constraints / help |
|---|---|---|---|---|
| objective | Objective / เป้าหมาย | textarea | Yes | อธิบายผลลัพธ์ที่ต้องการส่งมอบ |
| workspaceId | Workspace ปลายทาง | select | Yes | เลือกจาก Workspace ที่ได้รับสิทธิ์ |
| description | รายละเอียด (ไม่บังคับ) | textarea | No | Server validation |
| targetAt | วันที่เป้าหมาย (ไม่บังคับ) | date | No | Server validation |

### FORM-DEFINITION — ข้อมูลนิยาม Agent / Fleet

**Authority:** OpenAPI components.schemas.DefinitionInput. Server contract is authority; show inline errors and linked summary; no secrets in saved draft.

| Field | Label | Control | Required | Constraints / help |
|---|---|---|---|---|
| code | รหัสนิยาม | text | Yes | {"type":"string","minLength":1,"maxLength":64}; รหัสเดิมคงตัวเมื่อเปลี่ยนชื่อ |
| name | ชื่อที่แสดง | text | Yes | {"type":"string","minLength":1,"maxLength":160} |
| description | หน้าที่และขอบเขต | textarea | Yes | {"type":"string","minLength":1,"maxLength":2000} |
| ownerDomain | Domain เจ้าของ | select | Yes | {"type":"string","minLength":1,"maxLength":512} |
| executionKind | ประเภทการปฏิบัติงาน | select | Yes | {"type":"string","enum":["PROJECT_DELIVERY","BUSINESS_AUTOMATION"]}; แยกงานพัฒนาผลิตภัณฑ์กับ business automation |

### FORM-AGENT — Agent version

**Authority:** OpenAPI components.schemas.AgentVersionInput. Server contract is authority; show inline errors and linked summary; no secrets in saved draft.

| Field | Label | Control | Required | Constraints / help |
|---|---|---|---|---|
| charter | ขอบเขตและความรับผิดชอบ | textarea | Yes | Server validation |
| instructions | คำสั่งการทำงาน | textarea | Yes | ข้อความนี้ไม่เพิ่มสิทธิ์ให้ Agent |
| skillRefs | Skills ที่อ้างอิง | multiselect | Yes | {"type":"array","maxItems":50} |
| tools | Tools และขอบเขตข้อมูล | tool-bindings | Yes | {"type":"array","maxItems":100}; เลือก tool ID, schema hash, effect และ capability |
| allowedRoles | บทบาทที่อนุญาต | multiselect | Yes | {"type":"array","maxItems":20} |
| modelPolicyVersionId | Model policy version | reference | Yes | {"type":"string","format":"uuid"} |
| executorProfileId | Executor profile | reference | Yes | {"type":"string","format":"uuid"} |
| inputSchema | Input schema | schema | Yes | Server validation |
| outputSchema | Output schema | schema | Yes | Server validation |
| evaluationSuiteId | ชุดประเมิน | reference | Yes | {"type":"string","format":"uuid"} |
| reason | เหตุผลของรุ่นนี้ | textarea | Yes | {"type":"string","minLength":1,"maxLength":1000} |

### FORM-FLEET — Fleet version

**Authority:** OpenAPI components.schemas.FleetVersionInput. Server contract is authority; show inline errors and linked summary; no secrets in saved draft.

| Field | Label | Control | Required | Constraints / help |
|---|---|---|---|---|
| members | สมาชิกและ role ที่ผูก version | member-bindings | Yes | {"type":"array","maxItems":50}; ทุกแถวระบุ agentVersionId ที่แน่นอน |
| workflowVersionId | Workflow version | reference | Yes | {"type":"string","format":"uuid"} |
| maxConcurrency | จำนวนงานพร้อมกันสูงสุด | number | Yes | {"type":"integer","minimum":1,"maximum":20} |
| approvalPolicy | นโยบายการอนุมัติ | policy | Yes | Server validation |
| budgetPolicyVersionId | Budget policy version | reference | Yes | {"type":"string","format":"uuid"} |
| reason | เหตุผลของรุ่นนี้ | textarea | Yes | {"type":"string","minLength":1,"maxLength":1000} |

### FORM-WORKFLOW — Workflow version

**Authority:** OpenAPI components.schemas.WorkflowVersionInput. Server contract is authority; show inline errors and linked summary; no secrets in saved draft.

| Field | Label | Control | Required | Constraints / help |
|---|---|---|---|---|
| definition | ขั้นตอนและ handoff | workflow | Yes | กำหนด step, dependsOn, ownerDomain, inputRefs และ outputs |
| schemaVersion | Schema version | readonly | Yes | {"type":"string","enum":["1.0"]} |
| reason | เหตุผลของรุ่นนี้ | textarea | Yes | {"type":"string","minLength":1,"maxLength":1000} |

### FORM-REVIEW — Review decision

**Authority:** OpenAPI components.schemas.ReviewInput. Server contract is authority; show inline errors and linked summary; no secrets in saved draft.

| Field | Label | Control | Required | Constraints / help |
|---|---|---|---|---|
| resourceType | ชนิดรายการ | readonly | Yes | {"type":"string","enum":["DESIGN_SNAPSHOT","AGENT_VERSION","FLEET_VERSION","WORKFLOW_VERSION","CHANGE_REQUEST","RELEASE"]} |
| resourceId | รายการที่กำลังตรวจ | readonly | Yes | {"type":"string","format":"uuid"} |
| manifestSha256 | ลายนิ้วมือของรุ่นที่ตรวจ | readonly | Yes | {"type":"string","pattern":"^[a-f0-9]{64}$"}; แสดงคำอธิบายและเปิดดู hash เต็มได้ |
| decision | การตัดสินใจ | select | Yes | {"type":"string","enum":["APPROVE","REJECT"]} |
| reason | เหตุผลและข้อสังเกต | textarea | Yes | {"type":"string","minLength":1,"maxLength":2000} |
| evidenceRefs | หลักฐานประกอบ | multiselect | Yes | {"type":"array","maxItems":50} |
| expiresAt | หมดอายุการอนุมัติ | datetime-local | Yes | {"type":"string","format":"date-time"} |

### FORM-PROVIDER — Provider connection

**Authority:** OpenAPI components.schemas.ConnectionInput. Server contract is authority; show inline errors and linked summary; no secrets in saved draft.

| Field | Label | Control | Required | Constraints / help |
|---|---|---|---|---|
| providerId | Provider | select | Yes | {"type":"string","format":"uuid"} |
| name | ชื่อ connection | text | Yes | {"type":"string","minLength":1,"maxLength":160} |
| purpose | วัตถุประสงค์ | select | Yes | {"type":"string","enum":["PROJECT_MODELS","PROJECT_MCP"]} |
| networkProfileId | Network profile | reference | Yes | {"type":"string","format":"uuid"} |

### FORM-MODEL — Model deployment

**Authority:** OpenAPI components.schemas.ModelDeploymentInput. Server contract is authority; show inline errors and linked summary; no secrets in saved draft.

| Field | Label | Control | Required | Constraints / help |
|---|---|---|---|---|
| connectionId | Connection ที่ใช้ | reference | Yes | {"type":"string","format":"uuid"} |
| name | ชื่อ deployment | text | Yes | {"type":"string","minLength":1,"maxLength":160} |
| executionLocation | ตำแหน่งที่รัน | select | Yes | {"type":"string","enum":["CLOUD","PRIVATE_SERVER","PAIRED_EXECUTOR"]} |
| protocolProfile | Protocol profile | select | Yes | {"type":"string","enum":["OPENAI_CHAT_COMPATIBLE","ANTHROPIC_MESSAGES","PROVIDER_NATIVE"]} |
| endpointUrl | Endpoint URL | url | Conditional: executionLocation=CLOUD / PRIVATE_SERVER; endpoint may be supplied by provider profile | {"type":"string","format":"uri","maxLength":2048}; ตรวจรูปแบบและ network policy ก่อน probe |
| executorId | Paired executor | reference | Conditional: executionLocation=PAIRED_EXECUTOR | {"type":"string","format":"uuid"}; ใช้ executor ที่ enroll แล้ว |
| modelIdentifier | Model identifier | text | Yes | {"type":"string","minLength":1,"maxLength":256} |
| modelRevision | Model revision | text | Yes | {"type":"string","minLength":1,"maxLength":256} |
| requiredCapabilities | Capabilities ที่ต้องใช้ | multiselect | Yes | {"type":"array","maxItems":6,"itemEnum":["CHAT","STREAMING","TOOLS","STRUCTURED_OUTPUT","EMBEDDINGS","VISION"]} |
| routingPolicyVersionId | Routing policy version | reference | Yes | {"type":"string","format":"uuid"} |

### FORM-CREDENTIAL — Write-only credential

**Authority:** OpenAPI components.schemas.ModelProviderCredentialInput. Server contract is authority; show inline errors and linked summary; no secrets in saved draft.

| Field | Label | Control | Required | Constraints / help |
|---|---|---|---|---|
| kind | Credential kind | readonly | Yes | {"type":"string","enum":["MODEL_PROVIDER_KEY"]} |
| apiKey | Provider API key | secret | Yes | {"type":"string","minLength":1,"maxLength":8192}; กรอกจริงเฉพาะระบบที่อนุมัติแล้ว; wireframe ไม่รับ secret |
| reason | เหตุผลการตั้งค่า / หมุน key | textarea | Yes | {"type":"string","minLength":1,"maxLength":1000} |

Secret field disabled; synthetic marker only. API-key profile; OAuth client profile separately reviewed.

### FORM-MCP — MCP binding

**Authority:** OpenAPI components.schemas.McpBindingInput. Server contract is authority; show inline errors and linked summary; no secrets in saved draft.

| Field | Label | Control | Required | Constraints / help |
|---|---|---|---|---|
| connectionId | Connection | reference | Yes | {"type":"string","format":"uuid"} |
| name | ชื่อ MCP server | text | Yes | {"type":"string","minLength":1,"maxLength":160} |
| transport | Transport | select | Yes | {"type":"string","enum":["STDIO","STREAMABLE_HTTP"]} |
| protocolVersion | Protocol version | readonly | Yes | {"type":"string","enum":["2025-11-25"]} |
| endpointUrl | Streamable HTTP endpoint | url | Conditional: transport=STREAMABLE_HTTP | {"type":"string","format":"uri","maxLength":2048}; สำหรับ HTTP transport |
| executorProfileId | Paired executor profile | reference | Conditional: transport=STDIO | {"type":"string","format":"uuid"}; ไม่มีช่อง arbitrary command |
| toolSnapshot | Tool schema snapshot | readonly | Yes | Server validation |
| allowedToolIds | Tools ที่อนุญาต | multiselect | Yes | {"type":"array","maxItems":100} |
| authProfileId | Auth profile | reference | Yes | {"type":"string","format":"uuid"} |

### FORM-KEY — Inference API key grant

**Authority:** OpenAPI components.schemas.InferenceKeyInput. Server contract is authority; show inline errors and linked summary; no secrets in saved draft.

| Field | Label | Control | Required | Constraints / help |
|---|---|---|---|---|
| name | ชื่อ key | text | Yes | {"type":"string","minLength":1,"maxLength":160} |
| projectId | โปรเจกต์ที่อนุญาต | reference | Yes | {"type":"string","format":"uuid"} |
| allowedModelIds | Models ที่อนุญาต | multiselect | Yes | {"type":"array","maxItems":50} |
| expiresAt | วันเวลาหมดอายุ | datetime-local | Yes | {"type":"string","format":"date-time"} |
| requestsPerMinute | Requests ต่อนาที | number | Yes | {"type":"integer","minimum":1,"maximum":10000} |
| maxTokensPerDay | Tokens ต่อวัน | number | Yes | {"type":"integer","minimum":1} |
| reason | เหตุผลการออก key | textarea | Yes | {"type":"string","minLength":1,"maxLength":1000} |

### FORM-ALLOCATION — Resource allocation

**Authority:** OpenAPI components.schemas.AllocationInput. Server contract is authority; show inline errors and linked summary; no secrets in saved draft.

| Field | Label | Control | Required | Constraints / help |
|---|---|---|---|---|
| resourceId | ทรัพยากร / ผู้ปฏิบัติงาน | reference | Yes | {"type":"string","format":"uuid"} |
| workItemId | รายการงาน | reference | Yes | {"type":"string","format":"uuid"} |
| startAt | เริ่ม | datetime-local | Yes | {"type":"string","format":"date-time"} |
| endAt | สิ้นสุด | datetime-local | Yes | {"type":"string","format":"date-time"} |
| effortHours | Effort (ชั่วโมง) | number | Yes | {"type":"number","minimum":0} |
| capacityOverrideReason | เหตุผลใช้เกิน capacity | textarea | Conditional: over capacity | {"type":"string","minLength":1,"maxLength":1000}; ต้องมีเมื่อ override ตาม policy |

### FORM-RISK — Risk entry

**Authority:** OpenAPI components.schemas.RiskInput. Server contract is authority; show inline errors and linked summary; no secrets in saved draft.

| Field | Label | Control | Required | Constraints / help |
|---|---|---|---|---|
| code | รหัสความเสี่ยง | text | Yes | {"type":"string","minLength":1,"maxLength":64} |
| title | ความเสี่ยง | text | Yes | {"type":"string","minLength":1,"maxLength":160} |
| ownerId | ผู้รับผิดชอบ | reference | Yes | {"type":"string","format":"uuid"} |
| probability | โอกาสเกิด | number | Yes | {"type":"number","minimum":0,"maximum":1}; ใช้สเกลและขอบเขตจาก contract |
| impact | ผลกระทบ | select | Yes | {"type":"string","enum":["LOW","MEDIUM","HIGH","CRITICAL"]}; ใช้สเกลและขอบเขตจาก contract |
| mitigation | แนวทางลดความเสี่ยง | textarea | Yes | {"type":"string","minLength":1,"maxLength":2000} |
| dueAt | วันที่ต้องทบทวน | datetime-local | Yes | {"type":"string","format":"date-time"} |
| linkedRefs | งาน / Feature ที่เกี่ยวข้อง | multiselect | Yes | {"type":"array","maxItems":100} |

## 6. Coverage and implementation handoff

Navigation IDs → screen IDs → PMR requirements → contract fields. [Traceability](contracts/traceability.json) remains the PMR/PMT authority; WF/FORM/UI IDs are local design references, not permanent FR/FEAT declarations.

Register canonical subjects for each approved slice, then map accepted screen/diagram/schema versions to component/test anchors. Preserve the source URL mapping in navigation.candidate.json. A planned screen name does not approve a new route. Diagram-to-code output must obey owner/type constraints; form scaffolds must preserve schema semantics and server conditions. Review generated output before commit.

Navigation approval remains NAV-P0/NAV-P1 unless the owner explicitly approves further phases. User-study targets, product accessibility checks, live APIs, providers, keys and execution remain PLANNED / NOT_RUN. Artifact verification belongs in [Evidence & Review](08-EVIDENCE-AND-REVIEW.md).

## 7. Version diff

| Prior package 0.2.0b | Package 0.3.0b supplement |
|---|---|
| Navigation placement and abstract UX inventory | UX goals/personas, ten task journeys and failure branches |
| Navigation prototype | 37 screen families with distinct layouts and state inspection |
| API and navigation contracts separate | 13 forms / 83 field mappings tied to schema or creation source |
| Heritage reference | Semantic usage, contrast, validation and responsive rules |
| Product acceptance families | Add 14 UI scenarios and screen-level handoff; product tests still not run |

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-16 | candidate | 37 screen specs, 13 field inventories, shared shell and design-to-code handoff | base 087f3025 | RWANG |
| 1.0.0b | 2026-09-16 | candidate | Replace shared shell recommendation with Domain/module/tabs; mark existing gallery and JSON mappings as requiring reconciliation | source 000b26f1 | RWANG |
| 1.1.0b | 2026-09-16 | candidate | Correct WF-20/23 semantics and clarify WF-25/26 proposed scope from the complete legacy-tab audit | source 96630462 | RWANG |
| 1.2.0b | 2026-09-16 | candidate | Extend WF-25 with six workforce wireframes and four local views under PMR-033 | source 0f5a47fc; uncommitted | RWANG |
