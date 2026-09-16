---
id: ZAI:PM-SYSTEM-DESIGN
title: Project Manager complete system design
version: "0.11.0b"
status: candidate
created_at: "2026-09-15T23:49:58+07:00,RWANG,base 087f30258a6831865afd751e28804e36505aff30"
last_update: "2026-09-17T00:32:00+07:00,RWANG"
superseded_by: null
attributes:
  doc_type: architecture-specification
  domain: project-manager
  scope: Cross-domain project delivery and governed agent execution
relations:
  - type: references
    target: ZAI:ADR-025
  - type: references
    target: ZAI:ADR-026
  - type: references
    target: ZAI:ADR-076
  - type: references
    target: ZAI:ADR-081
  - type: references
    target: ZAI:FR-019
---

# Project Manager — Full System Design

**Version:** 0.11.0b · **Status:** Candidate · **Risk:** HIGH · **Complexity:** C-3
**Evidence baseline:** original design `087f30258a6831865afd751e28804e36505aff30`; MA-I02 source audit `138db6630e650e3c695b81158eff3cecdad6d0a5`.
**Deliverable:** เอกสารออกแบบและสัญญาแบบเครื่องอ่านได้; navigation FR-250 ส่งมอบแล้ว ส่วน Domain View Phase A ในเอกสาร 23 ได้รับอนุมัติ ลงทะเบียน FR-251 และผ่าน local server/build/browser/governance แล้ว; ติดตาม hosted CI และ release แยกใน PR443 ส่วน Feature Phase B ยังเป็นข้อเสนอ ไม่มี production activation จาก packet ใหม่นี้

**Spec completeness:** [16 Spec readiness & API reference](16-SPEC-READINESS-AND-API-REFERENCE.md) ตรวจไฟล์จริงแล้ว: มี contracts / API schemas / OpenAPI references และเพิ่ม Swagger UI ใน local review แต่ยังต้องปิด SPEC-G01–G09 ก่อน spec-to-code. 132 schema definitions เป็น API/JSON shapes ไม่ใช่ตารางฐานข้อมูล; ห้ามตีความ structural validation ว่า implementation-ready.

ชุดเอกสารประกอบด้วย 24 Markdown documents, 30 diagrams, 33 requirements/acceptance families และ OpenAPI candidates 80 operations (72 original + 8 workforce) พร้อม workflow schema/example, architecture/traceability, navigation และ UX/UI models; UX/UI supplement มี 37 screen families, 10 journeys, 13 forms / 83 fields และ 14 UI acceptance scenarios; เพิ่ม semantic audit ของ 9 Project sections, 14 routes และ 7 Work views ก่อนจัดเมนูใหม่

**ตรวจแท็บเดิมก่อนจัดหมวด:** [14 Existing tab semantics](14-EXISTING-PROJECT-TAB-SEMANTICS.md) คืน Inventory ที่หลุดจากตาราง และรักษา Risks/Resources เป็น planned capabilities แยก; Resource Coordination ไม่ได้ทดแทน Resources และ Team เดิมเกี่ยวข้องกับ Business Membership

**อ่านข้อสรุปล่าสุดก่อน:** [13 Domain placement & navigation boundaries](13-DOMAIN-TAXONOMY-AND-NAVIGATION-BOUNDARIES.md) — ตามคำชี้แจงของเจ้าของ ให้ Top bar = Domain, Sidebar = subdomain/module, Tabs = views/sections และ Business Home = shortcuts ข้าม Domain เสนอชื่อ Projects & Work แทน Development โดยคง key เดิม

**Navigation delivery state:** [22 Core navigation baseline](22-NAVIGATION-IMPLEMENTATION-BASELINE.md) defines six logical sidebar modules and module-local tabs. Import is one shared Project action. [ADR-096](../../decisions/ADR-096-PROJECTS-AND-WORK-HIERARCHICAL-NAVIGATION.md) and [FR-250](../../domains/project-manager/features/FR-250-hierarchical-project-navigation.md) were approved and delivered in PR435 (`e8fc84bd`). Deferred screen families retain explicitly historical, non-generatable bindings; this does not implement or approve all 37 screens.

