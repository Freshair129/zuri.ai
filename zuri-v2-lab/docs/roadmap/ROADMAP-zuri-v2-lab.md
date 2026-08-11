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
| PHASE-ZV2-MVP | Build offline-first PM MVP (spec phases 00-07) | ACCEPTANCE-CRITERIA all PASS — 75 Vitest + 20 Playwright green (FINAL.md) | done | 100 |
| PHASE-ZV2-GOV | 3-layer docs, doc-graph, @req annotations, GoVibe registration | preflight 9 PASS / 0 WARN; candidates in GoVibe .brain/inbound | done | 100 |
| PHASE-ZV2-INTAKE | Intake surfaces: UI wizard, Excel template, Enterprise API, adaptive shell | FR-017..FR-020 implemented + tested through the unified pipeline | done | 100 |
| PHASE-ZV2-DECIDE | Zuri v1 module merge vs Zuri v2 foundation decision | Owner decision recorded per ZURI-INTEGRATION-ASSESSMENT.md | done | 100 |
| PHASE-ZV2-MERGE | Ship PM into Zuri v1 as a module, under the ADR-002 conditions that keep B affordable | PM live in v1 · vocabulary adopted · business dimension enforced on new tables · scope adapter isolated to one file | planned | 0 |

## Backlog Items

| ID | Parent ID | Type | Title | Priority | Owner | Status | Dependencies | Source Section |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-ZV2-MVP-CORE | PHASE-ZV2-MVP | task | Scope model + project core + 7 execution views + progress engine (FR-001..016) | P0 | Claude | done | - | PRD-SDD 1.3 |
| TASK-ZV2-GOV-DOCS | PHASE-ZV2-GOV | task | PRD-SDD v1.0 + appendices + doc-graph + preflight all green | P0 | Claude | done | TASK-ZV2-MVP-CORE | PRD-SDD 1.6 |
| TASK-FR-017 | PHASE-ZV2-INTAKE | task | UI wizard: start-from-objective, builds envelope into validate/dry-run/commit pipeline | P0 | Claude | done | - | PRD-SDD FR-017 |
| TASK-FR-018 | PHASE-ZV2-INTAKE | task | Excel template generator (from Zod schema) + xlsx-to-envelope converter with per-row errors | P1 | Claude | done | TASK-FR-017 | PRD-SDD FR-018 |
| TASK-FR-020 | PHASE-ZV2-INTAKE | task | Adaptive shell: single business hides switchers, multi business gets portfolio landing | P1 | Claude | done | - | UX-SINGLE-VS-MULTI-BUSINESS |
| TASK-FR-019 | PHASE-ZV2-INTAKE | task | Enterprise API: ExternalRef mapping, upsert-by-external-id, OpenAPI from Zod | P2 | Claude | done | TASK-FR-018 | ENTERPRISE-API-SURFACE |
| TASK-ZV2-DECISION | PHASE-ZV2-DECIDE | task | Record owner decision: merge as v1 module or promote to v2 foundation — decided A→B, ADR-002 | P1 | Owen | done | TASK-FR-017; TASK-FR-020 | ZURI-INTEGRATION-ASSESSMENT |
| TASK-MERGE-VOCAB | PHASE-ZV2-MERGE | task | Adopt canonical scope vocabulary in Zuri v1 docs/new code; stop using "tenant" to mean a shop (ADR-002 condition 1) | P1 | Owen | planned | TASK-ZV2-DECISION | ADR-002 |
| TASK-MERGE-BIZDIM | PHASE-ZV2-MERGE | task | Require a business dimension on every new Zuri v1 table, backfillable (ADR-002 condition 2) | P1 | Owen | planned | TASK-ZV2-DECISION | ADR-002 |
| TASK-MERGE-ADAPTER | PHASE-ZV2-MERGE | task | Mount PM module in Zuri v1: single-file v1.Tenant → PM.Business adapter + Postgres move + auth-gated import/backup | P0 | Claude | planned | TASK-MERGE-VOCAB | ADR-002; DB-MIGRATION-NOTES |
| TASK-MERGE-TASKPOS | PHASE-ZV2-MERGE | task | Position PM work items vs v1 Task (CRM follow-ups) so users never see two task systems | P2 | Owen | planned | TASK-MERGE-ADAPTER | ADR-002 |
| TASK-MERGE-TRIGGER | PHASE-ZV2-MERGE | task | Watch the B promotion trigger: first group customer needing cross-business CRM/reporting/identity | P2 | Owen | planned | TASK-ZV2-DECISION | ADR-002 |
