# Zuri v2 Project Manager — PRD & SDD

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Draft |
| **Author** | Owen (etohcolsgroup) + Claude (RWANG doc-architect) |
| **Created** | 2026-08-11 |
| **Last Updated** | 2026-08-11 |
| **Approved By** | — |

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-08-11 | Owen + Claude | Initial creation via RWANG doc-architect — merged from spec pack (`D:\zuri-ai\docs`) + build docs |

## Referenced Standards

- IEEE 29148-2018 (Requirements Engineering)
- IEEE 1016-2009 (Software Design Description)
- ISO/IEC 42001 (AI management — Layer 3 only)

## Source documents (merged, still authoritative for detail)

Spec pack: `../../docs/` — START-HERE, AGENTS.md, ADR-001, ARCHITECTURE, DOMAIN-MODEL,
EXECUTION-MODES, IMPLEMENTATION-PLAN, ACCEPTANCE-CRITERIA, TEST-PLAN, UI-DESIGN-SYSTEM,
ROUTES-SITEMAP, INTEGRATION-MAP-ZURI, ZURI-V2-HANDOFF.
Build docs: `ARCHITECTURE-NOTES.md`, `DB-MIGRATION-NOTES.md`, `ZURI-INTEGRATION-ASSESSMENT.md`,
`UX-SINGLE-VS-MULTI-BUSINESS.md`, `ENTERPRISE-API-SURFACE.md`, `../.agent/reports/FINAL.md`.

---

# Layer 1 — Product Requirements (PRD)

## 1.1 Executive summary

Offline-first Project Manager ที่รองรับ business execution และ software execution
ในระบบเดียว — ธุรกิจหนึ่งโปรเจกต์ผสม workstream ได้ 7 โหมด (Software Sprint,
Data Migration, B2B Sales, B2C Campaign, Product Launch, Operations, Business
Expansion) บนโมเดลข้อมูลกลางตัวเดียว เป็นโมดูลแรกของ Zuri v2 (ADR-001: สร้าง
standalone ก่อน ไม่แตะ Zuri v1)

## 1.2 Personas & use cases

| Persona | Use case หลัก | อ้างอิง |
|---|---|---|
| Owen A — เจ้าของธุรกิจเดียว | เข้าแอปเห็นงานทันที, สร้างโปรเจกต์จากเป้าหมาย, ไม่เจอศัพท์โครงสร้าง | UX-SINGLE-VS-MULTI-BUSINESS.md (stories A1–A4) |
| Owen B — เจ้าของหลายธุรกิจ | Portfolio overview, สลับธุรกิจ 1 คลิก, isolation ระหว่างธุรกิจ, งานข้ามธุรกิจ | เดียวกัน (stories B1–B5) |
| ผู้ใช้กระดาษ/Excel | ดาวน์โหลด template → กรอก → อัปโหลด → dry run รายแถว | v0.1 pattern (`import-data/`) |
| Enterprise integrator | upsert ผ่าน API ด้วย external ID ของระบบตัวเอง ไม่ใช้ UI | ENTERPRISE-API-SURFACE.md |
| Planning agent | ส่ง PlanEnvelope JSON เข้า pipeline import | contracts/plan-envelope.schema.json |

## 1.3 Functional requirements

สถานะ: ✅ = implemented + tested, 🔜 = specified, not built

