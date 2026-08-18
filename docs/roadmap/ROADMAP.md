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
| PHASE-V2-REPLACE | ~~Replace the legacy project by reuse~~ — program retired by ADR-024: zuri-ai is standalone, nothing is lifted, no cutover. Delivered tasks below stand as shipped product work | retired | closed (ADR-024) | 8 |

## Backlog Items

| ID | Parent ID | Type | Title | Priority | Owner | Status | Dependencies | Source Section |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-ZV2-MVP-CORE | PHASE-ZV2-MVP | task | Scope model + project core + 7 execution views + progress engine (FR-001..016) | P0 | Claude | done | - | PRD-SDD 1.3 |
| TASK-ZV2-GOV-DOCS | PHASE-ZV2-GOV | task | PRD-SDD v1.0 + appendices + doc-graph + preflight all green | P0 | Claude | done | TASK-ZV2-MVP-CORE | PRD-SDD 1.6 |
| TASK-FR-017 | PHASE-ZV2-INTAKE | task | UI wizard: start-from-objective, builds envelope into validate/dry-run/commit pipeline | P0 | Claude | done | - | PRD-SDD FR-017 |
| TASK-FR-018 | PHASE-ZV2-INTAKE | task | Excel template generator (from Zod schema) + xlsx-to-envelope converter with per-row errors | P1 | Claude | done | TASK-FR-017 | PRD-SDD FR-018 |
| TASK-FR-020 | PHASE-ZV2-INTAKE | task | Adaptive shell: single business hides switchers, multi business gets portfolio landing | P1 | Claude | done | - | features/FR-020-adaptive-shell |
| TASK-FR-040 | PHASE-V2-REPLACE | task | Project-local Work views: WBS Structure Plan plus Dependency Map, without changing shell scope or persistence | P1 | Codex | done | FR-005; FR-007; FR-039; ADR-012 | features/FR-040-project-work-views |
| TASK-FR-041-042 | PHASE-V2-REPLACE | task | Business-first Overview with Business Strategy Roadmap/Goals and HR / People peer domain | P0 | Codex | done | FR-035; FR-039; ADR-013 | ../domains/project-manager/features/FR-041-business-strategy-overview.md; ../domains/project-manager/features/FR-042-hr-people-peer-domain.md |
| TASK-FR-019 | PHASE-ZV2-INTAKE | task | Enterprise API: ExternalRef mapping, upsert-by-external-id, OpenAPI from Zod | P2 | Claude | done | TASK-FR-018 | features/FR-019-enterprise-api |
| TASK-ZV2-DECISION | PHASE-ZV2-DECIDE | task | Record owner decision: merge as v1 module or promote to v2 foundation — decided A→B, ADR-002 | P1 | Owen | done | TASK-FR-017; TASK-FR-020 | ZURI-INTEGRATION-ASSESSMENT |
| TASK-MERGE-VOCAB | PHASE-ZV2-MERGE | task | ~~Adopt canonical scope vocabulary in Zuri v1~~ | P1 | Owen | cancelled | - | ADR-003 |
| TASK-MERGE-BIZDIM | PHASE-ZV2-MERGE | task | ~~Business dimension on every new Zuri v1 table~~ | P1 | Owen | cancelled | - | ADR-003 |
| TASK-MERGE-ADAPTER | PHASE-ZV2-MERGE | task | ~~Mount PM module inside Zuri v1~~ | P0 | Claude | cancelled | - | ADR-003 |
| TASK-MERGE-TASKPOS | PHASE-ZV2-MERGE | task | ~~Position PM work items vs v1 Task inside v1~~ — folded into TASK-V2-PARITY | P2 | Owen | cancelled | - | ADR-003 |
| TASK-MERGE-TRIGGER | PHASE-ZV2-MERGE | task | ~~Watch the B promotion trigger~~ — moot, B is now the plan | P2 | Owen | cancelled | - | ADR-003 |
| TASK-V2-PARITY | PHASE-V2-REPLACE | task | Parity inventory: module × route × page × model × usage, classified must-have / later / drop before cutover | P0 | Claude | done | - | replacement/PARITY-INVENTORY |
| TASK-V2-IDENTITY | PHASE-V2-REPLACE | task | Identity foundations FR-021/022 are implemented; production web request-session boundary remains (legacy-Employee reconciliation dropped per ADR-024) | P0 | Claude | in-progress | - | ADR-017; ADR-024 |
| TASK-V2-CONTRACTS | PHASE-V2-REPLACE | task | ~~Record contract tests for legacy endpoints before reimplementing~~ — no endpoint is being reimplemented | P0 | Claude | cancelled (ADR-024) | - | ADR-024 |
| TASK-V2-LINE-INTENT | PHASE-V2-REPLACE | task | FR-023..029 provide the backend/agent foundations; production consent and deployment gates remain (cutover gate dropped per ADR-024) | P0 | Claude | in-progress | TASK-V2-IDENTITY | ADR-007; ADR-024 |
| TASK-V2-CUTOVER-RULES | PHASE-V2-REPLACE | task | ~~Single-writer cutover rule per tenant~~ — no cutover will occur | P0 | Owen | cancelled (ADR-024) | - | ADR-024 |
| TASK-V2-PILOT | PHASE-V2-REPLACE | task | ~~Pilot one lifted module to measure cost~~ — nothing is lifted | P1 | Claude | cancelled (ADR-024) | - | ADR-024 |
| TASK-V2-CROSSBIZ | PHASE-V2-REPLACE | task | Ship one genuinely cross-business screen early (survives ADR-024 as ordinary product work — no longer tied to any migration) | P1 | Claude | planned | - | ADR-024 |
| TASK-V2-LASTDATE | PHASE-V2-REPLACE | task | ~~Final per-tenant cutover date~~ — no cutover will occur | P0 | Owen | cancelled (ADR-024) | - | ADR-024 |
| TASK-FR-045 | PHASE-V2-REPLACE | task | SQLite-authoritative managed local file workspace, Business/Project File Manager, disposable cache and legacy ProjectFile migration | P0 | Codex | done (beta) | ADR-016; ZV2-CR-001 | ../domains/project-manager/features/FR-045-managed-local-file-workspace.md; roadmap/PLAN-FR-045-MANAGED-LOCAL-FILE-WORKSPACE.md |
| TASK-FR-046 | PHASE-V2-REPLACE | task | Trusted request viewer and atomic viewer-scoped `/api/entry` for production-safe Business Routing | P0 | Codex | done | FR-031; FR-044 | ADR-017; ../domains/identity/features/FR-046-production-viewer-entry-contract.md |
| TASK-FR-053-054 | PHASE-V2-REPLACE | task | Phase 1 activation readiness: deterministic golden evaluation, live-role isolation probe and dry-run controlled canary plan | P0 | Codex | done (beta; external activation pending) | FR-047..052; ADR-018 | ADR-019; changes/ZV2-CR-005-PHASE1-ACTIVATION-READINESS.md |
| TASK-FR-079 | PHASE-V2-REPLACE | task | Phase 1 LINE runtime connection cut-over: trusted Business-scoped active-primary selection, provider-neutral SecretManagerPort and local-only Ollama boundary | P0 | ATHER | done (beta; production external gates pending) | FR-047..052; ADR-031 | ../domains/integration/features/FR-079-phase1-line-runtime-connection-cutover.md; PLAN-FR-079-PHASE1-LINE-RUNTIME-CONNECTION-CUTOVER.md |
| TASK-FR-080 | PHASE-V2-REPLACE | task | Platform Integrations UI: owner-scoped metadata management, opaque Supabase Vault references and redacted readiness | P0 | ATHER | in-progress (local slice; live Vault/activation gates pending) | FR-038; FR-061; FR-062; FR-079; ADR-032 | ../domains/integration/features/FR-080-integration-secret-management-ui.md; PLAN-FR-080-INTEGRATION-SECRET-MANAGEMENT-UI.md |
| TASK-FR-057 | PHASE-V2-REPLACE | task | Multi-tenant principal-scoped MSP vaults, per-turn AuthContext and policy-before-retrieval | P0 | ATHER | in-progress | FR-021..029; FR-051..052 | ADR-022; ../domains/agent/features/FR-057-authorized-agent-context-and-vault-resolution.md; roadmap/PLAN-FR-057-AUTHORIZED-AGENT-CONTEXT.md |
