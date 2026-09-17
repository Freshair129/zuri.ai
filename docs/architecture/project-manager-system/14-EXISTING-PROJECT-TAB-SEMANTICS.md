---
id: ZAI:PM-EXISTING-TAB-SEMANTICS
title: Existing Project tabs and capability preservation
version: "0.2.0b"
status: candidate
created_at: "2026-09-16T02:52:06+07:00,RWANG,source 966304624717e6888dd3447e35bc7662f0ff9e0b"
last_update: "2026-09-16T03:23:25+07:00,RWANG"
superseded_by: null
attributes:
  doc_type: architecture-specification
  domain: project-manager
  scope: Source-based meaning of existing tabs before navigation regrouping
relations:
  - type: references
    target: ZAI:PM-DOMAIN-NAV-BOUNDARIES
  - type: references
    target: ZAI:PM-WIREFRAMES
  - type: references
    target: ZAI:ADR-034
  - type: references
    target: ZAI:FR-077
  - type: references
    target: ZAI:FR-036
  - type: references
    target: ZAI:FR-040
---

# ความหมายของแท็บเดิม ก่อนจัดหมวดเมนูใหม่

**Source audit + candidate correction · C-3 · risk HIGH for subsequent navigation/authority changes.** Documentation only; no product code, Membership, database or runtime changed.

**Requirement added after this audit:** [15 Workforce planning & performance](15-WORKFORCE-CAPACITY-SCHEDULE-AND-PERFORMANCE.md) defines Resources workforce planning/performance at the owner's request. The nine-section audit below records the earlier implementation, not a restriction on the new capability. Additional source inspection at `0f5a47fc` confirms `activeWorkItems` has no status filter; it counts nondeleted assigned work, including completed rows that remain. PMR-033 requires a new explicit open/WIP/accepted breakdown and does not silently change the old API field.

## 1. ข้อที่ต้องแก้จากข้อเสนอรอบก่อน

1. **Inventory ตกหล่นจากตารางหกหมวดล่าสุดจริง** แม้ package รุ่นก่อนมี WF-23 แต่เปลี่ยนชื่อเป็น Project Index และลดรายละเอียดเป็นดัชนีค้นหา ซึ่งไม่ครอบคลุมหน้ารวมข้อมูลปฏิบัติงานเดิม
2. **Risks และ Resources เป็นแท็บที่ประกาศไว้จริง** ใน More การที่ยังไม่สร้างหน้าไม่ใช่เหตุผลให้ลบ capability ออกจากแผน
3. **Resource Coordination เป็นชื่อหมวดที่เราเสนอใหม่ ไม่ได้พิสูจน์ความหมายของแท็บ Resources เดิม** การมี Team/Files/Repositories จึงยังไม่ถือว่ารองรับ Resources แล้ว
4. ต้องตรวจ data, action, permission, state และ child routes ของทุกแท็บ ก่อน rename/move/merge; ไม่ประเมินความครบจากชื่อหมวดอย่างเดียว

[ASSUMPTIONS]

- “ของเดิม” หมายถึง Project tabs ของ zuri-ai ที่เห็นในภาพและ source ปัจจุบัน ไม่ใช่ repository legacy zuri
- รอบนี้ยืนยัน behavior จาก source/contracts และรายการ tests; ไม่อ้างว่าได้เปิดใช้แอป production
- รายละเอียดที่ยังไม่มี implementation เช่น Resources/Risks แยกเป็น candidate design ไม่เติมความหมายย้อนหลังให้ของเดิม

## 2. รายการแท็บเดิมครบ 9 รายการ

หลักฐานหลัก: [ProjectTabs.jsx](../../../apps/server/src/modules/project-manager/components/ProjectTabs.jsx), [project layout][project-layout], [interface inventory §3.7](../../INTERFACE-INVENTORY.md) และ [sitemap §5.1](../../SITEMAP-DOMAIN-NAV.md)