| ID | Requirement | สถานะ |
|---|---|---|
| FR-001 | จัดการ scope hierarchy: Portfolio / Tenant / Business / Branch / LegalEntity / Workspace (CRUD + human codes) | ✅ |
| FR-002 | Scope selectors (Portfolio·Business·Workspace·Project) + จำ selection ล่าสุด | ✅ |
| FR-003 | Project CRUD + archive (soft delete) + mixed execution modes | ✅ |
| FR-004 | Workstream CRUD: executionMode + progressStrategy + progressWeight | ✅ |
| FR-005 | Neutral work model: WorkContainer (ลำดับชั้น) + WorkItem (weight/value/probability/metrics) | ✅ |
| FR-006 | Milestones + Gates (weighted, required flag, evidence JSON) | ✅ |
| FR-007 | Dependencies 5 ชนิด, กัน self/cycle, ประเมิน blocked/ready | ✅ |
| FR-008 | Repository records (local metadata) + ผูกโปรเจกต์แบบ many-to-many | ✅ |
| FR-009 | Execution views 7 โหมดบนโมเดลกลาง (global + project-scoped) | ✅ |
| FR-010 | Progress ต่อ workstream ตาม strategy + evidence + warnings + "Explain" UI | ✅ |
| FR-011 | Project roll-up ถ่วงน้ำหนัก Σ(ws%×w)/Σw | ✅ |
| FR-012 | PlanEnvelope import: validate → semantic check → dry run → transactional commit → audit | ✅ |
| FR-013 | Snapshot backup: export + import แบบ preview-then-confirm | ✅ |
| FR-014 | Audit log (immutable) + UI browser | ✅ |
| FR-015 | Command palette (Ctrl+K), filters, search | ✅ |
| FR-016 | Seed/demo dataset idempotent ครบ 7 โหมด | ✅ |
| FR-017 | UI wizard intake ("เริ่มจากเป้าหมาย") → สร้าง envelope เข้า pipeline เดิม | 🔜 |
| FR-018 | Excel template intake: generator จาก Zod schema + xlsx→envelope converter + error รายแถว | 🔜 |
| FR-019 | Enterprise API: ExternalRef mapping + upsert-by-external-id + OpenAPI docs | 🔜 |
| FR-020 | Adaptive shell ตามจำนวนธุรกิจ (single → ไม่มี switcher, multi → switcher + portfolio landing) | 🔜 |

## 1.4 Non-functional requirements

| ID | Requirement | หลักฐาน |
|---|---|---|
| NFR-001 | Runtime offline สมบูรณ์หลัง `npm install` (SQLite, ไม่มี cloud/CDN/font ภายนอก) | FINAL.md matrix |
| NFR-002 | `npm run build` ผ่านโดยไม่มี error | 16 routes |
| NFR-003 | Responsive ถึง 375px โดยไม่มี horizontal scroll | e2e test |
| NFR-004 | Keyboard: palette เต็มรูปแบบ, aria labels, progressbar roles | e2e + code |
| NFR-005 | Progress calculators deterministic (pure, no clock/random) | 31 unit tests |
| NFR-006 | Persistence ย้ายไป Postgres ได้โดยไม่แก้ semantics (string enums, UUID, JSON strings) | DB-MIGRATION-NOTES.md |
| NFR-007 | Seed idempotent / reset ได้ (`db:seed`, `db:reset`) | verified double-run |

## 1.5 Business rules

| ID | Rule |
|---|---|
| BR-001 | `tenant_id` = ขอบเขต isolation และการแชร์ข้อมูล — branch ไม่มีวันเป็น tenant; ธุรกิจใน tenant เดียวกันแชร์ CRM ได้, ต่าง tenant แชร์ไม่ได้ |
| BR-002 | External ID (tax id, GitHub id, LINE id, SAP id) ไม่มีวันเป็น primary key — UUID ภายใน + human code + ExternalRef |
| BR-003 | ไม่มี template picker — โปรเจกต์เริ่มจากเป้าหมาย, execution mode เป็นของ workstream |
| BR-004 | Execution mode มีเพียง 7 โหมด canonical ห้ามเพิ่มใน v1 |
| BR-005 | ห้ามใช้ tasks_done/tasks_total เป็น progress สากล — ต้อง strategy-based + weighted roll-up |
| BR-006 | Required gate ที่ยังไม่ผ่าน cap progress ที่ 99% พร้อม warning |
| BR-007 | แผนที่ import เป็นข้อมูลเท่านั้น — ไม่มีการ execute code จาก plan |
| BR-008 | Restore snapshot ต้อง preview + confirm เสมอ — ไม่มี silent overwrite |
| BR-009 | ทุก intake surface (UI/Excel/agent/API) ต้องจบที่ pipeline validate→dry-run→commit เดียวกัน |

## 1.6 Acceptance criteria

AC ทั้งชุดอยู่ที่ `../../docs/ACCEPTANCE-CRITERIA.md`; ผลการตรวจรายข้อ (ทุกข้อ PASS)
อยู่ที่ `../.agent/reports/FINAL.md` — traceability ราย FR ดู Appendix D

---

# Layer 2 — Software Design (SDD)

## 2.1 Architecture

```text
Next.js App Router (src/app: UI (pm) group + API handlers)
  → Application services (src/modules/project-manager/application)
  → Pure domain (progress/strategies, rollup, import/plan-schema)
  → Prisma singleton (src/lib/db.js) → SQLite
```