**Project / Domain / Feature Phase A packet:** [23 Project, Domain and Feature implementation baseline](23-PROJECT-DOMAIN-FEATURE-IMPLEMENTATION-BASELINE.md) is `0.4.0b`: Phase A is owner-approved on baseline `7465080f` and registered as FR-251, with the Domain-view response and redacted 401/404 refusal contract implemented. A2 governance passed with 0 critical findings and 2 existing warnings before worker code. The [FR-251 delivery note](../../domains/project-manager/features/FR-251-project-execution-domains.md) records local verification and separate hosted/release gates. Phase B Feature authority, persistence, CSRF and migration remain deferred and unapproved.

**ส่วนเพิ่มล่าสุด:** [UX strategy](10-UX-STRATEGY-AND-JOURNEYS.md) → [UI system](11-UI-SYSTEM-AND-INTERACTIONS.md) → [37 wireframes / screen specs](12-WIREFRAMES-AND-SCREEN-SPECS.md). เป็นส่วนต่อยอดจากผังเมนู v0.2.0b; application code ยังไม่เปลี่ยน

**Requirement เพิ่มจากเจ้าของ:** [15 Workforce planning & performance](15-WORKFORCE-CAPACITY-SCHEDULE-AND-PERFORMANCE.md) — จำนวนงานต้องเชื่อม effort/calendar เพื่อสรุปกำลังคนและตารางงานรายคน/ทีม พร้อม performance 12 เมตริกและ 16 acceptance cases. เพิ่ม WF-R01–06 อีก 6 screen families; gallery เดิมยังเป็น historical navigation candidate; JSON แยก core bindings ที่ reconcile แล้วกับ deferred bindings ที่ยังห้าม generate.

Resources มี 4 views ที่เสนอ: Overview / Workload / Schedule / Performance. การกำหนด scope ครั้งนี้เป็น requirement ใหม่ ไม่เปลี่ยน source audit ว่า Resources เดิมยังเป็น Planned.


**SRS / Tables / Blueprint:** [17 SRS](17-SRS.md) รวม 33 requirement families และ use cases; [18 Tables & ERD](18-DATABASE-TABLES-AND-ERD.md) แยก 31 existing models กับ 54 proposed logical records พร้อม field dictionary และ ERD 9 มุมมอง; [19 System Blueprint](19-SYSTEM-BLUEPRINT.md) มี 5 architecture/runtime diagrams และ machine-readable models. จำนวน record ไม่ใช่จำนวนตารางใหม่ที่อนุมัติให้สร้าง; implementation readiness ยังติด SPEC-G01–G09.

**Multi-agent delivery:** [20 Delivery plan](20-MULTI-AGENT-DELIVERY-PLAN.md) กำหนด Luna Max workers 2 ตัว, independent Luna Max verifier 1 ตัว และ root เป็น final gate/integrator; แยก core NAV กับ Workforce bindings และ release ของ Workforce จาก Fleet. Core NAV ส่งมอบใน FR-250 แล้ว และ MA-I02 Phase A ถูก dispatch ตาม approval เป็น FR-251; ผล gate ล่าสุดอยู่ใน feature note ของแต่ละ requirement. Phase B, Workforce และ Fleet ยังต้องผ่าน gate ของตนเอง.

## 1. เป้าหมาย

Project Manager เป็นศูนย์กลางที่เชื่อม **เป้าหมายธุรกิจ → Domain → Feature → Requirement → Architecture/API → แผนงาน → Human/Agent/Fleet execution → หลักฐานทดสอบ → Release** ผู้ใช้เห็นข้อมูลเดียวกันผ่านหลายมุมมอง และย้อนจากผลลัพธ์ไปหาข้อกำหนดต้นทางได้

Domain และ Feature เป็นคนละแกน:

- **Domain:** ขอบเขตความรับผิดชอบและเจ้าของข้อมูล/contract เช่น project-manager, integration, identity
- **Feature:** ความสามารถที่ผู้ใช้ได้รับ เช่น Provider Registry ซึ่งต้องร่วมงานระหว่าง integration และ identity
- **Workstream:** แผนปฏิบัติการภายใต้ Project; ไม่ใช่ Domain หรือ Feature
- **Agent/Fleet:** ผู้ปฏิบัติงานและรูปแบบการร่วมงาน; ชื่อหรือการเป็นสมาชิกไม่ให้สิทธิ์เขียนข้อมูล

