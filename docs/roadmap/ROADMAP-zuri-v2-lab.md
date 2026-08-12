---
title: "ROADMAP: Zuri v2 Lab — Project Manager"
doc_id: "ROADMAP-ZURI-V2-LAB"
status: "approved"
version: "1.0.0"
updated: "2026-08-12"
owner: "Owen"
source_of_truth: true
live_document: true
---

# ROADMAP: Zuri v2 Lab — Project Manager

สถานะจริงของโปรเจกต์ zuri.ai (https://github.com/Freshair129/zuri.ai) — ไฟล์นี้เป็น
live document ที่ GoVibe Mission Control อ่านตรง (roadmap parser อ่านตารางด้านล่าง
การแก้ช่อง Status เปลี่ยนสิ่งที่ Mission Control แสดงทันที) ทุกแถวอ้างอิงหลักฐานจริง
ใน repo — ไม่มี mock ตามกฎ PRODUCT.md ของ GoVibe

หลักฐาน: `zuri-v2-lab/docs/PRD-SDD-v1.0.md` (FR registry), `.agent/reports/FINAL.md`
(acceptance matrix), `zuri-v2-lab/docs/.preflight-report.json` (doc health)

## Phases

| Phase | Goal | Exit Criteria | Status | Progress |
| --- | --- | --- | --- | --- |
| PHASE-ZV2-MVP | Build offline-first PM MVP (spec phases 00-07) | ACCEPTANCE-CRITERIA all PASS — MVP shipped at 75 Vitest + 20 Playwright; suite now 129 + 28 (FINAL.md addendum) | done | 100 |
| PHASE-ZV2-GOV | 3-layer docs, doc-graph, @req annotations, GoVibe registration | preflight 9 PASS / 0 WARN; candidates in GoVibe .brain/inbound | done | 100 |
| PHASE-ZV2-INTAKE | Intake surfaces: UI wizard, Excel template, Enterprise API, adaptive shell | FR-017..FR-020 implemented + tested through the unified pipeline | done | 100 |
| PHASE-ZV2-DECIDE | Zuri v1 module merge vs Zuri v2 foundation decision | Owner decision recorded per ZURI-INTEGRATION-ASSESSMENT.md | done | 100 |
| PHASE-ZV2-MERGE | ~~Ship PM into Zuri v1 as a module (ADR-002)~~ — **cancelled by ADR-003**: V2 replaces V1, so anything mounted into V1 retires with it | n/a | cancelled | 0 |
| PHASE-V2-REPLACE | V2 replaces V1 by reuse: identity rebuilt, web UI lifted per module, LINE/AI surface on V2-native intake | every tenant cut over · V1 off · no tenant ever owned by two systems | in-progress | 8 |

## Backlog Items

| ID | Parent ID | Type | Title | Priority | Owner | Status | Dependencies | Source Section |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-ZV2-MVP-CORE | PHASE-ZV2-MVP | task | Scope model + project core + 7 execution views + progress engine (FR-001..016) | P0 | Claude | done | - | PRD-SDD 1.3 |
| TASK-ZV2-GOV-DOCS | PHASE-ZV2-GOV | task | PRD-SDD v1.0 + appendices + doc-graph + preflight all green | P0 | Claude | done | TASK-ZV2-MVP-CORE | PRD-SDD 1.6 |
| TASK-FR-017 | PHASE-ZV2-INTAKE | task | UI wizard: start-from-objective, builds envelope into validate/dry-run/commit pipeline | P0 | Claude | done | - | PRD-SDD FR-017 |
| TASK-FR-018 | PHASE-ZV2-INTAKE | task | Excel template generator (from Zod schema) + xlsx-to-envelope converter with per-row errors | P1 | Claude | done | TASK-FR-017 | PRD-SDD FR-018 |
| TASK-FR-020 | PHASE-ZV2-INTAKE | task | Adaptive shell: single business hides switchers, multi business gets portfolio landing | P1 | Claude | done | - | features/FR-020-adaptive-shell |
| TASK-FR-019 | PHASE-ZV2-INTAKE | task | Enterprise API: ExternalRef mapping, upsert-by-external-id, OpenAPI from Zod | P2 | Claude | done | TASK-FR-018 | features/FR-019-enterprise-api |
| TASK-ZV2-DECISION | PHASE-ZV2-DECIDE | task | Record owner decision: merge as v1 module or promote to v2 foundation — decided A→B, ADR-002 | P1 | Owen | done | TASK-FR-017; TASK-FR-020 | ZURI-INTEGRATION-ASSESSMENT |
| TASK-MERGE-VOCAB | PHASE-ZV2-MERGE | task | ~~Adopt canonical scope vocabulary in Zuri v1~~ | P1 | Owen | cancelled | - | ADR-003 |
| TASK-MERGE-BIZDIM | PHASE-ZV2-MERGE | task | ~~Business dimension on every new Zuri v1 table~~ | P1 | Owen | cancelled | - | ADR-003 |
| TASK-MERGE-ADAPTER | PHASE-ZV2-MERGE | task | ~~Mount PM module inside Zuri v1~~ | P0 | Claude | cancelled | - | ADR-003 |
| TASK-MERGE-TASKPOS | PHASE-ZV2-MERGE | task | ~~Position PM work items vs v1 Task inside v1~~ — folded into TASK-V2-PARITY | P2 | Owen | cancelled | - | ADR-003 |
| TASK-MERGE-TRIGGER | PHASE-ZV2-MERGE | task | ~~Watch the B promotion trigger~~ — moot, B is now the plan | P2 | Owen | cancelled | - | ADR-003 |
| TASK-V2-PARITY | PHASE-V2-REPLACE | task | Parity inventory: module × route × page × model × usage, classified must-have / later / drop before cutover | P0 | Claude | done | - | replacement/PARITY-INVENTORY |
| TASK-V2-IDENTITY | PHASE-V2-REPLACE | task | Rebuild identity on V2: Person/Membership across businesses + LINE login, replacing tenant-scoped Employee credentials | P0 | Claude | planned | TASK-V2-PARITY | ADR-003 §D10 |
| TASK-V2-CONTRACTS | PHASE-V2-REPLACE | task | Record request/response fixtures for V1 endpoints as contract tests before any internals are reimplemented | P0 | Claude | planned | TASK-V2-PARITY | ADR-003 §D6 |
| TASK-V2-LINE-INTENT | PHASE-V2-REPLACE | task | LINE/AI surface as the 5th intake surface on the existing pipeline (message → intent → envelope → dry run → confirm in LINE → commit → audit), on V2-native APIs | P0 | Claude | planned | TASK-V2-IDENTITY | ADR-003 §D7 |
| TASK-V2-CUTOVER-RULES | PHASE-V2-REPLACE | task | Single-writer rule per tenant: LINE OA + workers + writes flip atomically; runbook + rollback | P0 | Owen | planned | TASK-V2-IDENTITY | ADR-003 §D8 |
| TASK-V2-PILOT | PHASE-V2-REPLACE | task | Pilot one low-risk module end to end (lift UI + shim + migrate ids + reimplement endpoints) and measure the real cost per module | P1 | Claude | planned | TASK-V2-CONTRACTS | ADR-003 §D3 |
| TASK-V2-CROSSBIZ | PHASE-V2-REPLACE | task | Ship one genuinely cross-business screen early, proving V2 is not V1 with new plumbing; time-box the useTenant shim | P1 | Claude | planned | TASK-V2-IDENTITY | ADR-003 §D9 |
| TASK-V2-LASTDATE | PHASE-V2-REPLACE | task | Set and hold the date for the final per-tenant cutover; V1 goes read-only then off | P0 | Owen | planned | TASK-V2-CUTOVER-RULES | ADR-003 §D1 |
