---
id: ZAI:PM-SYSTEM-REQUIREMENTS
title: Project Manager requirements and user experience
version: "0.5.0b"
status: candidate
created_at: "2026-09-15T23:49:58+07:00,RWANG,base 087f3025"
last_update: "2026-09-18T20:42:13+07:00,RWANG"
superseded_by: null
attributes:
  doc_type: requirements-specification
  domain: project-manager
relations:
  - type: references
    target: ZAI:PM-SYSTEM-DESIGN
---

# Requirements & UX

**Version:** 0.5.0b · **Status:** Candidate

**Latest owner requirement:** [15 Workforce planning & performance](15-WORKFORCE-CAPACITY-SCHEDULE-AND-PERFORMANCE.md). PMR-033 extends PMR-017 with precise human workforce behavior; approved requirement intent, detailed design remains candidate.

## 1. Personas และ authority

| Persona | งาน | Authority ที่ต้อง resolve |
|---|---|---|
| Sponsor / Business owner | เป้าหมาย งบ baseline และ final acceptance | active Membership + explicit capabilities |
| Project manager | แผน ลำดับงาน resources, blockers และ agent runs | project scope + planning/dispatch capabilities |
| Domain owner | contracts, review และ lane ของตน | domain-scoped authority; ชื่อเจ้าของงานอย่างเดียวไม่พอ |
| Developer / specialist | รับงาน ทำ artifact เสนอ change | work assignment + allowed tool/resource scope |
| Reviewer / QA | ตรวจ spec, diff, tests และหลักฐาน | review capability; independent approval ตาม policy |
| Integration administrator | providers, endpoints, credentials และ MCP | integration management + step-up สำหรับ secrets |
| Installation operator | host health/recovery/installation operations | operator grant; ไม่ได้ Business data โดยปริยาย |
| Observer | ดูสถานะ/เอกสารที่อนุญาต | read-only project/artifact grant |
| Agent executor | ทำ step ที่ server มอบหมาย | expiring attempt token; audience + lane + exact capabilities |

ชื่อ persona เป็น UX role; ต้องแมปสู่ resolver/capability ของ identity ก่อน code ไม่สร้าง parallel RBAC ที่อ้างชื่อใน inventory

## 2. Requirement catalog

Requirement bodies are extracted one per file under [Project Manager proposal requirements](../../domains/project-manager/requirements/README.md). This Site-spine document retains personas and UX context; it no longer duplicates the normative requirement prose.