## 2. Assumptions และขอบเขต

[ASSUMPTIONS]

1. ออกแบบต่อยอด **zuri-ai ใน monorepo นี้** โดยรักษา Project Manager เดิมและเจ็ด execution modes
2. Agent inventory รองรับ agent ที่ส่งมอบงานโครงการ และ adapter ที่เรียก business automation; แยก execution profile/authority ของสองประเภทอย่างชัดเจน
3. Cloud, self-host และ Edge ใช้ control plane เดียวกันได้เมื่อผ่าน authentication และ capability checks; ไม่มีข้อสมมติว่าทุก host เปิด inbound port ได้
4. การแชร์ผลลัพธ์เป็นสิทธิ์ระดับ artifact แบบหมดอายุ/เพิกถอนได้ ค่าเริ่มต้น private; ไม่เผยแพร่ code, secrets หรือ Business data โดยอัตโนมัติ
5. ตัวเลข SLO, retention และ limits ในชุดนี้เป็น **ค่าที่เสนอเพื่ออนุมัติ** ไม่ใช่ SLA ที่ระบบปัจจุบันรับประกัน

เลือกใช้ modular monolith + durable worker adapter ตามขอบเขตปัจจุบัน ไม่บังคับย้ายเป็น microservices และไม่ย้าย MSP/GKS/GenesisBlockDB มาเป็นฐานข้อมูลของ PM

## 3. อ่านเอกสารตามลำดับ

