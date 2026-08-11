# Appendix D — Traceability Matrix

| Field | Value |
|-------|-------|
| **Version** | 2.0.0 |
| **Status** | Auto-generated |
| **Generator** | `scripts/doc-graph.mjs` (RWANG doc-graph) |

> Regenerate with `npm run docs:graph`; `npm run docs:check` fails if this file
> is stale. Do not hand-edit — every row is derived from `@req`/`@spec`/`@tested`
> annotations in the source, from requirement ids named inside tests, and from
> transitive test → code → requirement paths.

**Coverage** — FR with code **100% (20/20)** · FR with tests **100% (20/20)** ·
rules anchored in code **83% (20/24)** · annotated source files **31**

## Functional requirements

Each FR must have code that declares `@req` and a test that reaches it.

| ID | Statement | Anchored in | Verified by | State |
|---|---|---|---|---|
| FR-001 | จัดการ scope hierarchy: Portfolio / Tenant / Business / Branch / LegalEntity / Workspace (CRUD + human codes) | `modules/project-manager/application/scope-service.js` | `integration/scope-and-isolation.test.js` | ✅ |
| FR-002 | Scope selectors (Portfolio·Business·Workspace·Project) + จำ selection ล่าสุด | `app/(pm)/overview/page.jsx`, `components/layouts/Topbar.jsx`, `context/ScopeContext.jsx` | `e2e/smoke.spec.js` | ✅ |
| FR-003 | Project CRUD + archive (soft delete) + mixed execution modes | `modules/project-manager/application/project-service.js` | `integration/project-core.test.js` | ✅ |
| FR-004 | Workstream CRUD: executionMode + progressStrategy + progressWeight | `modules/project-manager/application/project-service.js` | `integration/project-core.test.js` | ✅ |
| FR-005 | Neutral work model: WorkContainer (ลำดับชั้น) + WorkItem (weight/value/probability/metrics) | `modules/project-manager/application/work-service.js` | `integration/project-core.test.js` | ✅ |
| FR-006 | Milestones + Gates (weighted, required flag, evidence JSON) | `modules/project-manager/application/milestone-gate-service.js` | `integration/project-core.test.js` | ✅ |
| FR-007 | Dependencies 5 ชนิด, กัน self/cycle, ประเมิน blocked/ready | `modules/project-manager/application/dependency-service.js` | `integration/project-core.test.js` | ✅ |
| FR-008 | Repository records (local metadata) + ผูกโปรเจกต์แบบ many-to-many | `modules/project-manager/application/repository-service.js` | `integration/project-core.test.js` | ✅ |
| FR-009 | Execution views 7 โหมดบนโมเดลกลาง (global + project-scoped) | `modules/project-manager/views/execution/mode-bodies.jsx` | `e2e/smoke.spec.js` | ✅ |
| FR-010 | Progress ต่อ workstream ตาม strategy + evidence + warnings + "Explain" UI | `modules/project-manager/progress/strategies.js` | `unit/strategies.test.js` | ✅ |
| FR-011 | Project roll-up ถ่วงน้ำหนัก Σ(ws%×w)/Σw | `modules/project-manager/progress/rollup.js` | `unit/rollup.test.js` | ✅ |
| FR-012 | PlanEnvelope import: validate → semantic check → dry run → transactional commit → audit | `modules/project-manager/import/plan-import-service.js`, `modules/project-manager/import/plan-schema.js` | `integration/external-ref-import.test.js`, `integration/plan-import.test.js`, `unit/plan-schema.test.js` | ✅ |
| FR-013 | Snapshot backup: export + import แบบ preview-then-confirm | `modules/project-manager/application/backup-service.js` | `integration/backup.test.js` | ✅ |
| FR-014 | Audit log (immutable) + UI browser | `modules/project-manager/application/audit.js` | `integration/plan-import.test.js`, `integration/project-core.test.js` | ✅ |
| FR-015 | Command palette (Ctrl+K), filters, search | `components/layouts/CommandPalette.jsx` | `e2e/smoke.spec.js` | ✅ |
| FR-016 | Seed/demo dataset idempotent ครบ 7 โหมด | `prisma/seed.js` | `e2e/smoke.spec.js` | ✅ |
| FR-017 | UI wizard intake ("เริ่มจากเป้าหมาย") → สร้าง envelope เข้า pipeline เดิม | `app/(pm)/projects/new/page.jsx` | `e2e/smoke.spec.js` | ✅ |
| FR-018 | Excel template intake: generator จาก Zod schema + xlsx→envelope converter + error รายแถว | `modules/project-manager/import/xlsx-convert.js`, `modules/project-manager/import/xlsx-template.js` | `e2e/smoke.spec.js`, `integration/xlsx-intake.test.js` | ✅ |
| FR-019 | Enterprise API: ExternalRef mapping + upsert-by-external-id + OpenAPI docs | `app/api/docs/route.js`, `modules/project-manager/api-docs/openapi.js`, `modules/project-manager/import/external-ref.js`, `modules/project-manager/import/plan-import-service.js`, `modules/project-manager/import/plan-schema.js` | `e2e/smoke.spec.js`, `integration/external-ref-import.test.js`, `integration/openapi-docs.test.js`, `integration/plan-import.test.js`, `unit/plan-schema.test.js` | ✅ |
| FR-020 | Adaptive shell ตามจำนวนธุรกิจ (single → ไม่มี switcher, multi → switcher + portfolio landing) | `app/(pm)/overview/page.jsx`, `app/(pm)/settings/page.jsx`, `app/api/progress/portfolio/route.js`, `components/layouts/Topbar.jsx`, `context/ScopeContext.jsx`, `lib/shell-mode.js`, `modules/project-manager/application/progress-service.js`, `modules/project-manager/application/scope-service.js`, `modules/project-manager/progress/rollup.js` | `e2e/smoke.spec.js`, `integration/adaptive-shell.test.js`, `integration/scope-and-isolation.test.js`, `unit/rollup.test.js`, `unit/shell-mode.test.js` | ✅ |

