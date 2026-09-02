# Gap Analysis zuri-ai — 4 มิติ (2026-09-02)

| ฟิลด์ | ค่า |
|---|---|
| วันที่วิเคราะห์ | 2026-09-02 |
| จุดตัดของโค้ด | `main` @ `4306a29` (feat(market): wire domain catalog and implement phases 3-5 …) |
| ชนิดการวิเคราะห์ | static analysis อ่านโค้ด/เอกสาร/เทสต์ที่ HEAD — ไม่ได้รัน server, ไม่ได้รัน test suite, ไม่มี production access |
| ผู้จัดทำ | Claude Code workflow (75 agents) + ตรวจซ้ำด้วยมือโดย session หลัก |
| ที่อยู่ไฟล์ | `reports/gap-analysis-2026-09-02/` — **นอก `docs/` โดยตั้งใจ** (ดูหัวข้อ "ทำไมไม่อยู่ใน docs/") |

## ไฟล์ในชุดนี้

| ไฟล์ | มิติ | บรรทัด | findings | CRITICAL | HIGH | MEDIUM | LOW | INFO |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| [01-layer-journey-gap.md](01-layer-journey-gap.md) | Layer journey: Landing → Login → Entry → Business Routing → BusinessShell → Domain → Sub-domain → Project → Platform/Control | 805 | 36 | 1 | 7 | 21 | 7 | 0 |
| [02-domain-driven-gap.md](02-domain-driven-gap.md) | Domain-driven ทีละ domain (10 modules: agent, crm, identity, integration, knowledge, market-intelligence, platform-control, project-manager, business, people) | 3,422 | 190 | 2 | 31 | 83 | 66 | 8 |
| [03-data-pipeline-gap.md](03-data-pipeline-gap.md) | Data pipeline: surface ที่รับข้อมูลจาก user และการไหล entry → validate → service → audit → persist → read | 1,151 | 54 | 5 | 10 | 22 | 13 | 4 |
| [04-integration-connectors-gap.md](04-integration-connectors-gap.md) | Connectors ใน Integration: catalog ↔ adapter ↔ credential ↔ health ↔ ingestion ↔ ports ภายนอก ↔ governance | 840 | 40 | 4 | 10 | 19 | 7 | 0 |
| **รวม** | | **6,218** | **320** | **12** | **58** | **145** | **93** | **12** |

ทุกไฟล์มีโครงเดียวกัน: header → บทสรุปผู้บริหาร → ตารางสรุปตามหน่วยตรวจ → ตารางสรุปช่องว่างทั้งหมด (flat table ทุก id) → รายละเอียดตามหน่วยตรวจ (inventory + findings พร้อม `file:line`) → ข้อเสนอแนะเรียงตามลำดับความสำคัญ (แบ่ง "ทำได้ทันทีในโค้ด / ต้องมี migration-production gate / ต้องการการตัดสินใจจากเจ้าของผลิตภัณฑ์") → ภาคผนวก ก (รายการที่ตัดออก) → ภาคผนวก ข (ข้อจำกัด)

รหัส finding: `D<มิติ>-<หน่วยตรวจ>-<ลำดับ>` เช่น `D3-line-agent-crm-flow-05`

## วิธีการ

```text
finder (21 หน่วย, Sonnet)  →  adversarial verifier (1 ต่อหน่วย, Sonnet, effort high)
  →  section writer (Haiku; ตรวจว่า id ครบ ถ้าตกหล่น escalate เป็น Sonnet — ไม่มีหน่วยใดต้อง escalate)
  →  assembler (1 ต่อมิติ, Sonnet)  →  completeness critic (1 ต่อมิติ, Opus, effort high)
  →  patch (Sonnet) ตามรายการ missing/errors ของ critic
```

| ตัวเลข | ค่า |
|---|---|
| agents ทั้งหมด | 75 (0 error, 0 empty result) |
| tool calls ของ agents | 4,140 |
| verdict ของ verifier | 247 รายการ: CONFIRMED 219 · ADJUSTED 28 · REFUTED 0 |
| finding ที่ verifier เพิ่มเอง | 45 |
| finding ที่ critic เพิ่มหลังอ่านไฟล์ | 31 (D1 5 · D2 10 · D3 9 · D4 7) |
| ข้อผิดพลาดใน draft ที่ critic สั่งแก้ | 67 (D1 19 · D2 17 · D3 12 · D4 19) — ส่วนใหญ่เป็นเลขบรรทัดคลาดเคลื่อน, ตารางนับไม่ตรง, id ซ้ำ |

หน่วยตรวจ: มิติ 1 — entry-layers, shell-domain-layers, journey-states-tests-docs · มิติ 2 — domain-<ชื่อ> ×10 · มิติ 3 — pm-plan-intake, line-agent-crm-flow, identity-onboarding-forms, integration-knowledge-document-intake, business-pm-crud-forms · มิติ 4 — in-repo-connectors, external-ports, connector-governance

## การตรวจซ้ำด้วยมือ (session หลัก)

เปิดโค้ดจริงตรวจ CRITICAL 8 จาก 12 รายการ — ยืนยันได้ทั้งหมด:

| ID | ข้อค้นพบ | สิ่งที่เห็นในโค้ด |
|---|---|---|
| D3-integration-knowledge-document-intake-14 / D4-connector-governance-13 | `GET /api/platform/integrations/line-registry` ไม่ scope เมื่อไม่ส่ง businessId | `listLineRegistry` เรียก `assertScope` เฉพาะเมื่อมี businessId และ `where` ไม่มี tenant filter — viewer ที่ login แล้วคนใดก็เห็นทะเบียน LINE ของทุก tenant |
| D4-connector-governance-03 | audit ของ LINE registry ล้มเหลวเงียบทุกครั้ง | `recordAudit(db, {...})` แต่ถูกเรียกด้วย object เดียว → `db.auditEvent` undefined → throw → `.catch(() => {})` กลืน |
| D1-shell-domain-layers-01 | SoT Pipeline 3 หน้า destructure `businessId` จาก `useScope()` | value ของ ScopeContext มี `shell.activeBusinessId` / `currentBusiness` ไม่มี `businessId` → fetch ด้วย undefined |
| D3-pm-plan-intake-01 | `/api/import/plan` ไม่มีอยู่ | `src/app/api/import/` มีเพียง bundle, commit, dry-run, template, xlsx แต่ PlanModeCustomizerModal และ UploadPlanModal ยิงไป `/api/import/plan` |
| D3-pm-plan-intake-05 | `/api/businesses`, `/api/workspaces` (list) ไม่มีอยู่ | มีเพียง `/api/workspaces/[id]`; 5 call sites ใน 4 component ยัง useFetch สอง path นี้ |
| D3-line-agent-crm-flow-05 | `/api/agent/heartbeat` ไม่มี auth ไม่ persist ไม่ audit | GET กลืน auth ล้มเหลวเป็น anonymous, POST เก็บลง `globalThis.__zuriEdgeDevices` (Map), DELETE ไม่มี auth ล้างทั้ง registry ได้, catch ตอบ 200; annotate `@req FR-080` ซึ่งไม่ใช่ FR ของ heartbeat |
| D3-integration-knowledge-document-intake-01 | Market Intelligence dashboard เป็น mock 100% | `MarketDashboard.jsx` ใช้ `useState([...])` ค่าตายตัว ไม่มี fetch ใด ๆ; nav ตั้ง `soon: false` |
| D2-domain-identity-09 | `erasePrincipal` ไม่มีเส้นทางเรียกใช้ | มีเพียง `gate.js` re-export; ไม่มี route/script ใดเรียก |

CRITICAL ที่ยังไม่ได้ตรวจซ้ำด้วยมือ (แต่สอดคล้องกับ PRD status text ที่บอกว่า "API-010 integration in progress"): D2-domain-agent-01, D4-in-repo-connectors-01, D4-external-ports-01, D3-identity-onboarding-forms-12

## ทำไมไม่อยู่ใน docs/

`scripts/doc-graph.mjs` เดิน `docs/` ทั้งต้นไม้ (ยกเว้น `docs/archive/`) และ preflight Check 15 (`scripts/untracked-docs.mjs`) ร้องเมื่อมีไฟล์ untracked ใต้ `docs/` การวางรายงาน 6,000 บรรทัดที่อ้าง id หลายร้อยตัวลงใน `docs/` จะเข้าไปในกราฟและ preflight ทันที ถ้าต้องการย้ายเข้า `docs/` ภายหลัง ให้รัน `npm run govern` หลังย้ายและแก้ตามที่ preflight รายงาน

## ข้อจำกัดที่ต้องรู้ก่อนใช้

- **static เท่านั้น** — ไม่ได้รัน server, ไม่ได้รันเทสต์ ข้อความ "หน้าใช้งานไม่ได้" มาจากการอ่านโค้ด ไม่ใช่จากการเปิดหน้า
- **PRD status column ถูกเชื่อตามตัวอักษร** เว้นแต่โค้ดขัดแย้งชัดเจน
- **verifier ไม่ REFUTED รายการใดเลย** (0/247) — ADJUSTED 28 ทำให้ระดับ/ถ้อยคำถูกต้องขึ้น แต่ตัวเลข 0 บ่งว่า pass นี้อาจใจดีเกินไป ผู้อ่านควรเปิด `file:line` ที่อ้างก่อนลงมือทุกครั้ง โดยเฉพาะระดับ MEDIUM/LOW ที่ไม่ได้ตรวจซ้ำด้วยมือ
- **มิติ 2 ยาวมาก (3,422 บรรทัด)** — ใช้ "ตารางสรุปช่องว่างทั้งหมด" เป็นดัชนีแล้วกระโดดไปยัง id ที่สนใจ
- ข้อค้นพบระดับ LOW จำนวนหนึ่งซ้ำข้าม domain โดยตั้งใจ (เช่น "charter ไม่มี Version/Status block") เพราะแต่ละ domain ต้องปิดของตัวเอง

## Gap-fix wave 1 (2026-09-02 บ่าย) — สิ่งที่ปิดแล้วบน `main`