| เอกสาร | ตอบคำถาม |
|---|---|
| [01 Requirements & UX](01-REQUIREMENTS-AND-UX.md) | ใครใช้ ทำอะไร หน้าจอและเกณฑ์รับงานเป็นอย่างไร |
| [02 Decisions & Diagrams](02-DECISIONS-AND-DIAGRAMS.md) | ใครเป็นเจ้าของ แต่ละ node/edge หมายถึงอะไร |
| [03 Data & Events](03-DATA-AND-EVENTS.md) | ตัวตน ความสัมพันธ์ ธุรกรรม version และเหตุการณ์ |
| [04 Agents & Fleets](04-AGENTS-AND-FLEETS.md) | ตั้งค่า agent/fleet, queue, approval, run และ recovery |
| [05 Providers & MCP](05-PROVIDERS-AND-MCP.md) | Cloud/local/self-host, model routing, keys, MCP และ budgets |
| [06 APIs & Contracts](06-API-AND-CONTRACTS.md) | Endpoint, error, auth, Swagger และ compatibility |
| [07 Delivery & Verification](07-DELIVERY-AND-VERIFICATION.md) | DDD → diagram → spec → code, traceability, phases และ tests |
| [08 Evidence & Review](08-EVIDENCE-AND-REVIEW.md) | สิ่งที่ตรวจจริง ข้อจำกัด ผลตรวจ และรายการอนุมัติ |
| [09 Navigation refinement](09-NAVIGATION-REFINEMENT.md) | เมนูเดิมไปอยู่ตรงไหน; sidebar ตาม scope; full feature map และลำดับทำเมนูก่อน |
| [10 UX strategy & journeys](10-UX-STRATEGY-AND-JOURNEYS.md) | Business/UX goals, personas, ten journeys and usability plan |
| [11 UI system & interactions](11-UI-SYSTEM-AND-INTERACTIONS.md) | Tokens, forms, validation, responsive/accessibility and UI acceptance |
| [12 Wireframes & screen specs](12-WIREFRAMES-AND-SCREEN-SPECS.md) | 37 screens, 13 form inventories, exceptions and implementation handoff |
| [13 Domain placement & navigation boundaries](13-DOMAIN-TAXONOMY-AND-NAVIGATION-BOUNDARIES.md) | Current recommendation: ERP/PM comparison, Domain → module → tabs, Business Home shortcuts and shared ownership |
| [14 Existing Project tab semantics](14-EXISTING-PROJECT-TAB-SEMANTICS.md) | Meaning, source behavior, planned sections and complete 9-section / 14-route retention mapping |
| [15 Workforce planning & performance](15-WORKFORCE-CAPACITY-SCHEDULE-AND-PERFORMANCE.md) | Human workload/capacity/scheduling/performance, source gaps, formulas, six wireframes and PMR-033 phases |
| [Workforce OpenAPI](contracts/workforce.openapi.candidate.yaml) | Eight proposed operations and typed workforce input/output contracts |
| [Workforce examples](contracts/workforce.examples.json) | Synthetic capacity and on-time metric fixtures, never employee data |
| [16 Spec readiness & API reference](16-SPEC-READINESS-AND-API-REFERENCE.md) | File inventory, API reference, Swagger viewer and nine implementation-blocking gaps |
| [17 SRS](17-SRS.md) | Consolidated behaviors, 10 use cases, interfaces, rules, nonfunctional and acceptance criteria |
| [18 Tables & ERD](18-DATABASE-TABLES-AND-ERD.md) | Existing/proposed records, field-level types/keys/invariants, nine ERDs and migration design |
| [19 System Blueprint](19-SYSTEM-BLUEPRINT.md) | Domain components, deployment boundaries, transactions, execution sequences and implementation handoff |
| [20 Multi-agent delivery](20-MULTI-AGENT-DELIVERY-PLAN.md) | Work packages, ownership, dependencies, exact-revision gates and first dispatch wave |
| [21 Contract foundation](21-CONTRACT-FOUNDATION.md) | One human allocation writer, typed identities, receipt/error/idempotency and remaining CSRF owner binding |
| [22 Navigation implementation baseline](22-NAVIGATION-IMPLEMENTATION-BASELINE.md) | Six modules, retained 8/9/14/7 source semantics, current core bindings and deferred scope |
| [Contract examples](contracts/contract-foundation.examples.json) | Positive and negative schema examples; not service tests |
| [Navigation conformance](contracts/nav-conformance.fixtures.json) | Machine-readable documentation invariants; not browser implementation evidence |
| [Delivery plan index](contracts/delivery-plan.candidate.json) | Non-executable planning data, model policy and ordered work packages |
| [Data model](contracts/data-model.candidate.json) | Machine-readable record/field/relationship catalog |
| [Blueprint model](contracts/blueprint.candidate.json) | Supplemental typed nodes/edges and owner ports |
| [SRS trace model](contracts/srs-traceability.candidate.json) | PMR to entity, blueprint node, operation and acceptance family |
| [UX/UI model](contracts/ux-ui.candidate.json) | Screen → navigation → PMR → field/schema mapping |
| [OpenAPI candidate](contracts/openapi.candidate.yaml) | HTTP contract ของส่วนเพิ่มที่เสนอ |
| [Workflow schema](contracts/workflow.schema.json) | โครงสร้าง workflow แบบข้อมูล ตรวจได้ก่อน dispatch |
| [Workflow example](contracts/workflow.example.json) | ตัวอย่างหลาย Domain: spec → implementation → verification |
| [Architecture model](contracts/architecture.model.json) | node/edge พร้อมชนิด ทิศทาง owner และ contract |
| [Traceability](contracts/traceability.json) | รหัส requirement → capability → owner → contract → test → phase |
| [Navigation model](contracts/navigation.candidate.json) | destination → scope → route → readiness → implementation slice |

## 4. สิ่งที่มีอยู่และแนวทางต่อยอด

