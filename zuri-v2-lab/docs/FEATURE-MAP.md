# Feature Map

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Auto-generated |
| **Generator** | `scripts/doc-graph.mjs` (RWANG doc-graph) |

> One index for every feature: what it is, which module owns it, whether it is
> V2-native or lifted from V1, and where its code, tests, design note and delivery
> task live. Regenerate with `npm run docs:graph` — never hand-edit.
>
> **Source** is the cutover dashboard: `v2-native` (built here), `lifted-from-v1`
> (V1 UI reused per ADR-003), `pending` (not moved yet).

| ID | Feature | Module | Source | Status | Code | Tests | Design note | Task |
|---|---|---|---|---|---|---|---|---|
| FR-001 | จัดการ scope hierarchy: Portfolio / Tenant / Business / Branch / LegalEntity / Workspace (CRUD + human codes) | project-manager | v2-native | ✅ live | `modules/project-manager/application/scope-service.js` | 1 | — | TASK-ZV2-MVP-CORE |
| FR-002 | Scope selectors (Portfolio·Business·Workspace·Project) + จำ selection ล่าสุด | shell | v2-native | ✅ live | `app/(pm)/overview/page.jsx` +2 | 1 | — | — |
| FR-003 | Project CRUD + archive (soft delete) + mixed execution modes | project-manager | v2-native | ✅ live | `modules/project-manager/application/project-service.js` | 1 | — | — |
| FR-004 | Workstream CRUD: executionMode + progressStrategy + progressWeight | project-manager | v2-native | ✅ live | `modules/project-manager/application/project-service.js` | 1 | — | — |
| FR-005 | Neutral work model: WorkContainer (ลำดับชั้น) + WorkItem (weight/value/probability/metrics) | project-manager | v2-native | ✅ live | `modules/project-manager/application/work-service.js` | 1 | — | — |
| FR-006 | Milestones + Gates (weighted, required flag, evidence JSON) | project-manager | v2-native | ✅ live | `modules/project-manager/application/milestone-gate-service.js` | 1 | — | — |
| FR-007 | Dependencies 5 ชนิด, กัน self/cycle, ประเมิน blocked/ready | project-manager | v2-native | ✅ live | `modules/project-manager/application/dependency-service.js` | 1 | — | — |
| FR-008 | Repository records (local metadata) + ผูกโปรเจกต์แบบ many-to-many | project-manager | v2-native | ✅ live | `modules/project-manager/application/repository-service.js` | 1 | — | — |
| FR-009 | Execution views 7 โหมดบนโมเดลกลาง (global + project-scoped) | project-manager | v2-native | ✅ live | `modules/project-manager/views/execution/mode-bodies.jsx` | 1 | — | — |
| FR-010 | Progress ต่อ workstream ตาม strategy + evidence + warnings + "Explain" UI | project-manager | v2-native | ✅ live | `modules/project-manager/progress/strategies.js` | 1 | — | — |
| FR-011 | Project roll-up ถ่วงน้ำหนัก Σ(ws%×w)/Σw | project-manager | v2-native | ✅ live | `modules/project-manager/progress/rollup.js` | 1 | — | — |
| FR-012 | PlanEnvelope import: validate → semantic check → dry run → transactional commit → audit | project-manager | v2-native | ✅ live | `modules/project-manager/import/plan-import-service.js`, `modules/project-manager/import/plan-schema.js` | 3 | — | — |
| FR-013 | Snapshot backup: export + import แบบ preview-then-confirm | project-manager | v2-native | ✅ live | `modules/project-manager/application/backup-service.js` | 1 | — | — |
| FR-014 | Audit log (immutable) + UI browser | project-manager | v2-native | ✅ live | `modules/project-manager/application/audit.js` | 2 | — | — |
| FR-015 | Command palette (Ctrl+K), filters, search | shell | v2-native | ✅ live | `components/layouts/CommandPalette.jsx` | 1 | — | — |
| FR-016 | Seed/demo dataset idempotent ครบ 7 โหมด | seed | v2-native | ✅ live | `prisma/seed.js` | 1 | — | — |
| FR-017 | UI wizard intake ("เริ่มจากเป้าหมาย") → สร้าง envelope เข้า pipeline เดิม | shell | v2-native | ✅ live | `app/(pm)/projects/new/page.jsx` | 1 | — | TASK-FR-017 |
| FR-018 | Excel template intake: generator จาก Zod schema + xlsx→envelope converter + error รายแถว | project-manager | v2-native | ✅ live | `modules/project-manager/import/xlsx-convert.js`, `modules/project-manager/import/xlsx-template.js` | 2 | — | TASK-FR-018 |
| FR-019 | Enterprise API: ExternalRef mapping + upsert-by-external-id + OpenAPI docs | shell, project-manager | v2-native | ✅ live | `app/api/docs/route.js` +4 | 5 | [doc](features/FR-019-enterprise-api.md) | TASK-FR-019 |
| FR-020 | Adaptive shell ตามจำนวนธุรกิจ (single → ไม่มี switcher, multi → switcher + portfolio landing) | shell, project-manager | v2-native | ✅ live | `app/(pm)/overview/page.jsx` +8 | 5 | [doc](features/FR-020-adaptive-shell.md) | TASK-FR-020 |
| FR-021 | Identity resolution: `ExternalIdentity` (LINE→Person, tenant-scoped) + `resolveLineIdentity` — idempotent, tenant-required, audited, revoke-aware (ADR-007 P3 foundation primitive) | identity | v2-native | ✅ live | `modules/identity/resolve-line-identity.js` | 3 | — | — |
| FR-022 | LINE as an identity provider end-to-end: account linking (single-use token → bind to existing Person, idempotent, merge-aware), PDPA erase-revoke, staff/customer split, and `resolveLinePrincipal` (the single P3 seam) — the full P3 gate on top of FR-021 | identity | v2-native | ✅ live | `modules/identity/classify-principal.js` +3 | 4 | — | — |
| FR-023 | Zuri Backend Slice CRM core (ADR-007 P2): Customer (per-tenant, linked to Person) + Conversation + Message + LINE gateway `ingestLineMessage` (resolves through FR-021, idempotent) | crm | v2-native | ✅ live | `modules/crm/line-ingest-service.js` | 1 | — | — |

Design notes live in `docs/features/` and declare their feature in frontmatter
(`feature: FR-020`), so moving or renaming a note never breaks this table — the
link is keyed by requirement id, not by path (AGENTS.md §18).
