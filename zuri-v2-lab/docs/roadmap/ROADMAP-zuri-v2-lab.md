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
| PHASE-ZV2-INTAKE | Intake surfaces: UI wizard, Excel template, Enterprise API, adaptive shell | FR-017..FR-020 implemented + tested through the unified pipeline | in-progress | 56 |
| PHASE-ZV2-DECIDE | Zuri v1 module merge vs Zuri v2 foundation decision | Owner decision recorded per ZURI-INTEGRATION-ASSESSMENT.md | planned | 0 |

## Backlog Items

| ID | Parent ID | Type | Title | Priority | Owner | Status | Dependencies | Source Section |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-ZV2-MVP-CORE | PHASE-ZV2-MVP | task | Scope model + project core + 7 execution views + progress engine (FR-001..016) | P0 | Claude | done | - | PRD-SDD 1.3 |
| TASK-ZV2-GOV-DOCS | PHASE-ZV2-GOV | task | PRD-SDD v1.0 + appendices + doc-graph + preflight all green | P0 | Claude | done | TASK-ZV2-MVP-CORE | PRD-SDD 1.6 |
| TASK-FR-017 | PHASE-ZV2-INTAKE | task | UI wizard: start-from-objective, builds envelope into validate/dry-run/commit pipeline | P0 | Claude | done | - | PRD-SDD FR-017 |
| TASK-FR-018 | PHASE-ZV2-INTAKE | task | Excel template generator (from Zod schema) + xlsx-to-envelope converter with per-row errors | P1 | Claude | done | TASK-FR-017 | PRD-SDD FR-018 |
| TASK-FR-020 | PHASE-ZV2-INTAKE | task | Adaptive shell: single business hides switchers, multi business gets portfolio landing | P1 | Claude | planned | - | UX-SINGLE-VS-MULTI-BUSINESS |
| TASK-FR-019 | PHASE-ZV2-INTAKE | task | Enterprise API: ExternalRef mapping, upsert-by-external-id, OpenAPI from Zod | P2 | Claude | planned | TASK-FR-018 | ENTERPRISE-API-SURFACE |
| TASK-ZV2-DECISION | PHASE-ZV2-DECIDE | task | Record owner decision: merge as v1 module or promote to v2 foundation | P1 | Owen | planned | TASK-FR-017; TASK-FR-020 | ZURI-INTEGRATION-ASSESSMENT |