| พื้นฐานที่ตรวจพบใน snapshot | ใช้ต่ออย่างไร | ส่วนเพิ่มในข้อเสนอ |
|---|---|---|
| Project, Workstream, WorkItem, Gate, Dependency; PM application services | รักษา writer และ progress calculators เดิม | Domain/Feature lenses, baseline/change control, resource/risk links |
| PlanEnvelope และ ExecutionPlanBundle | ทุก intake เข้าท่อ validate → preview → commit → audit | นำเข้า design bundle และ agent planning โดยไม่มี executable payload |
| FR-070 stable identity / execution trace vocabulary | แยก plan IDs และ run/attempt IDs | revision-pinned trace และ project-run association |
| FR-019 Zod-generated `GET /api/docs` | รักษา schema เป็น authority | Visual Swagger, operation-to-feature links และ spec drift gate |
| IntegrationProvider/Connection/Credential และ SecretStorePort | ใช้ metadata/secret lifecycle เดิม | model deployments, MCP bindings, gateway client keys และ routing policy |
| Integration-owned PipelineRun/Step/EventReceipt ledger | ใช้ lifecycle ledger ผ่าน port ของ integration | PM workflow definition profile, queue/lease/fencing และ step attempts |
| ADR-026 domain desks / shallow orchestration | ใช้ Domain ownership และหนึ่ง active writer ต่อ lane | durable inventory, fleet versions, command center และ executor protocol |
| AgentTraceEvent, Context Composer และ provider adapters | เรียก business-agent capability ผ่าน adapter | ไม่เปลี่ยน LINE turn เป็น fleet supervisor |
| Platform Control programme/usage และ harness pairing | ใช้เป็นหลักฐาน integration ที่มีอยู่ | PM-specific run projection; harness report key ยังรายงานได้อย่างเดียว |

คำว่า “มีอยู่” หมายถึงมีไฟล์/โมเดล/contract ใน snapshot ไม่ยืนยันว่า deployed หรือผ่านการทดสอบ live ในรอบนี้ รายละเอียดอยู่ใน Evidence & Review

## 5. ชุดความสามารถ

| Proposal capability | ชื่อ | Primary owner |
|---|---|---|
| PMF-01 | Planning + Domain/Feature views | project-manager |
| PMF-02 | Architecture graph + design baseline | project-manager |
| PMF-03 | Visual API explorer | project-manager |
| PMF-04 | Agent inventory | project-manager |
| PMF-05 | Fleet inventory | project-manager |
| PMF-06 | Command center + controlled execution | integration; PM owns UI/definitions |
| PMF-07 | Provider/model/MCP registry + inference gateway | integration |
| PMF-08 | Authority, review, traceability and evidence | identity; PM owns document links |
| PMF-09 | Collaboration, retrieval, notifications and sharing | project-manager |
| PMF-10 | Delivery, evaluation and operations | project-manager; adapters owned by peers |
| PMF-11 | Workforce planning & performance | project-manager; people module and Identity/CRM ports |

`PMF-*`, `PMR-*`, `PMD-*`, `PMT-*` เป็นรหัสภายใน **proposal นี้เท่านั้น** ไม่ใช่ FEAT/FR/ADR/SEC/NFR ใน canonical registry และไม่ใช้เป็น `@req` ใน implementation

ก่อนเริ่ม code: อนุมัติชุดเอกสาร → reconcile ล่าสุด → จดทะเบียน FR/FEAT/ADR/SDD/SEC/NFR ที่ยังขาดด้วย tooling/ledger → ทำ mapping ที่ย้อนกลับได้ ห้ามใช้ FR เดิมแทน requirement ใหม่เพียงเพราะชื่อคล้ายกัน

## 6. Success / acceptance / exit

- มี acceptance criteria ครบทุก requirement ที่ผู้ใช้ระบุและส่วนรองรับจำเป็น
- ทุก capability มี primary owner; cross-domain mutation ผ่าน contract ของเจ้าของ
- Diagram, schema, endpoint, execution state และ test scenario อ้างกันได้ ไม่มี edge ไร้ความหมาย
- Run ผูกกับ approved immutable versions และ scope; inventory/fleet membership ไม่ขยายสิทธิ์
- Cloud/self-host inference และ MCP มี contract คนละประเภท พร้อม key/egress/budget policy
- ตรวจ document graph, local links, schemas, OpenAPI refs และ traceability; รายงานข้อจำกัดตามจริง
- จบระยะนี้ที่ **candidate documentation review**; โค้ด, migrations, deployment และ public sharing เป็น gates แยก

## 7. Version diff — 0.1.0b → 0.2.0b