รายละเอียด: `ARCHITECTURE-NOTES.md`

## 2.2 Design decisions

| ID | Decision | เหตุผล |
|---|---|---|
| SDD-001 | Standalone repo ก่อน integrate (ADR-001) | กัน regression ใน Zuri v1, ทดลอง schema ได้อิสระ |
| SDD-002 | Persisted enums เป็น string, Zod (`src/lib/validation/enums.js`) เป็น source of truth เดียว | Postgres migration ไร้ connector coupling |
| SDD-003 | UUID PK + human code (unique) พร้อม collision retry | BR-002; code ใช้อ้างใน Excel/envelope ได้ |
| SDD-004 | Soft delete (`deletedAt`) + `version` counter บน aggregate roots | audit-friendly, กู้คืนได้ |
| SDD-005 | Progress calculators เป็น pure function; `progressCache` เป็น advisory เท่านั้น | deterministic tests, คำนวณซ้ำได้เสมอ |
| SDD-006 | Import commit ใน `prisma.$transaction` เดียว, upsert by code | atomicity + idempotent re-import |
| SDD-007 | UI เป็น client fetch (`useFetch`) เรียก API handlers ซึ่ง delegate ให้ services | MVP-simple; server-component read path เป็นงานอนาคต |
| SDD-008 | JavaScript + Zod ที่ boundary (ไม่ใช่ TypeScript) | mandate จาก MASTER-PROMPT tree |
| SDD-009 | Unified intake: ทุก surface แปลงเป็น envelope เดียว | BR-009; เทสต์ pipeline ชุดเดียวคุ้มทุกทาง |

## 2.3 Security requirements

| ID | Requirement | สถานะ |
|---|---|---|
| SEC-001 | Cross-tenant/business guard (`assertWorkspaceInScope`) — ปฏิเสธข้าม scope | ✅ tested |
| SEC-002 | ไม่ execute code จาก imported plans (strict Zod, additionalProperties rejected) | ✅ tested |
| SEC-003 | AuditEvent append-only สำหรับทุก mutation สำคัญ | ✅ |
| SEC-004 | MVP ไม่มี customer PII ในระบบ | ✅ by scope |
| SEC-005 | PDPA: consent ต่อธุรกิจใน `CustomerBusinessProfile` เมื่อทำ CRM sharing | 🔜 (เฟส CRM) |
| SEC-006 | Enterprise API ต้องมี token auth ต่อ tenant ก่อนเปิดใช้จริง | 🔜 |

## 2.4 API / DB / Testing / Deployment

- API surface: Appendix A · DB schema: Appendix B (`prisma/schema.prisma` 19 models)
- Testing: 75 Vitest (unit+integration, isolated `prisma/test.db`) + 20 Playwright E2E — รายละเอียด `../../docs/TEST-PLAN.md` + PHASE-07 report
- Deployment: local เท่านั้นใน MVP; เส้นทาง Postgres/v2 ดู `DB-MIGRATION-NOTES.md` + `ZURI-INTEGRATION-ASSESSMENT.md`

---

# Layer 3 — AI System

## 3.1 Agent boundary

| ID | Spec |
|---|---|
| AI-AGT-001 | Planning Agent อยู่**นอก**แอป — contract เดียวคือ `contracts/plan-envelope.schema.json` (schemaVersion 1.0); แอปทำงานได้สมบูรณ์โดยไม่มี LLM |
| AI-AGT-002 | การ import จาก agent ติด `actorType: AGENT_PLAN` ใน audit; จาก UI = `LOCAL_USER` — แยกได้เสมอว่าใครเขียนอะไร |
| AI-AGT-003 | Enterprise headless surface (ExternalRef + OpenAPI gen จาก Zod) — `ENTERPRISE-API-SURFACE.md` | 
| AI-ETH-001 | ห้าม execute เนื้อหาใด ๆ จาก plan; unknown mode/strategy ถูกปฏิเสธที่ schema; ทุก commit มี dry-run + audit trail ตรวจย้อนได้ |

ไม่มี model lifecycle/model cards ใน repo นี้ (ไม่มีการ train/host โมเดล) — จะเพิ่ม
เมื่อ Zuri.Ai ฝัง agent จริงในเฟสถัดไป
