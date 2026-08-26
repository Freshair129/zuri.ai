---
title: "ROADMAP: zuri-ai — Live Delivery State"
doc_id: "ROADMAP-ZURI-V2-LAB"
status: "approved"
version: "2.0.0"
updated: "2026-08-26"
owner: "Owen"
source_of_truth: true
live_document: true
---

# ROADMAP: zuri-ai — Live Delivery State

สถานะจริงของโปรเจกต์ zuri-ai (https://github.com/Freshair129/zuri.ai) — ไฟล์นี้เป็น
live document ที่ GoVibe Mission Control อ่านตรง (roadmap parser อ่านตารางด้านล่าง
การแก้ช่อง Status เปลี่ยนสิ่งที่ Mission Control แสดงทันที) ทุกแถวอ้างอิงหลักฐานจริง
ใน repo — ไม่มี mock ตามกฎ PRODUCT.md ของ GoVibe

หลักฐาน: `docs/PRD-SDD-v1.0.md` (FR registry), `docs/TRACE.md` + `docs/FEATURE-MAP.md`
(generated: FR → code → tests), `docs/.preflight-report.json` (doc health),
`.agent/reports/FINAL.md` (acceptance matrix ยุค MVP — บันทึกประวัติศาสตร์)

> **หมายเหตุชื่อ**: `doc_id` คงค่าเดิม (`ROADMAP-ZURI-V2-LAB`) เพราะ id เป็น key
> ที่ไม่เปลี่ยน (AGENTS.md §18) — ผลิตภัณฑ์นี้คือ **zuri-ai** ตาม ADR-024; คำว่า
> "Zuri v2" ในแถวประวัติเป็น label ยุคก่อน ไม่ใช่คำสั่งงาน
> Revision 2.0.0 (2026-08-26): ปรับให้ตรงความจริงตาม gap analysis — เพิ่มงานยุค
> FR-058..FR-105 ที่ส่งมอบแล้วแต่ไม่เคยมีแถว, แก้ path หลักฐานที่ยังชี้
> `zuri-v2-lab/` (โครงสร้างถูก flatten ตั้งแต่ 2026-08-12), และปิดแถวที่งานจริง
> ย้ายไปอยู่ใน id ใหม่แล้ว

## Phases

| Phase | Goal | Exit Criteria | Status | Progress |
| --- | --- | --- | --- | --- |
| PHASE-ZV2-MVP | Build offline-first PM MVP (spec phases 00-07) | ACCEPTANCE-CRITERIA all PASS (`.agent/reports/FINAL.md`); ตัวเลขชุดเทสต์ปัจจุบันดูจาก `docs/.preflight-report.json` (`scanned.test_files`) ไม่บันทึกเลขตายตัวที่นี่ | done | 100 |
| PHASE-ZV2-GOV | 3-layer docs, doc-graph, @req annotations, GoVibe registration | preflight PASS; candidates in GoVibe .brain/inbound | done | 100 |
| PHASE-ZV2-INTAKE | Intake surfaces: UI wizard, Excel template, Enterprise API, adaptive shell | FR-017..FR-020 implemented + tested through the unified pipeline | done | 100 |
| PHASE-ZV2-DECIDE | Zuri v1 module merge vs Zuri v2 foundation decision | Owner decision recorded per ZURI-INTEGRATION-ASSESSMENT.md | done | 100 |
| PHASE-ZV2-MERGE | ~~Ship PM into Zuri v1 as a module (ADR-002)~~ — **cancelled by ADR-003**: V2 replaces V1, so anything mounted into V1 retires with it | n/a | cancelled | 0 |
| PHASE-V2-REPLACE | ~~Replace the legacy project by reuse~~ — program retired by ADR-024: zuri-ai is standalone, nothing is lifted, no cutover. Delivered tasks below stand as shipped product work | retired | closed (ADR-024) | 8 |
| PHASE-ZAI-PRODUCT | Standalone product build-out หลัง ADR-024: read views + domain surfaces (FR-058..064, FR-086), authorization repayment (FR-065, FR-072..075), execution planning (FEAT-003), inventory/backfill (FR-076..078), schema declaration (FR-090), operator console (FR-105) | ทุก FR มี code + tests ใน TRACE.md; route/viewer baselines repaid เป็นศูนย์ (2026-08-17/18) | done | 100 |
| PHASE-ZAI-RUNTIME | Phase 1 LINE runtime + ingestion boundary + integrations (FR-079..081, FEAT-004); Pipeline Builder canvas (FEAT-007) ยัง design-only | local delivery เขียวครบ; production gates ที่เหลือ: live Vault provisioning, LINE canary, real-provider evaluation | in-progress | 80 |
| PHASE-ZAI-CRM | CRM console + consent: Conversation Inbox (FR-091), reply receipt (FR-093), PDPA consent attestation (FR-103 ปิด SEC-005), market translation (FR-092) | code + tests ครบทุกตัวรวม e2e (`tests/e2e/fr091-conversation-inbox.spec.js`) | done | 100 |
| PHASE-ZAI-IAM | Production IAM (FEAT-010: FR-094..098, ADR-045) + owner-assisted password reset (FR-104); onboarding/invites (FR-066/067) ยังไม่เริ่ม — tracked เป็น TASK-ZAI-003/004 ใน 24w program | FEAT-010 hardening จบ; FR-066/067 ส่งมอบ; SEC-006 มีเจ้าของ | in-progress | 70 |
| PHASE-ZAI-SOT | SoT pipeline console (FEAT-011: FR-099..101) + data-plane service-account auth (FR-102, ADR-047) | live Supabase apply gate (RSK-016) ปิด; decision loop เดินจริงกับ data plane ภายนอก | in-progress | 90 |

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
| TASK-V2-IDENTITY | PHASE-V2-REPLACE | task | Identity foundations FR-021/022 delivered; the production request-session boundary that this row once held open shipped under FEAT-010 — successor row TASK-FEAT-010 | P0 | Claude | done | - | ADR-017; ADR-024; ADR-045 |
| TASK-V2-CONTRACTS | PHASE-V2-REPLACE | task | ~~Record contract tests for legacy endpoints before reimplementing~~ — no endpoint is being reimplemented | P0 | Claude | cancelled (ADR-024) | - | ADR-024 |
| TASK-V2-LINE-INTENT | PHASE-V2-REPLACE | task | FR-023..029 backend/agent foundations delivered; PDPA consent shipped separately (see the consent row under PHASE-ZAI-CRM); production deployment gates live on the runtime rows above | P0 | Claude | done | TASK-V2-IDENTITY | ADR-007; ADR-024 |
| TASK-V2-CUTOVER-RULES | PHASE-V2-REPLACE | task | ~~Single-writer cutover rule per tenant~~ — no cutover will occur | P0 | Owen | cancelled (ADR-024) | - | ADR-024 |
| TASK-V2-PILOT | PHASE-V2-REPLACE | task | ~~Pilot one lifted module to measure cost~~ — nothing is lifted | P1 | Claude | cancelled (ADR-024) | - | ADR-024 |
| TASK-V2-CROSSBIZ | PHASE-V2-REPLACE | task | Ship one genuinely cross-business screen early (survives ADR-024 as ordinary product work — no longer tied to any migration) | P1 | Claude | planned | - | ADR-024 |
| TASK-V2-LASTDATE | PHASE-V2-REPLACE | task | ~~Final per-tenant cutover date~~ — no cutover will occur | P0 | Owen | cancelled (ADR-024) | - | ADR-024 |
| TASK-FR-045 | PHASE-V2-REPLACE | task | SQLite-authoritative managed local file workspace, Business/Project File Manager, disposable cache and legacy ProjectFile migration | P0 | Codex | done (beta) | ADR-016; ZV2-CR-001 | ../domains/project-manager/features/FR-045-managed-local-file-workspace.md; roadmap/PLAN-FR-045-MANAGED-LOCAL-FILE-WORKSPACE.md |
| TASK-FR-046 | PHASE-V2-REPLACE | task | Trusted request viewer and atomic viewer-scoped `/api/entry` for production-safe Business Routing | P0 | Codex | done | FR-031; FR-044 | ADR-017; ../domains/identity/features/FR-046-production-viewer-entry-contract.md |
| TASK-FR-053-054 | PHASE-V2-REPLACE | task | Phase 1 activation readiness: deterministic golden evaluation, live-role isolation probe and dry-run controlled canary plan | P0 | Codex | done (beta; external activation pending) | FR-047..052; ADR-018 | ADR-019; changes/ZV2-CR-005-PHASE1-ACTIVATION-READINESS.md |
| TASK-FR-079 | PHASE-V2-REPLACE | task | Phase 1 LINE runtime connection cut-over: trusted Business-scoped active-primary selection, provider-neutral SecretManagerPort and local-only Ollama boundary | P0 | ATHER | done (beta; production external gates pending) | FR-047..052; ADR-031 | ../domains/integration/features/FR-079-phase1-line-runtime-connection-cutover.md; PLAN-FR-079-PHASE1-LINE-RUNTIME-CONNECTION-CUTOVER.md |
| TASK-FR-080 | PHASE-V2-REPLACE | task | Platform Integrations UI: owner-scoped metadata management, opaque Supabase Vault references and redacted readiness | P0 | ATHER | in-progress (local slice; live Vault/activation gates pending) | FR-038; FR-061; FR-062; FR-079; ADR-032 | ../domains/integration/features/FR-080-integration-secret-management-ui.md; PLAN-FR-080-INTEGRATION-SECRET-MANAGEMENT-UI.md |
| TASK-FR-057 | PHASE-V2-REPLACE | task | Multi-tenant principal-scoped MSP vaults, per-turn AuthContext and policy-before-retrieval | P0 | ATHER | in-progress | FR-021..029; FR-051..052 | ADR-022; ../domains/agent/features/FR-057-authorized-agent-context-and-vault-resolution.md |
| TASK-FR-058-064 | PHASE-ZAI-PRODUCT | task | Domain surfaces: File Manager views (FR-058), Business Strategy mutation (FR-059), Business Home dashboard (FR-060), per-Business domain visibility (FR-061), permissions read scope (FR-062), Project Board (FR-063), Schedule timeline (FR-064) | P1 | Claude | done | FR-041; FR-045 | ../domains/project-manager/features/FR-060-business-home.md |
| TASK-AUTH-REPAY | PHASE-ZAI-PRODUCT | task | Authorization repayment to zero baselines: import target (FR-065), PM mutation (FR-072), repository ownership (FR-073), scope creation (FR-074), installation-operator authority (FR-075) | P0 | Claude | done | FR-046; FR-061 | ../domains/project-manager/features/FR-065-import-target-authorization.md |
| TASK-FEAT-003 | PHASE-ZAI-PRODUCT | task | Execution planning: human-visible roadmap (FR-068), plan blueprint + intake (FR-069), stable execution/domain/tag identities (FR-070) | P1 | Claude | done | FR-012 | ../domains/project-manager/features/FR-068-human-visible-execution-roadmap.md |
| TASK-FR-076-078 | PHASE-ZAI-PRODUCT | task | Product Owner Business role binding (FR-076), Project Inventory MVP (FR-077), SmartGift customer backfill contract + review queue (FR-078) | P1 | Claude | done | FR-046 | ../domains/crm/features/FR-078-customer-data-backfill-contract.md |
| TASK-FEAT-008 | PHASE-ZAI-PRODUCT | task | Projects Dashboard (FR-086 shipped) + project priority (FR-087), accountable PIC (FR-088), Team grouping models (FR-089) | P1 | Claude | done (FR-087..089 status ruling resolved 2026-08-26 — PRD 1.89.0b) | FR-005; ADR-036; ADR-037 | ../domains/project-manager/features/FR-086-projects-dashboard.md |
| TASK-FR-090 | PHASE-ZAI-PRODUCT | task | Live production-auth table declaration (PersonCredential, PasswordResetToken, laneId) — resolved 2026-08-26: source branch deleted; successors TASK-FEAT-010 (login/session) and the password-reset row under PHASE-ZAI-IAM | P0 | Claude | done | - | PRD-SDD FR-090 |
| TASK-FR-105 | PHASE-ZAI-PRODUCT | task | Platform Programme Roadmap `/control/roadmap`: isOperator-only read-only projection of the 24-week programme (ADR-048) | P2 | Claude | done | FR-075; ADR-048 | ../domains/platform-control/features/FR-105-platform-programme-roadmap.md |
| TASK-FR-081 | PHASE-ZAI-RUNTIME | task | Raw external ingestion boundary: one normalized envelope, tenant/connection-scoped repository, dead-letter records (FR-081) | P0 | Claude | done | FR-079; BR-002 | ../domains/integration/features/FR-081-raw-external-ingestion.md |
| TASK-FEAT-007 | PHASE-ZAI-RUNTIME | task | Pipeline Builder canvas: structure editing (FR-082), edge creation (FR-083), handoff contracts (FR-084), contract-gated release (FR-085) — ADR-035 design only, implementation not authorized | P2 | Owen | planned | FR-007; FR-040; ADR-035 | ../domains/project-manager/features/FR-082-pipeline-canvas.md |
| TASK-FEAT-009 | PHASE-ZAI-CRM | task | CRM Conversation Inbox (FR-091, read-only per BR-011) + LINE reply delivery receipt (FR-093) | P0 | Claude | done | FR-023; FR-052; FR-081 | ../domains/crm/features/FR-091-conversation-inbox.md |
| TASK-FR-103 | PHASE-ZAI-CRM | task | PDPA consent attestation on Customer (FR-103) — closes SEC-005, P0 open since 2026-08-12; owner attests GRANTED/DECLINED in the CRM console, legacy rows GRANDFATHERED | P0 | Claude | done | FR-091; SEC-005 | ../domains/crm/features/FR-103-pdpa-consent-attestation.md |
| TASK-FR-092 | PHASE-ZAI-CRM | task | Market translation core: RawExternalRecord → provider-neutral MarketObservation (FR-092) | P1 | Claude | done | FR-081 | ../domains/market-intelligence/features/FR-092-market-translation-core.md |
| TASK-FEAT-010 | PHASE-ZAI-IAM | task | Production IAM (ADR-045): canonical principal (FR-094), persisted sessions (FR-095), shared policy enforcement (FR-096), verified channel onboarding (FR-097), agent/tool/MSP authorization (FR-098) | P0 | Claude | in-progress (code + tests landed; production hardening tail per Issue #99) | FR-046; ADR-045 | ../domains/identity/features/FR-094-production-iam-boundary.md |
| TASK-FR-104 | PHASE-ZAI-IAM | task | Owner-assisted password reset (FR-104): authenticated mint + public consume, digest-only storage, all sessions revoked — deliberately no public forgot-password route | P0 | Claude | done | FR-090; FR-095 | ../domains/identity/features/FR-104-owner-assisted-password-reset.md |
| TASK-SEC-006 | PHASE-ZAI-IAM | task | Enterprise API tenant token auth (SEC-006, still missing) — generalize the FR-102 bearer-key pattern beyond the two SoT routes | P1 | Owen | planned | FR-019; FR-102; ADR-047 | PRD-SDD SEC-006 |
| TASK-FEAT-011 | PHASE-ZAI-SOT | task | SoT pipeline console: plan board (FR-099), approval inbox + decision export (FR-100), graph dashboard (FR-101) | P0 | Claude | done (local; approved facts applied by the external data plane) | FR-071; ADR-046 | ../domains/integration/features/FR-100-sot-approval-inbox.md |
| TASK-FR-102 | PHASE-ZAI-SOT | task | SoT data-plane service-account key (FR-102, ADR-047): Bearer `sdpk_` auth for submit/export, SHA-256 digest only, per-Tenant binding | P0 | Claude | done (live Supabase apply gate — RSK-016) | FR-100; ADR-047 | ../domains/identity/features/FR-102-sot-data-plane-service-account.md |

## สิ่งที่ยังไม่ได้สร้างจริง (จาก gap analysis 2026-08-26 — เรียงตามน้ำหนัก)

รายการนี้คือส่วนที่ registry ประกาศแล้วแต่ยังไม่มีโค้ด หรือมี gate ภายนอกค้าง —
ตัวเลขสถานะในตารางข้างบนไม่นับสิ่งเหล่านี้ว่าเสร็จ:

1. **FR-066 / FR-067** — profile-first onboarding + workspace invites (ยังไม่มีโค้ด;
   BR-016 / SEC-014 / SDD-038 รอทั้งหมด) — tracked เป็น TASK-ZAI-003/004 ใน
   `ROADMAP-zuri-ai-24w-program.md`
2. **SEC-006** — Enterprise API tenant token auth (TASK-SEC-006 ข้างบน)
3. **FEAT-007 / FR-082..085** — Pipeline Builder canvas: design-only ตาม ADR-035
4. **FR-071 tail** — canonical apply, Product/Customer promotion, publish (SoT loop
   ที่ FR-100 เปิดทางเดินข้างไว้ให้)
5. **Production/activation gates** บน slice ที่โค้ดเสร็จแล้ว: LINE canary +
   real-provider evaluation (FR-053..055), live Vault provisioning (FR-079/080),
   remote identity migration (FR-076), live Supabase apply ของ FR-102 (RSK-016)
6. **ADR-044 in-repo seam** — ยังไม่มี FR สำหรับ Conversation ↔ unified-thread join
   และ group-thread isolation rule; งานหลัก (console, thread minting, dispatcher)
   อยู่นอก repo นี้ตาม ADR-044 D1

> **PRD status columns**: sync แล้วเมื่อ 2026-08-26 (PRD revision 1.89.0b) —
> FR-087..089, 091, 093, 097, 099..105 flip ตามโค้ดจริง; FR-100/102/103 เป็น 🟠
> เพราะ migration ทั้งสามยังไม่ apply บน live Supabase (ledger ตรวจ read-only
> จบที่ `20260822204604` — RSK-016)