| 0.1.0b | 0.2.0b |
|---|---|
| แสดงรายการเมนูใหม่ แต่ยังไม่จัดการ sidebar และ ProjectTabs เดิม | เสนอ contextual sidebar และ Work sub-view row พร้อม amendment ต่อ parent navigation contract |
| ผังรวมยังไม่บอกตำแหน่งหน้าเดิมครบ | Mapping 8 Business destinations / 14 project page templates; Import เป็น header action; Project Index และ Repositories ชัดเจน |
| P0 registration → P1 feature delivery | NAV-P0/NAV-P1 ทำเมนูเดิมก่อน แล้วจึงเพิ่มความสามารถตาม P1–P7 |
| 9 docs / 8 diagrams / 5 machine-readable contracts | 10 docs / 9 diagrams / 6 machine-readable contracts plus separate RCA; previous API/run contracts retain version 0.1.0b |
| Candidate, no implementation approval | Candidate; menu approval and full-system approval remain explicitly scoped |

## 8. Version diff — 0.2.0b → 0.3.0b

| 0.2.0b | 0.3.0b |
|---|---|
| Navigation proposal and menu prototype | Add UX strategy, UI system and 37 detailed wireframe families |
| 10 docs / 9 diagrams / 6 contracts | 13 docs / 11 diagrams / 7 contracts; plus navigation and artifact RCA records |
| Broad form/interaction guidance | 13 forms / 83 schema-bound fields, states, accessibility and 14 UI acceptance scenarios |
| Navigation scope only | User journeys and contract-aware screen handoff; Business policy administration remains gated on owner contract |

## 9. Version diff — 0.3.0b → 0.4.0b

| 0.3.0b | 0.4.0b |
|---|---|
| Project sidebar replaces project tabs | Withdraw this recommendation; retain Domain → module → local tabs |
| Development label retained | Propose Projects & Work; current key/IDs and grants retained |
| 13 docs / 11 diagrams | 14 docs / 13 diagrams; add ERP and seven-product comparison |
| Old navigation model eligible for review | Hold implementation input until models, wireframes and route mappings reconcile |

## 10. Version diff — 0.4.0b → 0.5.0b

| 0.4.0b | 0.5.0b |
|---|---|
| Inventory omitted from the six-module summary | Restore Project Inventory explicitly; preserve operational read semantics |
| Risks/Resources hidden by broad grouping | Preserve both named planned capabilities and mark detailed behavior unconfirmed |
| Team treated broadly as project resources | Record Business Membership authority and current role-change refusal |
| Generic work-view examples | Preserve all seven existing Work views and fourteen route templates |

## 11. Version diff — 0.5.0b → 0.6.0b

| Before | After |
|---|---|
| Resources details unconfirmed from old tab | Owner-requested workforce requirement PMR-033 with four views |
| Assigned count without hours or history | Effort/calendar/assignment history and explicit source coverage |
| Generic Resources & Budget wireframe | Six workforce wireframes, twelve metrics, sixteen acceptance cases |
| Human resources bundled after Fleet | Independent ordered PMR-033-P1–P5 delivery |

## 12. Version diff — 0.6.0b → 0.6.1b

- Add actual local Swagger UI over the two candidate contracts and an explicit completeness audit.
- Clarify API schemas versus DB schema/migrations, and record SPEC-G01–G09 before code generation.
- No new functional requirement, API operation, runtime behavior or application file change.

## 13. Version diff — 0.6.1b → 0.7.0b

| Before | After |
|---|---|
| Distributed requirement/design prose | Dedicated SRS with 33 requirements, 10 use cases, interfaces and acceptance |
| Aggregate-level dictionary and one overview ERD | 85 records (31 source / 54 proposed), full scalar field dictionary and nine focused ERDs |
| G01 target architecture | Supplemental 18-node / 27-edge blueprint, deployment and two transaction/execution sequences |
| Two OpenAPI candidates and 9 gaps | Same API definitions; persistence/result designs expanded, unresolved contract/migration gates remain visible |
| 17 docs / 14 diagrams / 9 machine contracts | 20 docs / 28 diagrams / 12 machine contracts |

## 14. Version diff — 0.7.0b → 0.8.0b