| Requirement family | Local source | Capability | Owner | Existing FR context |
|---|---|---|---|---|
|PMR-001|[requirement file](../../domains/project-manager/requirements/PMR-001-proposal-requirement.md)|PMF-01|project-manager|FR-003, FR-069, FR-108|
|PMR-002|[requirement file](../../domains/project-manager/requirements/PMR-002-proposal-requirement.md)|PMF-01|project-manager|FR-070, FR-124|
|PMR-003|[requirement file](../../domains/project-manager/requirements/PMR-003-proposal-requirement.md)|PMF-01|project-manager|FR-124|
|PMR-004|[requirement file](../../domains/project-manager/requirements/PMR-004-proposal-requirement.md)|PMF-02|project-manager|FR-007|
|PMR-005|[requirement file](../../domains/project-manager/requirements/PMR-005-proposal-requirement.md)|PMF-03|project-manager|FR-019, FR-106|
|PMR-006|[requirement file](../../domains/project-manager/requirements/PMR-006-proposal-requirement.md)|PMF-04|project-manager|none|
|PMR-007|[requirement file](../../domains/project-manager/requirements/PMR-007-proposal-requirement.md)|PMF-05|project-manager|none|
|PMR-008|[requirement file](../../domains/project-manager/requirements/PMR-008-proposal-requirement.md)|PMF-06|integration|FR-070|
|PMR-009|[requirement file](../../domains/project-manager/requirements/PMR-009-proposal-requirement.md)|PMF-07|integration|FR-048|
|PMR-010|[requirement file](../../domains/project-manager/requirements/PMR-010-proposal-requirement.md)|PMF-07|integration|none|
|PMR-011|[requirement file](../../domains/project-manager/requirements/PMR-011-proposal-requirement.md)|PMF-07|integration|FR-242|
|PMR-012|[requirement file](../../domains/project-manager/requirements/PMR-012-proposal-requirement.md)|PMF-08|identity|FR-191, FR-192|
|PMR-013|[requirement file](../../domains/project-manager/requirements/PMR-013-proposal-requirement.md)|PMF-06|project-manager|FR-196|
|PMR-014|[requirement file](../../domains/project-manager/requirements/PMR-014-proposal-requirement.md)|PMF-02|project-manager|none|
|PMR-015|[requirement file](../../domains/project-manager/requirements/PMR-015-proposal-requirement.md)|PMF-08|project-manager|FR-124|
|PMR-016|[requirement file](../../domains/project-manager/requirements/PMR-016-proposal-requirement.md)|PMF-01|project-manager|none|
|PMR-017|[requirement file](../../domains/project-manager/requirements/PMR-017-proposal-requirement.md)|PMF-01|project-manager|none|
|PMR-018|[requirement file](../../domains/project-manager/requirements/PMR-018-proposal-requirement.md)|PMF-10|project-manager|none|
|PMR-019|[requirement file](../../domains/project-manager/requirements/PMR-019-proposal-requirement.md)|PMF-08|identity|FR-198|
|PMR-020|[requirement file](../../domains/project-manager/requirements/PMR-020-proposal-requirement.md)|PMF-10|integration|FR-239, FR-240|
|PMR-021|[requirement file](../../domains/project-manager/requirements/PMR-021-proposal-requirement.md)|PMF-06|integration|none|
|PMR-022|[requirement file](../../domains/project-manager/requirements/PMR-022-proposal-requirement.md)|PMF-09|knowledge|none|
|PMR-023|[requirement file](../../domains/project-manager/requirements/PMR-023-proposal-requirement.md)|PMF-09|project-manager|none|
|PMR-024|[requirement file](../../domains/project-manager/requirements/PMR-024-proposal-requirement.md)|PMF-09|integration|none|
|PMR-025|[requirement file](../../domains/project-manager/requirements/PMR-025-proposal-requirement.md)|PMF-09|project-manager|FR-108|
|PMR-026|[requirement file](../../domains/project-manager/requirements/PMR-026-proposal-requirement.md)|PMF-09|identity|none|
|PMR-027|[requirement file](../../domains/project-manager/requirements/PMR-027-proposal-requirement.md)|PMF-08|project-manager|FR-124|
|PMR-028|[requirement file](../../domains/project-manager/requirements/PMR-028-proposal-requirement.md)|PMF-10|project-manager|none|
|PMR-029|[requirement file](../../domains/project-manager/requirements/PMR-029-proposal-requirement.md)|PMF-10|integration|none|
|PMR-030|[requirement file](../../domains/project-manager/requirements/PMR-030-proposal-requirement.md)|PMF-06|integration|none|
|PMR-031|[requirement file](../../domains/project-manager/requirements/PMR-031-proposal-requirement.md)|PMF-10|integration|none|
|PMR-032|[requirement file](../../domains/project-manager/requirements/PMR-032-proposal-requirement.md)|PMF-02|project-manager|none|
|PMR-033|[requirement file](../../domains/project-manager/requirements/PMR-033-proposal-requirement.md)|PMF-11|project-manager; people, Identity/CRM ports|FR-036|

PMR/PMF/PMT remain proposal-local. Register a canonical FR/FEAT/ADR before implementation.

## 3. Navigation และ screen contracts

Entity hierarchy: **Group (Portfolio) → Organization (Tenant) → Business → Workspace → Project**. Global context bar จบที่ Business; Workspace/Project เป็น module resources. Branch เป็น location reference แยกจาก project/work hierarchy; การเลือก filter ไม่เปลี่ยน identity grant

Navigation authority ของข้อเสนอนี้: [09 Navigation refinement](09-NAVIGATION-REFINEMENT.md). เสนอปรับ parent navigation contract ให้ sidebar ของ Project แทน Business sidebar เฉพาะเมื่อเปิด authorized project resource; ยกเลิก ProjectTabs rail หลัง implementation ผ่าน acceptance และยังไม่เปลี่ยน ADR-011 ที่ accepted ในรอบเอกสารนี้

```text
Overview
Planning [Domains / Features / Work / Execution views]
Design & specs [Requirements / Architecture / API Explorer / Docs & Decisions]
Agents & runs [Command Center / Agent Inventory / Fleet Inventory / Workflows]
Project resources [Team / Files & Artifacts / Repositories / Project Index / Connections used]
Control & evidence [Resources & Budget / Risks & Issues / Tests & Releases / Activity / Project Settings]
Persistent header action: Import Plan
```