รันเป็น workflow 10 lane ขนานใน worktree แยก (Opus 3 / Sonnet 7 ตามความซับซ้อน) แล้วรวมกับงานของอีกสอง session ที่ครอบคลุมกว่า; ทุกอย่างรวมบน branch `integration/gap-fix-wave-20260902` แล้ว fast-forward เข้า `main` ในเครื่อง (ยังไม่ push)

| Gate | ผล |
|---|---|
| `npm test` | 377 ไฟล์ / 3,206 tests ผ่าน, 0 fail (baseline ก่อน wave: 345 / 2,885) |
| `npm run build` | clean, 45 static pages |
| `npm run govern` | nodes 1,656 · dangling 0 · critical 0 · warning 0 · info 23 |
| `npm run test:e2e` | 96 ผ่าน / 4 skipped / 0 flaky (ต้องเพิ่ม fallback ใช้ Chrome ที่ติดตั้งไว้ เพราะเครื่องนี้ไม่มี ms-playwright เลย) |

| Lane / ที่มา | ปิด finding | หมายเหตุ |
|---|---|---|
| line-registry-hardening (Opus) | D3-…-14/-15/-17/-18/-21, D4-connector-governance-03/-04/-13, D2-domain-integration-05/-29/-30 | owned-only scope, audit เขียนจริง, 409 กัน re-point ข้าม Business, provider code `LINE_OA` (อ่าน `line-oa` เดิมได้) |
| heartbeat → รับงาน session zuri-ai-49 แทน lane 2 | D3-line-agent-crm-flow-05, D2-domain-agent-02/-17, D4-…-15/-18 | ประกาศ FR-141 ครบ governance; owned-scope ทุก method; audit เฉพาะการเปลี่ยนแปลง |
| dead-client-fetches → รับงาน session zuri-ai-42 แทน lane 3 | D3-pm-plan-intake-01/-05, D1-shell-domain-layers-01 | lane 3 ของ workflow ยังส่ง progressStrategy ที่ไม่มีใน enum; ของ peer ผ่าน buildHumanPlan + browser-verified; เก็บ guard test `api-path-reachability` ไว้ |
| market-dashboard-real-data (Opus) | D3-…-01, D1-shell-domain-layers-02, D2-domain-market-intelligence-04/-05/-06 (-07 บางส่วน) | `GET /api/market/observations` + charter owns_routes; watch rules เป็น placeholder ไม่มี control |
| session-503-and-control-links | D1-journey-…-01/-12, D1-entry-layers-09 | `src/lib/viewer-failure.js`; ทางเข้า `/control/roadmap` จาก `/settings` |
| platform-grant-revoke | D1-journey-…-02, D2-domain-identity-10 | CLI revoke/list, กัน revoke grant สุดท้าย |
| file-asset-ownership-authz | D3-business-pm-crud-forms-01 | writes ต้อง owned; integration test ตาม fr072 |
| identity-write-discipline | D3-identity-onboarding-forms-03, D2-domain-identity-02 | audit 6 จุดใน plugin-auth; step-up mint ย้ายเข้า identity |
| workspace-invite-ui (Opus) | D1-entry-layers-08, D3-identity-onboarding-forms-01 | owner panel บน `/workspace-home` + `GET /api/workspace-memberships` |
| docs-hygiene | D2-domain-knowledge-01, D1 DOC_DRIFT ×8, D4-external-ports-03, D2-domain-business-02 | รวมแก้ e2e fr060 ให้ derive จาก DOMAINS |

**ยังเปิดอยู่ (บันทึกใน ROADMAP revision 2.17.0):** PlatformControl guard ยังยุบ 503 เป็น 401; FR-092 ยังไม่มี translation trigger ใน production; heartbeat ยัง in-memory (ตัดสินใจไว้ใน FR-141 note); ไม่มี UI ให้ Membership แรกของ Person ใหม่ (D3-identity-onboarding-forms-12); ApiAccessKey ไม่มี list/revoke UI; data migration `line-oa` → `LINE_OA`; `GET /api/agent/heartbeat?businessId=` (ค่าว่าง) ถูกมองเป็นไม่ narrow แทน 400; `migrateProjectFiles` ยัง gate ด้วย role string; audit entityType ของ IntegrationConnection ใช้สองสะกด (`IntegrationConnection` / `INTEGRATION_CONNECTION`)

**เรื่องแวดล้อมที่ต้องรู้:** node_modules junction ธรรมดาทำให้ vitest ล้มแบบสุ่ม (Prisma client ใช้ร่วมกัน) — ใช้ per-package junction + copy `.prisma`/`@prisma` ในเครื่อง; worktree ของ lane ทั้ง 10 ยังอยู่ใต้ `.claude/worktrees/wf_f86b3aeb-211-*` และ integration worktree ที่ `C:\Users\pc\workspace\zuri-ai-integration-20260902` — **อย่า** `git worktree remove` / `rm -r` ทันที เพราะข้างในมี junction ชี้กลับ node_modules ของ primary; ปลด junction ด้วย `[System.IO.Directory]::Delete()` ก่อน