| แท็บเดิม | การใช้งานจาก source ปัจจุบัน | Scope / action boundary | สถานะ |
|---|---|---|---|
| Project | ดูชื่อ/รายละเอียด สถานะ progress แบบถ่วงน้ำหนัก และ Workstreams; มี Edit/Delete และเข้า execution view จาก Workstream | Project lifecycle และ authorized mutations; execution page เป็น child ของ Project tab | SOURCE_PRESENT |
| Inventory | อ่านภาพรวม operational data ของโครงการจาก DTO เดียว แล้วเปิดหน้ารายละเอียดที่เป็นเจ้าของจริง | Project-local read-only composition; ไม่สร้าง inventory table หรือ writer ใหม่ | SOURCE_PRESENT — FR-077 / ADR-034 |
| Team | ดู Membership ใน Business ของโครงการ รวม tenant-wide memberships และจำนวนงานที่มอบหมายใน Project; มีทางเพิ่ม/ถอดสมาชิก | ไม่ใช่ project-only participation model; การให้/ถอนสิทธิ์ผ่าน Identity; role change จริงถูกปฏิเสธให้ไป Permissions | SOURCE_PRESENT — FR-036 / FR-191 |
| Work | เข้า Structure Plan เป็นค่าเริ่มต้น แล้วเปลี่ยนระหว่าง 7 Work views | ใช้ Project/Workstream/WorkContainer/WorkItem และ owner services เดิม | SOURCE_PRESENT — FR-040 และ feature ราย view |
| Files | จัดการไฟล์ Project ผ่าน ManagedFilesPanel ตาม mode/capability ที่รองรับ | metadata และ permitted file operations; local/external/portable storage ไม่เท่ากับ business stock | SOURCE_PRESENT — FR-045 / FR-058 |
| Import | เข้า PlanImportPanel เพื่อ validate → dry-run/conflicts → commit plan | Project target ต้องผ่าน authorization และ import writer เดิม; เป็นหน้าเฉพาะที่เข้าถึงได้โดยตรง | SOURCE_PRESENT — FR-012 / FR-018 |
| Requirements | ประกาศเป็น planned Project section ใน More | disabled button, ไม่มี href หรือ Project page ใน route enumeration รอบนี้; detailed behavior ของแบบใหม่เป็น candidate | PLANNED |
| Risks | ประกาศเป็น planned Project section ใน More | disabled button; ยังไม่มีการทำงานของ risk register ให้ทดลองใน Project routes ที่ตรวจ | PLANNED |
| Resources | ประกาศเป็น planned Project section ใน More | disabled button; label/icon ยังไม่กำหนดชนิด resource, allocation, cost หรือ capacity contract | PLANNED — DETAILS_UNSPECIFIED |

SOURCE_PRESENT หมายถึงมี source path และ contract ที่อ่านยืนยันได้ ไม่ใช่ production validation รายการเก่าใน sitemap ยังแสดงเจ็ดชื่อและ Work สี่ views; source ปัจจุบันมีหกแท็บเปิดหน้าได้ + สาม planned slots และ Work เจ็ด views จึงใช้ source enumeration เป็นฐาน current mapping

```text
Project sections — current source
  Project | Inventory | Team | Work | Files | Import | More
                                                       ├─ Requirements — Planned
                                                       ├─ Risks        — Planned
                                                       └─ Resources    — Planned

Work views — default: Structure Plan
  Execution Roadmap | Structure Plan | Board | Work Items
  Schedule | Milestones | Dependency Map
```

## 3. Inventory ทำอะไรจริง

อ้าง [ADR-034](../../decisions/ADR-034-PROJECT-INVENTORY-READ-MODEL.md), [FR-077](../../domains/project-manager/features/FR-077-project-inventory-mvp.md), [หน้า Inventory][inventory-page], [read model](../../../apps/server/src/modules/project-manager/application/project-inventory-read-model.js) และ [GET route](../../../apps/server/src/app/api/projects/[id]/inventory/route.js)

คำถามที่หน้านี้ตอบคือ **“โครงการนี้ประกอบด้วยอะไร มีข้อมูลและหลักฐานอะไรแล้ว และติดเงื่อนไขใดอยู่”** หน้า Project เดิมเน้น lifecycle/Workstreams ส่วน Inventory รวมรายละเอียดข้ามส่วนแบบอ่านอย่างเดียว ทั้งสองจึงมีหน้าที่ต่างกัน