Work มีแถบมุมมองย่อยเฉพาะหน้า: Work Items (table/list), Board, Structure Plan, Timeline, Milestones & Gates, Dependencies, Execution Roadmap และ Calendar ที่ยัง planned. NAV-P1 เก็บหน้าเดิมก่อน; full-target labels/capabilities เปิดตาม feature gate

Provider/MCP registry เป็น Business-level integration surface; Project มีเมนู “Connections used” ที่อ้าง binding เท่านั้น Registry ไม่ถูก copy ต่อ Project

### Domain view

- รายการ Domain เป็นหน้าเริ่มต้นของ tab; คอลัมน์ owner, feature count, unique work count, blockers, readiness, last evidence
- Detail: charter → owned services/models/routes → features ที่เกี่ยวข้อง → backlog → active lane → incoming/outgoing contracts
- Domain filter, status และ search เก็บใน URL; ทุก count คำนวณหลัง authorization
- Domain ที่ยังไม่มีงานแสดง 0; unknown evidence แสดง “ยังไม่มีหลักฐาน” ไม่แปลงเป็น complete
- กลุ่ม navigation เช่น CRM/SCM ไม่มี own-model/own-route และไม่ถูกนับเป็น Domain writer

### Feature view

- การ์ด/ตาราง feature: problem, outcome/KPI, primary owner, contributing domains, requirement count, acceptance, dependencies, release
- หนึ่ง Feature มี primary owner หนึ่งรายและ contributions หลายราย; ไม่บังคับ feature อยู่ใต้ Domain เดียวใน tree
- เปิด Feature แล้วเห็น trace chain และ test evidence ต่อ requirement; “100% coded” ไม่ให้สถานะ deployed
- ตัวอย่างเชิงออกแบบ: Provider Registry → Integration (connection/model), Identity (key/capability), PM (binding UI)
- Project-local capability ใช้ UUID + local code; canonical product FEAT เชื่อมแบบ reference มี repo + version ไม่เขียนกลับ FEATURES โดยการแก้ title ใน UI

### Architecture view

สามแผง: catalog/filter ซ้าย, canvas กลาง, inspector ขวา มี layer toggle **logical / runtime / deployment / dataflow**
- คลิก edge ดู source port → target port, edge type, contract, auth, timeout, failure mode, owner และ spec version
- Draft mode แก้ node/edge → validate → diff → review → approve snapshot; approved mode เป็น read-only
- แยก planned graph, observed graph และ drift; runtime metric เป็น overlay มี timestamp
- Graph cycles อนุญาตตาม edge type; execution DAG ห้าม cycle ส่วน event subscriptions ไม่ถูกตัดทิ้งเพียงเพราะเป็น cycle
- layout/camera เป็น user preference; ไม่เปลี่ยน semantic hash
- keyboard list → select → connect dialog ใช้ contract เดียวกับ drag; state/error ไม่สื่อด้วยสีอย่างเดียว

### API view

- Tags = domain, filter = feature/requirement/environment/spec version; operationId เป็น stable key
- แสดง request/response schemas, auth capability, errors, idempotency, pagination, rate limits และ sample data ที่ระบุว่า synthetic
- operation เชื่อมไป architecture edge และ tests
- ค่าเริ่มต้น documentation only; เลือก sandbox ก่อน Try it out; mutation แสดง concrete payload/target scope และ policy approval
- ไม่มี provider key ในหน้า; browser ใช้ session/CSRF ผ่าน same-origin API
- “Spec says” กับ “Last verified server revision” แยกกัน ไม่เรียก fetched spec ว่า deployed proof

### Agent / Fleet / Command Center

- Agent list แสดง definition version, domain desk, permitted roles, executor readiness, model policy, eval badge
- Agent detail: Identity & charter / Skills & tools / Models & context / Runtime / Evaluation / Versions & audit
- Fleet detail: member versions / workflow canvas / handoff schemas / approval / budgets / runs
- Command Center: queue, domain desks, active step, lease countdown, logs/events, pending approvals, failures, usage
- Buttons ระบุตรง ๆ “เริ่ม run”, “หยุด enqueue”, “ขอยกเลิก”, “retry step”; ทุกคำสั่งมี command receipt
- Disconnect stream แสดง stale data และ reconnect; ไม่เปลี่ยน run เป็น failed จาก browser disconnect