## Business rules, security rules and design decisions

Anchored by `@spec` in the code that enforces them.

| ID | Statement | Anchored in | Verified by | State |
|---|---|---|---|---|
| BR-001 | `tenant_id` = ขอบเขต isolation และการแชร์ข้อมูล — branch ไม่มีวันเป็น tenant; ธุรกิจใน tenant เดียวกันแชร์ CRM ได้, ต่าง tenant แชร์ไม่ได้ | `modules/project-manager/application/scope-service.js` | `integration/scope-and-isolation.test.js` | ✅ |
| BR-002 | External ID (tax id, GitHub id, LINE id, SAP id) ไม่มีวันเป็น primary key — UUID ภายใน + human code + ExternalRef | `lib/ids.js`, `modules/project-manager/application/repository-service.js` | `integration/project-core.test.js`, `unit/ids.test.js` | ✅ |
| BR-003 | ไม่มี template picker — โปรเจกต์เริ่มจากเป้าหมาย, execution mode เป็นของ workstream | `app/(pm)/projects/new/page.jsx` | `e2e/smoke.spec.js` | ✅ |
| BR-004 | Execution mode มีเพียง 7 โหมด canonical ห้ามเพิ่มใน v1 | `lib/validation/enums.js`, `modules/project-manager/application/project-service.js`, `modules/project-manager/import/plan-schema.js` | `integration/project-core.test.js`, `integration/xlsx-intake.test.js`, `unit/plan-schema.test.js` | ✅ |
| BR-005 | ห้ามใช้ tasks_done/tasks_total เป็น progress สากล — ต้อง strategy-based + weighted roll-up | `modules/project-manager/progress/strategies.js` | `unit/strategies.test.js` | ✅ |
| BR-006 | Required gate ที่ยังไม่ผ่าน cap progress ที่ 99% พร้อม warning | `modules/project-manager/progress/strategies.js` | `unit/strategies.test.js` | ✅ |
| BR-007 | แผนที่ import เป็นข้อมูลเท่านั้น — ไม่มีการ execute code จาก plan | `modules/project-manager/import/plan-schema.js` | `unit/plan-schema.test.js` | ✅ |
| BR-008 | Restore snapshot ต้อง preview + confirm เสมอ — ไม่มี silent overwrite | `modules/project-manager/application/backup-service.js` | `integration/backup.test.js` | ✅ |
| BR-009 | ทุก intake surface (UI/Excel/agent/API) ต้องจบที่ pipeline validate→dry-run→commit เดียวกัน | `modules/project-manager/import/plan-import-service.js` | `integration/external-ref-import.test.js`, `integration/plan-import.test.js` | ✅ |
| SDD-001 | ~~Standalone repo ก่อน integrate (ADR-001)~~ **superseded by ADR-003** — V2 แทน V1 ด้วยการ reuse (ยก UI ทีละโมดูลตอน cutover) | — | — | 🔴 no anchor |
| SDD-002 | Persisted enums เป็น string, Zod (`src/lib/validation/enums.js`) เป็น source of truth เดียว | `lib/validation/enums.js` | `integration/xlsx-intake.test.js`, `unit/plan-schema.test.js` | ✅ |
| SDD-003 | UUID PK + human code (unique) พร้อม collision retry | `lib/ids.js` | `unit/ids.test.js` | ✅ |
| SDD-004 | Soft delete (`deletedAt`) + `version` counter บน aggregate roots | `modules/project-manager/application/project-service.js` | `integration/project-core.test.js` | ✅ |
| SDD-005 | Progress calculators เป็น pure function; `progressCache` เป็น advisory เท่านั้น | `modules/project-manager/progress/strategies.js` | `unit/strategies.test.js` | ✅ |
| SDD-006 | Import commit ใน `prisma.$transaction` เดียว, upsert by code | `modules/project-manager/import/plan-import-service.js` | `integration/external-ref-import.test.js`, `integration/plan-import.test.js` | ✅ |
| SDD-007 | UI เป็น client fetch (`useFetch`) เรียก API handlers ซึ่ง delegate ให้ services | `modules/project-manager/components/useApi.js` | — | 🟠 no test |
| SDD-008 | JavaScript + Zod ที่ boundary (ไม่ใช่ TypeScript) — **ยึดกับไฟล์ใดไฟล์หนึ่งไม่ได้โดยธรรมชาติ** | — | — | 🔴 no anchor |
| SDD-009 | Unified intake: ทุก surface แปลงเป็น envelope เดียว | `modules/project-manager/import/plan-import-service.js` | `integration/external-ref-import.test.js`, `integration/plan-import.test.js` | ✅ |
| SEC-001 | Cross-tenant/business guard (`assertWorkspaceInScope`) — ปฏิเสธข้าม scope | `modules/project-manager/application/scope-service.js` | `integration/scope-and-isolation.test.js` | ✅ |
| SEC-002 | ไม่ execute code จาก imported plans (strict Zod, additionalProperties rejected) | `modules/project-manager/import/plan-import-service.js`, `modules/project-manager/import/plan-schema.js` | `integration/external-ref-import.test.js`, `integration/plan-import.test.js`, `unit/plan-schema.test.js` | ✅ |
| SEC-003 | AuditEvent append-only สำหรับทุก mutation สำคัญ | `modules/project-manager/application/audit.js` | `integration/plan-import.test.js`, `integration/project-core.test.js` | ✅ |
| SEC-004 | MVP ไม่มี customer PII ในระบบ | — | — | 🔴 no anchor |
| SEC-005 | PDPA: consent ต่อธุรกิจใน `CustomerBusinessProfile` เมื่อทำ CRM sharing | — | — | 🔴 no anchor |
| SEC-006 | Enterprise API ต้องมี token auth ต่อ tenant ก่อนเปิดใช้จริง | `app/api/docs/route.js` | `integration/openapi-docs.test.js` | ✅ |

## Non-functional requirements

Evidenced by the acceptance matrix in `.agent/reports/FINAL.md` (build output, e2e runs, determinism tests) rather than by a single file.

| ID | Statement | Anchored in | Verified by | State |
|---|---|---|---|---|
| NFR-001 | Runtime offline สมบูรณ์หลัง `npm install` (SQLite, ไม่มี cloud/CDN/font ภายนอก) | — | — | 🔴 no anchor |
| NFR-002 | `npm run build` ผ่านโดยไม่มี error | — | — | 🔴 no anchor |
| NFR-003 | Responsive ถึง 375px โดยไม่มี horizontal scroll | — | — | 🔴 no anchor |
| NFR-004 | Keyboard: palette เต็มรูปแบบ, aria labels, progressbar roles | — | — | 🔴 no anchor |
| NFR-005 | Progress calculators deterministic (pure, no clock/random) | — | — | 🔴 no anchor |
| NFR-006 | Persistence ย้ายไป Postgres ได้โดยไม่แก้ semantics (string enums, UUID, JSON strings) | — | — | 🔴 no anchor |
| NFR-007 | Seed idempotent / reset ได้ (`db:seed`, `db:reset`) | `prisma/seed.js` | `e2e/smoke.spec.js` | ✅ |