| ส่วนข้อมูล | สิ่งที่ผู้ใช้เห็น/ใช้ | ข้อจำกัดที่ต้องรักษา |
|---|---|---|
| Project identity | Project, Business owner, Workspace/Space context | resource identity ไม่ให้สิทธิ์เพิ่ม |
| Work | Workstreams, Work Containers และ WorkItems ใน DTO; หน้าปัจจุบันแสดง previews ของ Workstreams/WorkItems | Work Containers ไม่ควรถูกอ้างว่าเป็น card แยกใน UI หากหน้าไม่ได้ render |
| Milestones & Gates | เป้าหมายเวลา สถานะ gates และจำนวน required gates ที่ยังเปิด | อ่านผ่าน source เดิม; การแก้ evidence ไปหน้าที่อนุญาต |
| Dependencies | สรุป dependency และลิงก์เปิด map | ทั้งสอง endpoints ต้องอยู่ใน Project |
| Files | metadata ของ ProjectFile และ FileAsset | ไม่คืน binary หรือ absolute filesystem roots |
| Repositories | ProjectRepository links | เปิด Linked repositories เพื่อจัดการ metadata/link/unlink |
| Team | scoped Membership rows และ assignment counts | การเห็นสมาชิกไม่เท่ากับ capacity plan หรือสิทธิ์แก้ Membership |
| Progress evidence | strategy-based roll-up, formula และ warnings | GET ไม่เขียน progressCache และไม่ใช้ task ratio เป็น universal progress |
| Recent activity | AuditEvent ที่จำกัดตาม Project closure | action/entity/time แบบ redacted; ไม่ส่ง raw payload |

Response ใช้ `readModel: PROJECT_INVENTORY`, schema version `1.0` มี section status/pagination/truncation และแยก error/empty/unavailable ผู้ใช้เห็น KPI และ previews พร้อมทางไป Work, Dependencies, Files, Repositories และ Team การตัดรายการใน card ต้องบอกจำนวนที่แสดงจริง

**คงชื่อแท็บ Inventory และชื่อหน้า Project Inventory ในข้อเสนอที่แก้แล้ว** ไม่เปลี่ยนเป็น Project Index, ไม่รวมกับ SCM Inventory และไม่ถือว่า Agent Inventory/Fleet Inventory ทดแทนได้

## 4. Risks / Resources / Team ต้องแยกความหมาย

### Risks

[ProjectTabs](../../../apps/server/src/modules/project-manager/components/ProjectTabs.jsx) ประกาศ `risks` ใน PLANNED และ [FR-040](../../domains/project-manager/features/FR-040-project-work-views.md) ระบุ Risks อยู่นอก slice นั้น ไม่มี evidence ว่า probability/impact scoring, issue register หรือ mitigation workflow ใน WF-26 เป็น behavior ที่ของเดิมทำแล้ว สิ่งเหล่านั้นเป็นรายละเอียดที่เราเสนอเพิ่ม ต้องแยก review จากการรักษาชื่อ Risks

### Resources

Source ยืนยันชื่อ `resources` และสถานะ planned เท่านั้น จาก Project route/API enumeration และเอกสารที่ตรวจ ยังไม่ได้รายละเอียดที่ยืนยันว่า Resources เดิมหมายถึงคน, เวลา, เครื่องมือ, asset, งบประมาณ หรือทั้งหมด

WF-25 “Resources & Budget” เสนอ capacity/allocation/cost ขึ้นใหม่ จึงยังอ้างว่าเท่ากับ Resources เดิมไม่ได้ ต้องรักษา **Resources เป็น capability แยก** และยืนยันชนิด resource, available/allocated/used, ช่วงเวลา, หน่วย, owner, conflict rules และ authority ก่อนสร้าง contract/CRUD การมี Files หรือ Repositories ไม่ได้ตอบคำถามเหล่านี้

### Team