- เพิ่มแผนงาน 29 work packages: 10 design/control, 18 implementation และ 1 independent Workforce release gate.
- กำหนด Luna Max workers → independent Luna Max verification → root final review → composed integration.
- เพิ่ม directed flow 2 ผัง และ planning JSON; 21 docs / 30 diagrams / 13 machine contracts.
- 33 PMR, 80 API operations และ SPEC-G01–G09 เดิมไม่เปลี่ยน; product tests ยัง NOT_RUN.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-15 | candidate | Complete Project Manager design proposal and machine-readable contracts | base 087f3025; uncommitted | RWANG |
| 0.2.0b | 2026-09-16 | candidate | Navigation refinement first, current-route coverage, full menu placement, scope amendment and review model | base 087f3025; uncommitted | RWANG |
| 0.3.0b | 2026-09-16 | candidate | Add UX/UI, 37 wireframe families, 10 journeys, field mapping and artifact validation; previous API/run contracts unchanged | base 087f3025; uncommitted | RWANG |
| 0.4.0b | 2026-09-16 | candidate | Correct navigation hierarchy from owner clarification; add current-source and ERP/PM domain-boundary review | source 000b26f1; uncommitted | RWANG |
| 0.5.0b | 2026-09-16 | candidate | Audit every existing Project tab before regrouping; correct Inventory, Resources, Risks and Team meanings | source 96630462; uncommitted | RWANG |
| 0.6.0b | 2026-09-16 | candidate | Add PMR-033 workforce requirement, six screen families, typed API supplement and independent delivery phases | source 0f5a47fc; uncommitted | RWANG |
| 0.6.1b | 2026-09-16 | candidate | Distinguish schema validity from implementation readiness; add real Swagger review and explicit gap audit | design base 087f3025; uncommitted | RWANG |
| 0.7.0b | 2026-09-16 | candidate | Add SRS, 85-record table dictionary, nine ERDs and system blueprint with trace models | design base 087f3025; uncommitted | RWANG |
| 0.8.0b | 2026-09-16 | candidate | Add bounded Luna Max delivery workflow, independent verification and root integration plan | design base 087f3025; uncommitted | RWANG |
| 0.9.0b | 2026-09-16 | candidate | Reconcile allocation/error contracts, hierarchical navigation candidate and bounded document delivery; application code and migrations remain unchanged | design base 087f3025; uncommitted | RWANG |
| 0.10.0b | 2026-09-16 | candidate | Link the MA-I02 Phase A baseline and record the composed Domain-view DTO/refusal contract while retaining pending A1/A2 and deferred Feature status | source 138db663; uncommitted | RWANG |

## Version diff — 0.8.0b → 0.9.0b

| Before | This review |
|---|---|
| Allocation identity/unit and mutation receipts disagreed between candidates | One proposed human allocation writer and composed examples; generic CSRF owner port remains open |
| Core machine navigation retained the withdrawn layout | Six modules with local tabs, one persistent Project Import action, explicit deferred bindings |
| Proposal-local navigation only | Candidate ADR-096 / FR-250 with ledger registration; approval and application implementation pending |
| Planning-only worker packets | Luna Max document workers, independent Luna Max verification and root composition; failed attempts retained in local QA |
| 21 Markdown / 13 contracts | 23 package Markdown / 15 contracts, plus two canonical navigation documents |

Application code, database migration and production activation remain unchanged. Existing-app baseline tests and documentation validation are separate evidence classes.

## Version diff — 0.9.0b → 0.10.0b

| Before | This review |
|---|---|
| Domain / Feature implementation baseline was not linked from the index; the candidate DomainView required non-null snapshot and blocker values | Link document 23 v0.3.0b and compose one existing Domain-view operation with nullable `snapshotId` / `blockerCount`, explicit `UNAVAILABLE` states, Phase A `featureIds: []`, and redacted 401/404 responses |
| Phase A approval state was implicit | A1 owner approval remains pending; A2 canonical registration and governance remain pending; Phase B Feature authority and writes remain deferred |
| 23 package Markdown / 15 contracts; 80 candidate operations / 132 schema definitions | 24 package Markdown / 15 contracts; the operation/schema counts stay 80/132. No new operation or Feature authority; one existing candidate operation and its response contract are revised |

Version diff 0.10.0b → 0.11.0b: record owner approval, canonical FR-251 registration, implementation and local verification of read-only Phase A; Phase B remains unapproved and no production deployment is claimed.