## 4. Primary journeys

| Journey | Sequence | End condition |
|---|---|---|
| Human planning | Objective → scope/outcome → work decomposition → dependencies/estimates → dry-run → baseline review | Accepted version + audit |
| Domain delivery | เลือก Domain → Feature contribution → requirement → task → artifact → test → gate | Owner ตรวจ artifact/acceptance ได้ |
| Agent setup | Define charter binding → select tools/model/executor → eval → review → publish immutable version | READY เมื่อ binding/probe/current grant ผ่าน |
| Fleet setup | Select approved agents → define DAG/handoffs → configure review/budget → simulate dry-run → publish | All refs resolvable; no cycle; budgets bounded |
| Run | Select exact versions → preflight → approval if required → queued → claim → execute → evidence → accept | Run outcome and product acceptance แยกสถานะ |
| Self-host onboarding | Register connection → enroll private executor/network → probe model → issue scoped gateway client key → smoke test | Callable allowed model; secret not returned again |
| Change request | Select approved baseline → propose diff → impact graph → independent review → new baseline | Old run pins old version; new run selects new version |
| Recovery | Open incident → inspect last receipt → reconcile external outcome → retry new attempt or abandon | No duplicated effect; evidence retained |

## 5. Missing essentials ที่ต้องมี

- Backlog prioritization, milestones, critical path, calendar/timezone and working days; resource allocations รวม across Projects
- Risk/issue/decision register, dependency owner, escalation deadline, blocked reason and resolution evidence
- Baseline and change request: impact ต่อ dates/cost/contracts; versioned acceptance criteria
- Documents/artifacts, comment threads, notifications, scoped search and secure share links
- CI/repository evidence and release/environment inventory; test run and deployment event แยกจาก task status
- User help, empty/loading/error/forbidden/stale states, keyboard shortcuts, Thai/English labels and date/currency formatting

ไม่มี universal completion formula ใหม่; task count เป็น activity metric และชื่อ “missing” หมายถึงสิ่งที่ต้องเติมใน full design นี้ ไม่ใช่ข้อสรุปว่าทั้ง repo ไม่มีทุกองค์ประกอบ

## 6. UX acceptance

- Desktop canvas, tablet split view และ mobile list view แสดงข้อมูลสำคัญและ commands เดียวกันตามสิทธิ์
- รองรับ keyboard ทั้ง journey, visible focus, zoom 200%, reduce motion และ text alternatives
- Form เก็บ draft locally เฉพาะ non-secret fields; navigation ออกจาก dirty form เตือนตามจริง
- 409/412 แสดง server version diff ให้ reload/reapply; 403/404 ไม่เผยชื่อ resource นอก scope
- Export ไม่มี hidden unauthorized nodes; share preview แสดงสิ่งที่ผู้รับเห็นจริง
- Search/filter/sort ใช้ server scope ก่อน aggregation; totals ไม่นับ linked work ซ้ำ

## 7. Detailed UX/UI supplement

[UX strategy](10-UX-STRATEGY-AND-JOURNEYS.md), [UI system](11-UI-SYSTEM-AND-INTERACTIONS.md) and [wireframes](12-WIREFRAMES-AND-SCREEN-SPECS.md) refine this inventory into 37 screen families and ten journeys. [UX/UI model](contracts/ux-ui.candidate.json) binds 83 fields to existing source or candidate schema. Parent ownership, separate Domain/Feature lenses and navigation-first delivery remain in force.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.5.0b | 2026-09-18 | candidate | Extract PMR-001..033 into one-file proposal requirements and retain UX context in the Site spine | working-tree | RWANG |
| 0.1.0b | 2026-09-15 | candidate | 32 proposal requirements, separate lenses, personas and complete screen journeys | base 087f3025 | RWANG |
| 0.2.0b | 2026-09-16 | candidate | Replace preliminary menu list with scoped navigation refinement and preserve separate Domain/Feature views | base 087f3025 | RWANG |
| 0.3.0b | 2026-09-16 | candidate | Link detailed UX/UI journeys, forms and wireframes | base 087f3025 | RWANG |
| 0.4.0b | 2026-09-16 | candidate | Declare PMR-033 and PMF-11 for employee/team workload, scheduling and performance | source 0f5a47fc; uncommitted | RWANG |