[Team page][team-page] และ [service](../../../apps/server/src/modules/project-manager/application/project-team-service.js) อ่าน Business/Tenant Membership ในบริบท Project และนับ WorkItems ที่อ้าง person เป็น assignee ส่วนจำนวนงานนี้ยังไม่ใช่ effort hours, availability หรือ utilization

- Add ใช้ Identity `grantBusinessMembership`; ไม่ใช่การเพิ่มชื่อเข้า ProjectTeam เฉย ๆ
- Remove ใช้ Identity `revokeMembership` สำหรับ exact Business membership ที่อนุญาต; ไม่ใช่ถอนจาก Project อย่างเดียว
- UI ยังมี role selector แต่ service คืน `ROLE_CHANGE_MOVED_TO_PERMISSIONS` เมื่อเปลี่ยน role จริง; อย่าออกแบบ wireframe โดยอ้าง selector นี้ว่าเปลี่ยน role ได้สำเร็จ
- Tenant-wide memberships ไม่ mutable จาก Project นี้

ความต่างระหว่าง UI control กับ service refusal เป็นข้อค้นพบเพื่อแก้ spec/handoff ให้ตรง source รอบนี้ไม่แก้ behavior หรือ authorization การย้ายเมนูต้องคง scope warning และ Identity authority

## 5. Route crosswalk ครบ 14 หน้า

ทุก suffix ต่อจาก `/projects/{projectId}`; base row คือหน้า Project เอง ตารางนี้เป็น current behavior เพื่อป้องกันการตกหล่น ไม่ใช่การประกาศ URL ใหม่

| Existing route suffix | Current selected section | หน้าที่ที่ต้องรักษา |
|---|---|---|
| base | Project | Project overview/lifecycle/Workstreams |
| `/execution/{mode}` | Project | execution mode ที่เปิดจาก Workstream; ไม่ใช่หนึ่งใน WorkViewTabs |
| `/inventory` | Inventory | bounded operational read surface |
| `/repositories` | Inventory | Linked repositories ที่เข้าได้จาก Inventory |
| `/team` | Team | Membership/assignment context และ Identity boundary |
| `/files` | Files | managed Project files |
| `/import` | Import | intake preview/commit page |
| `/roadmap` | Work | Execution Roadmap: outcomes, goals, hierarchy, progress, blockers, dependencies, closure gates |
| `/structure` | Work | WBS Project → Workstream → Container → WorkItem; default Work entry |
| `/board` | Work | Project work board |
| `/all-work` | Work | Project-filtered work list/status actions |
| `/timeline` | Work | Project Schedule |
| `/milestones` | Work | Project Milestones & Gates |
| `/dependencies` | Work | Project-contained Dependency Map |

Risk, Resources, Requirements มี planned slots แต่ไม่มี route ให้ใส่ใน 14-row crosswalk นี้ จึงต้องนับ coverage สองอย่างแยกกัน: **14 existing routes** และ **9 declared sections**

## 6. Correction ต่อ target navigation และ wireframes

| ของเดิม | การรักษาใน candidate ที่แก้ | ห้ามถือว่าทดแทนกันแล้ว |
|---|---|---|
| Project | Project Management → Project/Overview | Inventory ไม่แทน Project lifecycle |
| Inventory | Project Management → Inventory; WF-23 คืนชื่อ Project Inventory และรายละเอียด read surface | Project Index, SCM stock, generic Resources, Agent/Fleet Inventory |
| Team | entry แยกใน Resource Coordination; WF-20 ต้องบอก Business Membership scope | capacity allocation / project participation |
| Work | Work Management ต้องเก็บเจ็ด views; default Structure Plan คงไว้จนมี amendment | generic List/Board อย่างเดียวไม่ครบ |
| Files | entry แยก; writer/storage contract เดิม | Resource planning |
| Import | คงหน้า/ทางเข้าเฉพาะ; การเพิ่ม toolbar action ไม่ทำให้ route หาย | generic create dialog |
| Requirements | Delivery Design → Requirements, Planned จน slice พร้อม | Docs browser อย่างเดียว |
| Risks | Delivery Governance → Risks, Planned; WF-26 เป็น design เพิ่ม | Milestones/Gates หรือ issue tracker โดยไม่มี risk spec |
| Resources | Resource Coordination → Resources, Planned/รายละเอียดต้องยืนยัน; WF-25 เป็น design เพิ่ม | Team/Files/Repositories หรือ Budget อย่างเดียว |

