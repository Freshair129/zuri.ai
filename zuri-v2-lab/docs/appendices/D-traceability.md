# Appendix D — Traceability Matrix

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Draft |
| **Last Updated** | 2026-08-11 |

FR → implementation → test evidence (Vitest 75/75, Playwright 20/20 — PHASE-07 report)

| FR | Implementation หลัก | Tests |
|---|---|---|
| FR-001 | `application/scope-service.js`, `api/scope` | `integration/scope-and-isolation` (7) |
| FR-002 | `context/ScopeContext.jsx`, `layouts/Topbar.jsx` | e2e overview/workspaces |
| FR-003 | `application/project-service.js`, `api/projects*` | `integration/project-core` |
| FR-004 | เดียวกัน (workstream fns) | project-core: mixed modes, unknown-mode reject |
| FR-005 | `application/work-service.js`, `api/work*`, `api/containers*` | project-core: container/item integrity |
| FR-006 | `application/milestone-gate-service.js` | project-core: milestone/gate linkage, evidence merge |
| FR-007 | `application/dependency-service.js` | project-core: self-dep, cycle, blocked eval |
| FR-008 | `application/repository-service.js` | project-core: m2m links |
| FR-009 | `views/execution/{mode-bodies,ExecutionModeView}.jsx` | e2e: 7 view tests + evidence reveal |
| FR-010 | `progress/strategies.js`, `components/ProgressExplain.jsx` | `unit/strategies` (27) + e2e explain |
| FR-011 | `progress/rollup.js`, `application/progress-service.js` | `unit/rollup` (4) + project-core rollup (70% case) |
| FR-012 | `import/{plan-schema,plan-import-service}.js` | `unit/plan-schema` (10) + `integration/plan-import` (7) + e2e reject |
| FR-013 | `application/backup-service.js`, `(pm)/backup` | `integration/backup` (4 รวม round trip) |
| FR-014 | `application/audit.js`, `api/audit`, `(pm)/audit` | audit assertions ใน core/import suites + e2e |
| FR-015 | `layouts/CommandPalette.jsx`, filters ใน AllWorkView | e2e palette + filter tests |
| FR-016 | `prisma/seed.js` | double-run verified (PHASE-00) |
| FR-017..020 | — (planned) | — |

| BR/SEC/NFR | Evidence |
|---|---|
| BR-001 / SEC-001 | scope-and-isolation: tenant≠branch, cross-tenant denied |
| BR-002 | `unit/ids`: external id ไม่ผ่าน isInternalId |
| BR-004 | plan-schema + workstream create: unknown mode rejected |
| BR-005/006 | strategies: gate caps 99, weighted formulas |
| BR-007 / SEC-002 | plan-schema strict + additionalProperties rejected |
| BR-008 | backup: preview-without-confirm ไม่เขียน DB |
| NFR-003 | e2e mobile overflow ≤1px |
| NFR-005 | strategies determinism tests |
| NFR-007 | seed double-run |

Acceptance matrix รายข้อ (ทุกข้อ PASS พร้อมหลักฐาน): `../../.agent/reports/FINAL.md`