การจัดกลุ่มหก modules ยังเป็น candidate ห้ามใช้ตารางกลุ่มเพื่อย้ายเจ้าของปัจจุบันโดยปริยาย โดยเฉพาะ `/milestones` ยังเป็น Work view และ `/execution/{mode}` ยัง selected Project การเพิ่ม Governance shortcut เป็น link ไป owner route ได้ แต่ไม่สร้าง route/writer ซ้ำ

`navigation.candidate.json` และ `ux-ui.candidate.json` ยังเป็น snapshot รุ่นก่อน: `p.index`, WF-23 title และ WF-20/25/26 semantics ต้อง reconcile กับเอกสารนี้ก่อน code generation การแก้เอกสาร screen specs ไม่ใช่การอ้างว่า interactive 37-screen gallery remap เสร็จแล้ว

## 7. Evidence, verification และลำดับก่อน implementation

**Source inspected:** `966304624717e6888dd3447e35bc7662f0ff9e0b`, 2026-09-16 Asia/Bangkok เทียบกับ design base `087f3025` ใน Project pages/APIs, PM source และ focused test files: ต่างเฉพาะ `backup-service.js` ใน PM source enumeration ซึ่งไม่ได้ใช้ตัดสิน tab semantics นี้

**หลักฐานที่อ่าน:** page/components → API route → service/read model → ADR/feature note → existing tests ครบสำหรับ Inventory/Team/Work; Files/Import/Project ตรวจ page/component entry และ interface contracts ไม่อ้างว่าตรวจทุก mutation path ของทั้งระบบ

**Existing unit-test attempt:** six focused files were requested through the repository test wrapper. The run stopped before loading vitest.config.js with sandbox/esbuild `Access is denied`; zero tests ran, so it is NOT_RUN, not PASS. The worktree uses shared dependencies whose normal global setup may regenerate a Prisma client; no retry that mutates the shared primary dependency tree was made. Documentation/source checks are recorded separately from product tests.

**Acceptance for the next design revision:**

1. Nine declared sections accounted for by stable identity, meaning, status and destination; no orphan Inventory/Risks/Resources
2. Fourteen route templates and seven Work views mapped; deep links, active states and default entry explicitly preserved or amended
3. Inventory stays read-only with scoped section envelopes/progress/evidence; detailed writers remain with owners
4. Team authority remains Business/Identity; Resources spec cannot inherit membership permissions by navigation grouping
5. Requirements/Risks/Resources remain visibly planned until their own contracts and behavior are implemented and verified
6. Candidate-only fields in WF-25/26 are not presented as recovered requirements from the original tabs

เริ่มจาก semantic audit นี้ → ปรับ mapping/UX model → ทบทวน wireframes ทั้ง context → อนุมัติเอกสาร implementation ตาม R5 → code การวางเมนูใหม่ต้องผ่านรายการนี้ก่อน ไม่เริ่มจากชื่อหมวดแล้วค่อยเดาความหมายของสิ่งที่ต้องใส่

[project-layout]: <../../../apps/server/src/app/(pm)/projects/[projectId]/layout.jsx>
[inventory-page]: <../../../apps/server/src/app/(pm)/projects/[projectId]/inventory/page.jsx>
[team-page]: <../../../apps/server/src/app/(pm)/projects/[projectId]/team/page.jsx>

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-16 | candidate | Source audit of nine Project sections, fourteen routes, Inventory semantics, planned Risks/Resources and Business Membership boundary | source 96630462; uncommitted | RWANG |
| 0.2.0b | 2026-09-16 | candidate | Preserve old-tab source audit and link new owner workforce scope; clarify count status predicate | source 0f5a47fc; uncommitted | RWANG |
